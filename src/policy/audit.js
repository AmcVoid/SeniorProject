/**
 * Audit logging wrapper for PHI access (task 17.3).
 *
 * Requirement 12.3 / Property 35: whenever a user accesses a PHI record, the
 * system SHALL record exactly one audit entry identifying the accessing user,
 * the accessed record, and the access timestamp — and it must do so reliably.
 *
 * This module provides a thin wrapper that surrounds a PHI operation with a
 * single audit write. It is framework-free (no Express, no HTTP, no direct
 * I/O): persistence is delegated to an injected `auditEntries` repository
 * (see `AuditEntryRepository` in `../data/interfaces.js`) and the timestamp is
 * produced by an injectable `clock`, so the behavior is deterministic under
 * test.
 *
 * Fail-closed semantics: the audit entry is written BEFORE the PHI operation
 * runs. If the audit write throws, the PHI operation is never invoked and the
 * error propagates — the access is treated as failed. This guarantees the
 * system never reads/returns PHI that it could not record, satisfying the
 * "record exactly one audit entry per PHI access" guarantee even when the
 * audit store is unavailable.
 */

import { createAuditEntry } from '../domain/models.js';

/**
 * Error raised when the audit write for a PHI access fails. The wrapping of
 * the underlying cause lets callers (and the HTTP layer) distinguish an
 * audit-logging failure — which must fail the whole access closed — from an
 * error thrown by the PHI operation itself.
 */
export class AuditWriteError extends Error {
  /**
   * @param {string} message
   * @param {{ cause?: unknown }} [options]
   */
  constructor(message = 'Failed to record audit entry', { cause } = {}) {
    super(message);
    this.name = 'AuditWriteError';
    /** Stable machine-readable code for the HTTP layer to map to 5xx. */
    this.code = 'AUDIT_WRITE_FAILED';
    if (cause !== undefined) this.cause = cause;
  }
}

/** Default clock: current wall-clock time as an ISO-8601 string. */
const defaultClock = () => new Date().toISOString();

/**
 * Record exactly one audit entry for a PHI access.
 *
 * Writes a single {@link createAuditEntry} record via the injected repository.
 * Fails closed: if the repository write throws, this raises an
 * {@link AuditWriteError} (wrapping the cause) and the caller must abort the
 * PHI access.
 *
 * @param {object} access - Identifies the PHI access being audited.
 * @param {*} access.userId - The accessing user's id.
 * @param {*} access.recordRef - Reference to the accessed PHI record.
 * @param {string} [access.action] - The access verb (defaults to `'read'`).
 * @param {object} deps
 * @param {import('../data/interfaces.js').AuditEntryRepository} deps.auditEntries
 *   Repository used to persist the audit entry.
 * @param {() => string} [deps.clock] - Injectable timestamp source.
 * @returns {object} The persisted audit entry.
 * @throws {TypeError} If required inputs/deps are missing.
 * @throws {AuditWriteError} If the audit write fails (access must fail closed).
 */
export function recordPhiAccess(
  { userId, recordRef, action = 'read' } = {},
  { auditEntries, clock = defaultClock } = {},
) {
  if (!auditEntries || typeof auditEntries.insert !== 'function') {
    throw new TypeError('deps.auditEntries with insert is required');
  }
  if (userId == null) throw new TypeError('access.userId is required');
  if (recordRef == null) throw new TypeError('access.recordRef is required');

  const entry = createAuditEntry({
    userId,
    recordRef,
    action,
    timestamp: clock(),
  });

  try {
    return auditEntries.insert(entry);
  } catch (cause) {
    // Fail closed: surface the audit failure so the caller aborts the access.
    throw new AuditWriteError(undefined, { cause });
  }
}

/**
 * Wrap a PHI operation so that exactly one audit entry is recorded per access.
 *
 * The audit entry is written FIRST; only if it succeeds is `operation` invoked
 * and its result returned. This ordering delivers the fail-closed guarantee:
 * a failed audit write (raising {@link AuditWriteError}) prevents the PHI
 * operation from running at all, so no unaudited PHI access can occur (R12.3).
 *
 * @template T
 * @param {object} access - The PHI access descriptor (see {@link recordPhiAccess}).
 * @param {*} access.userId
 * @param {*} access.recordRef
 * @param {string} [access.action]
 * @param {() => T} operation - The PHI read/write to perform once audited.
 * @param {object} deps
 * @param {import('../data/interfaces.js').AuditEntryRepository} deps.auditEntries
 * @param {() => string} [deps.clock]
 * @returns {T} The result of `operation`.
 * @throws {TypeError} If `operation` is not a function or inputs are missing.
 * @throws {AuditWriteError} If the audit write fails; `operation` is not run.
 */
export function withAudit(access, operation, deps) {
  if (typeof operation !== 'function') {
    throw new TypeError('operation must be a function');
  }
  // Record the access first; a throw here (AuditWriteError) fails closed and
  // prevents the PHI operation from executing.
  recordPhiAccess(access, deps);
  return operation();
}
