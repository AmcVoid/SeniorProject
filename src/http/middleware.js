/**
 * HTTP middleware and helpers for the JSON API (task 18.1).
 *
 * This module holds the cross-cutting HTTP concerns that every PHI route in
 * the Medication Management System shares, kept separate from the controllers
 * so the controllers stay thin (request/response shaping + service delegation
 * only, per design.md "HTTP / Controller layer"):
 *
 *   1. Session validation — turns an opaque session token into the
 *      `{ userId, role }` identity the policy layer expects, or rejects the
 *      request with a generic 401 when the session is missing/invalid (R11.5,
 *      R11.2, no user enumeration).
 *   2. A `guardPhi` helper that runs the authorization policy layer for a
 *      resolved target patient (deny -> 403 with NO PHI in the body, R6.3,
 *      R11.3, R11.4) and, on allow, wraps the service call in the audit logger
 *      so exactly one audit entry is recorded per PHI access (R12.3).
 *   3. Error translation — maps domain errors to JSON HTTP responses:
 *      ValidationError / CaregiverValidationError -> 400 (field-keyed),
 *      AuthenticationError -> 401, AuditWriteError -> 503, everything else 500.
 *
 * All of these delegate the actual decisions to the already-tested policy and
 * service modules; nothing here re-implements business logic.
 */

import { authorize, DecisionReason } from '../policy/authorize.js';
import { withAudit, AuditWriteError } from '../policy/audit.js';
import { AuthenticationError } from '../policy/auth.js';
import { ValidationError } from '../domain/medication.js';
import { CaregiverValidationError } from '../domain/contact-service.js';
import { DoseLogError, DoseLogErrorCodes } from '../domain/dose-log-service.js';

/**
 * An HTTP-level error carrying an explicit status code and a JSON-serializable
 * body. Controllers/helpers throw these for flow control; {@link sendError}
 * (invoked by the async wrapper and the final error middleware) serializes
 * them. Kept generic so denial bodies never leak PHI (R6.3).
 */
export class HttpError extends Error {
  /**
   * @param {number} status - HTTP status code.
   * @param {object} body - JSON body to send (must not contain PHI for 401/403).
   */
  constructor(status, body) {
    super(typeof body?.error === 'string' ? body.error : `HTTP ${status}`);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Read the session token from a request: `Authorization: Bearer <token>` or an
 * `x-session-token` header. Returns null when absent.
 *
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function extractSessionToken(req) {
  const auth = req.get('authorization');
  if (auth && /^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, '').trim() || null;
  }
  const header = req.get('x-session-token');
  return header ? header.trim() : null;
}

/**
 * Build the session-validation middleware.
 *
 * Resolves the request's session token to an identity via the injected
 * `sessions.getByToken(token)` lookup and attaches `req.identity =
 * { userId, role }`. A missing token, an unknown token, or a session missing a
 * subject/role is rejected with a GENERIC 401 (R11.5): the body never reveals
 * whether the token was absent versus invalid, mirroring the auth layer's
 * no-enumeration stance (R11.2).
 *
 * @param {object} deps
 * @param {{ getByToken: (token: string) => (object|null) }} deps.sessions
 *   Session store resolving a token to `{ userId, role }` (or a record from
 *   which they can be read).
 * @returns {import('express').RequestHandler}
 */
export function createRequireSession({ sessions }) {
  if (!sessions || typeof sessions.getByToken !== 'function') {
    throw new TypeError('createRequireSession requires deps.sessions.getByToken');
  }
  return function requireSession(req, res, next) {
    const token = extractSessionToken(req);
    const session = token ? sessions.getByToken(token) : null;
    if (!session || session.userId == null || session.role == null) {
      // Generic authentication error — no user/session enumeration (R11.2/R11.5).
      return sendError(res, new HttpError(401, { error: 'Authentication required' }));
    }
    req.identity = { userId: session.userId, role: session.role };
    return next();
  };
}

/**
 * Build the `guardPhi` helper bound to the policy + audit dependencies.
 *
 * `guardPhi(req, { targetPatientId, recordRef, action }, operation)`:
 *   1. Runs {@link authorize} for `req.identity` against a resource carrying
 *      the resolved `targetPatientId`. On deny it throws a 403 (unauthenticated
 *      identities are caught earlier by the session middleware, but a
 *      defensive UNAUTHENTICATED reason still maps to 401). The denial body is
 *      a fixed generic message — NO PHI (R6.3, R11.3, R11.4).
 *   2. On allow, invokes `operation()` inside {@link withAudit} so exactly one
 *      audit entry (accessing user, accessed record, timestamp) is written per
 *      PHI access, failing closed if the audit write fails (R12.3).
 *
 * @param {object} deps
 * @param {import('../data/interfaces.js').ProviderAssignmentRepository} deps.providerAssignments
 * @param {import('../data/interfaces.js').AuditEntryRepository} deps.auditEntries
 * @param {() => string} [deps.clock] - Injectable audit timestamp source.
 * @returns {<T>(req: import('express').Request, ctx: {
 *   targetPatientId: *, recordRef?: *, action?: string,
 * }, operation: () => T) => T}
 */
export function createGuardPhi({ providerAssignments, auditEntries, clock }) {
  if (!auditEntries) throw new TypeError('createGuardPhi requires deps.auditEntries');
  return function guardPhi(req, { targetPatientId, recordRef, action = 'read' }, operation) {
    const decision = authorize(
      req.identity,
      action,
      { patientId: targetPatientId },
      { providerAssignments },
    );

    if (!decision.allowed) {
      if (decision.reason === DecisionReason.UNAUTHENTICATED) {
        throw new HttpError(401, { error: 'Authentication required' });
      }
      // Authorization denial: generic body, never any PHI (R6.3).
      throw new HttpError(403, { error: 'Not authorized' });
    }

    // Authorized: record exactly one audit entry, then run the PHI operation
    // (fail-closed if the audit write fails). recordRef defaults to the patient.
    return withAudit(
      {
        userId: req.identity.userId,
        recordRef: recordRef ?? targetPatientId,
        action,
      },
      operation,
      { auditEntries, clock },
    );
  };
}

/**
 * Wrap an (async) route handler so thrown errors are funneled through
 * {@link sendError} with the correct status/body translation instead of
 * crashing the request. Keeps controllers free of try/catch boilerplate.
 *
 * @param {import('express').RequestHandler} handler
 * @returns {import('express').RequestHandler}
 */
export function asyncHandler(handler) {
  return function wrapped(req, res, next) {
    Promise.resolve()
      .then(() => handler(req, res, next))
      .catch((err) => sendError(res, err));
  };
}

/**
 * Translate a caught error into a JSON HTTP response.
 *
 * Mapping (design.md "Error Handling"):
 * - {@link HttpError}                              -> its own status + body
 * - {@link ValidationError} / {@link CaregiverValidationError}
 *                                                  -> 400, field-keyed body
 * - {@link AuthenticationError}                    -> 401 generic
 * - {@link DoseLogError} (validation-ish codes)    -> 400 field-keyed / 404
 * - {@link AuditWriteError}                        -> 503 (audit unavailable)
 * - anything else                                  -> 500 generic
 *
 * @param {import('express').Response} res
 * @param {unknown} err
 * @returns {void}
 */
export function sendError(res, err) {
  if (res.headersSent) return;

  if (err instanceof HttpError) {
    res.status(err.status).json(err.body);
    return;
  }

  if (err instanceof ValidationError || err instanceof CaregiverValidationError) {
    // Field-keyed 400 body: { error, fields: { name: 'required', ... } }.
    const fields = {};
    const messages = err.fieldMessages ?? {};
    for (const field of err.missingFields ?? []) fields[field] = messages[field] ?? 'required';
    res.status(400).json({ error: 'Validation failed', fields });
    return;
  }

  if (err instanceof AuthenticationError) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  if (err instanceof DoseLogError) {
    res.status(doseLogStatus(err.code)).json(doseLogBody(err));
    return;
  }

  if (err instanceof AuditWriteError) {
    // Audit store unavailable: the access failed closed and no PHI was read.
    res.status(503).json({ error: 'Service temporarily unavailable' });
    return;
  }

  // Unexpected: do not leak internals/PHI.
  res.status(500).json({ error: 'Internal server error' });
}

/**
 * Map a DoseLogService error code to an HTTP status. Invalid input maps to 400
 * (field-keyed), a not-found event/log maps to 404, and an ownership violation
 * maps to 404 as well so the API does not confirm the existence of another
 * patient's dose event (no PHI leak).
 *
 * @param {string} code
 * @returns {number}
 */
function doseLogStatus(code) {
  switch (code) {
    case DoseLogErrorCodes.INVALID_STATUS:
    case DoseLogErrorCodes.OUTSIDE_GRACE_PERIOD:
      return 400;
    case DoseLogErrorCodes.EVENT_NOT_FOUND:
    case DoseLogErrorCodes.LOG_NOT_FOUND:
    case DoseLogErrorCodes.EVENT_NOT_OWNED:
    case DoseLogErrorCodes.PATIENT_NOT_FOUND:
      return 404;
    default:
      return 400;
  }
}

/**
 * Build the JSON body for a DoseLogError. For 400s we surface a field-keyed
 * body keyed on `status` (the only client-supplied field these errors concern)
 * so the client can render an inline message; otherwise a generic message.
 *
 * @param {DoseLogError} err
 * @returns {object}
 */
function doseLogBody(err) {
  if (
    err.code === DoseLogErrorCodes.INVALID_STATUS ||
    err.code === DoseLogErrorCodes.OUTSIDE_GRACE_PERIOD
  ) {
    return { error: 'Validation failed', fields: { status: err.message } };
  }
  return { error: 'Not found' };
}
