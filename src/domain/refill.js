/**
 * Refill supply logic (task 14.1).
 *
 * Pure, framework-free helpers plus a small repository-backed service that
 * implement the refill portion of design.md (Scheduler "Refill checks" and
 * MedicationService). No Express, no HTTP; the service depends only on an
 * injected MedicationRepository (contract in `../data/interfaces.js`), so the
 * logic is directly unit- and property-testable against the in-memory fakes.
 *
 * The three behaviors this module covers:
 * - Refill-reminder eligibility: a medication is due for a refill reminder IFF
 *   its `remainingSupply` is AT OR BELOW its `refillThreshold`. The boundary is
 *   inclusive — supply exactly equal to the threshold IS due (R5.1).
 * - Caregiver routing: caregiver refill notifications are additionally routed
 *   IFF the medication's per-medication `caregiverRefillNotificationsEnabled`
 *   flag is enabled (R5.3).
 * - Recording a refill: `recordRefill` sets `remainingSupply` to the original
 *   supply plus a non-negative refill amount (R5.4).
 *
 * Requirements supported: 5.1, 5.3, 5.4.
 */

/**
 * Determine whether a medication is eligible for a refill reminder (R5.1).
 *
 * Eligible IFF the remaining supply is at or below the configured refill
 * threshold. The comparison is inclusive at the boundary: `remainingSupply`
 * exactly equal to `refillThreshold` is eligible.
 *
 * Malformed inputs (non-finite numbers) are treated as NOT eligible so the
 * rule never fabricates a reminder from bad data.
 *
 * @param {object} params
 * @param {number} params.remainingSupply - Current remaining supply.
 * @param {number} params.refillThreshold - Configured low-supply threshold.
 * @returns {boolean} True iff the medication is due for a refill reminder.
 */
export function isRefillDue({ remainingSupply, refillThreshold } = {}) {
  if (!Number.isFinite(remainingSupply) || !Number.isFinite(refillThreshold)) {
    return false;
  }
  return remainingSupply <= refillThreshold;
}

/**
 * Determine whether caregiver refill notifications should be routed for a
 * medication, based on its per-medication flag (R5.3).
 *
 * Returns true IFF `caregiverRefillNotificationsEnabled` is strictly `true`.
 * Any other value (absent, null, falsy) means caregivers are not notified.
 *
 * @param {{caregiverRefillNotificationsEnabled?: boolean}} medication
 * @returns {boolean} True iff caregiver refill notifications are enabled.
 */
export function shouldNotifyCaregiversForRefill(medication) {
  return medication?.caregiverRefillNotificationsEnabled === true;
}

/**
 * Compute the remaining supply after recording a refill (R5.4).
 *
 * The new supply is the original supply plus the refill amount. The refill
 * amount must be a non-negative finite number; a negative or non-finite amount
 * is rejected so a refill can never reduce the supply.
 *
 * @param {number} originalSupply - The supply before the refill.
 * @param {number} refillAmount - The non-negative amount added.
 * @returns {number} The updated remaining supply (originalSupply + refillAmount).
 * @throws {RangeError} When `refillAmount` is negative or non-finite, or when
 *   `originalSupply` is non-finite.
 */
export function computeRefilledSupply(originalSupply, refillAmount) {
  if (!Number.isFinite(originalSupply)) {
    throw new RangeError('originalSupply must be a finite number');
  }
  if (!Number.isFinite(refillAmount) || refillAmount < 0) {
    throw new RangeError('refillAmount must be a non-negative finite number');
  }
  return originalSupply + refillAmount;
}

/**
 * Create a RefillService bound to a medications repository.
 *
 * @param {object} deps
 * @param {import('../data/interfaces.js').MedicationRepository} deps.medications
 * @returns {RefillService}
 */
export function createRefillService(deps) {
  return new RefillService(deps);
}

export class RefillService {
  /**
   * @param {object} deps
   * @param {import('../data/interfaces.js').MedicationRepository} deps.medications
   */
  constructor({ medications } = {}) {
    if (!medications) {
      throw new Error('RefillService requires a medications repository');
    }
    /** @private */ this._medications = medications;
  }

  /**
   * Whether a stored medication is currently due for a refill reminder (R5.1).
   *
   * @param {object} medication - A persisted Medication record.
   * @returns {boolean}
   */
  isRefillDue(medication) {
    return isRefillDue({
      remainingSupply: medication?.remainingSupply,
      refillThreshold: medication?.refillThreshold,
    });
  }

  /**
   * Whether caregiver refill notifications should be routed for a medication
   * (R5.3).
   *
   * @param {object} medication - A persisted Medication record.
   * @returns {boolean}
   */
  shouldNotifyCaregivers(medication) {
    return shouldNotifyCaregiversForRefill(medication);
  }

  /**
   * Record a refill for a medication, setting its remaining supply to the
   * original supply plus the non-negative refill amount (R5.4).
   *
   * Reads the current medication, computes the new supply, and persists it via
   * the repository's `update`. Returns the updated record, or null when no
   * medication with the given id exists (or, when `patientId` is supplied, when
   * it does not belong to that patient).
   *
   * @param {*} medicationId
   * @param {number} refillAmount - The non-negative amount added to the supply.
   * @param {object} [options]
   * @param {*} [options.patientId] - When provided, the refill only applies to
   *   a medication owned by this patient.
   * @returns {object|null} The updated Medication record, or null if not found.
   * @throws {RangeError} When `refillAmount` is negative or non-finite.
   */
  recordRefill(medicationId, refillAmount, { patientId } = {}) {
    const existing = this._medications.getById(medicationId);
    if (!existing) return null;
    if (patientId != null && String(existing.patientId) !== String(patientId)) {
      return null;
    }

    const remainingSupply = computeRefilledSupply(
      existing.remainingSupply,
      refillAmount,
    );

    return this._medications.update(medicationId, { remainingSupply });
  }
}
