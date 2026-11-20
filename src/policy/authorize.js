/**
 * Authorization policy layer (task 17.2).
 *
 * A single, central enforcement point that answers "may this identity access
 * this PHI resource?" based on role plus ownership/assignment. Denials
 * short-circuit before any PHI is read (design "Authorization Policy Layer").
 *
 * The function is pure with respect to Express and I/O: the only external
 * dependency is a `providerAssignments` repository, injected by the caller,
 * whose `isActivelyAssigned(providerId, patientId)` encapsulates the
 * "provider is currently assigned to this patient" check — including
 * revocation, since a revoked assignment is no longer `active` (R12.4). This
 * keeps the rule directly unit- and property-testable against the in-memory
 * fakes (design "Testing Strategy", Property 34).
 *
 * Access is granted IF AND ONLY IF:
 *   - the identity is an authenticated patient that OWNS the resource
 *     (identity.userId === resource.patientId), OR (R11.3)
 *   - the identity is an authenticated provider CURRENTLY ASSIGNED to the
 *     resource's patient (R11.4, R6.3).
 *
 * Access is DENIED for:
 *   - unauthenticated requests (no/invalid identity) (R11.5), and
 *   - any identity whose access has been revoked (the assignment is no longer
 *     active, so `isActivelyAssigned` returns false) (R12.4).
 */

import { Role } from '../domain/types.js';

/**
 * Machine-readable reasons a decision was reached. Useful for the HTTP layer
 * to distinguish an authentication failure (401) from an authorization
 * failure (403), and for tests to assert *why* access was denied.
 * @readonly
 * @enum {string}
 */
export const DecisionReason = Object.freeze({
  PATIENT_OWNER: 'patient_owner',
  PROVIDER_ASSIGNED: 'provider_assigned',
  UNAUTHENTICATED: 'unauthenticated',
  NOT_OWNER: 'not_owner',
  NOT_ASSIGNED: 'not_assigned',
  UNKNOWN_ROLE: 'unknown_role',
  INVALID_RESOURCE: 'invalid_resource',
});

/**
 * A pure authorization decision.
 * @typedef {object} Decision
 * @property {boolean} allowed - True iff access is granted.
 * @property {string} reason - One of {@link DecisionReason}.
 */

const allow = (reason) => Object.freeze({ allowed: true, reason });
const deny = (reason) => Object.freeze({ allowed: false, reason });

/**
 * Extract the patient the resource belongs to. Every PHI record carries a
 * `patientId` (design data model); the resource may itself be a patient
 * identity, in which case its own `userId`/`id` is the owning patient.
 *
 * @param {object} resource
 * @returns {*} The owning patient id, or undefined when unavailable.
 */
function resourcePatientId(resource) {
  if (resource == null || typeof resource !== 'object') return undefined;
  return resource.patientId;
}

/**
 * Decide whether `identity` may perform `action` on `resource`.
 *
 * @param {{ userId: *, role: string } | null | undefined} identity
 *   The authenticated identity produced by the Auth & Session layer, or a
 *   null/undefined value for an unauthenticated request.
 * @param {string} action
 *   The attempted action (e.g. `read`, `write`). The current policy is
 *   ownership/assignment based and does not vary by action, but the parameter
 *   is part of the central contract so finer-grained rules can be added
 *   without touching call sites.
 * @param {object} resource
 *   The PHI record being accessed. Must carry a `patientId` identifying the
 *   patient it belongs to.
 * @param {object} deps
 * @param {import('../data/interfaces.js').ProviderAssignmentRepository} deps.providerAssignments
 *   Repository whose `isActivelyAssigned(providerId, patientId)` returns true
 *   iff an active (non-revoked) assignment links the provider to the patient.
 * @returns {Decision} A pure decision; callers map denials to 401/403.
 */
export function authorize(identity, action, resource, { providerAssignments } = {}) {
  // Unauthenticated request: no identity, or an identity missing a subject.
  if (
    identity == null ||
    typeof identity !== 'object' ||
    identity.userId == null ||
    identity.role == null
  ) {
    return deny(DecisionReason.UNAUTHENTICATED);
  }

  const patientId = resourcePatientId(resource);
  if (patientId == null) {
    return deny(DecisionReason.INVALID_RESOURCE);
  }

  if (identity.role === Role.PATIENT) {
    // A patient may access only their own records (R11.3).
    return String(identity.userId) === String(patientId)
      ? allow(DecisionReason.PATIENT_OWNER)
      : deny(DecisionReason.NOT_OWNER);
  }

  if (identity.role === Role.PROVIDER) {
    if (!providerAssignments || typeof providerAssignments.isActivelyAssigned !== 'function') {
      throw new TypeError(
        'deps.providerAssignments with isActivelyAssigned is required to authorize a provider',
      );
    }
    // A provider may access only the records of patients CURRENTLY assigned to
    // them; a revoked (inactive) assignment yields false, denying access after
    // revocation (R11.4, R6.3, R12.4).
    return providerAssignments.isActivelyAssigned(identity.userId, patientId)
      ? allow(DecisionReason.PROVIDER_ASSIGNED)
      : deny(DecisionReason.NOT_ASSIGNED);
  }

  // Any other/unknown role is denied by default (deny-by-default posture).
  return deny(DecisionReason.UNKNOWN_ROLE);
}

/**
 * Convenience boolean wrapper around {@link authorize} for call sites that
 * only need the yes/no answer.
 *
 * @param {{ userId: *, role: string } | null | undefined} identity
 * @param {string} action
 * @param {object} resource
 * @param {object} deps
 * @param {import('../data/interfaces.js').ProviderAssignmentRepository} deps.providerAssignments
 * @returns {boolean} True iff access is granted.
 */
export function isAuthorized(identity, action, resource, deps) {
  return authorize(identity, action, resource, deps).allowed;
}
