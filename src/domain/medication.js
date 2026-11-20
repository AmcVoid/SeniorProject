/**
 * MedicationService — medication lifecycle for the Medication Management System.
 *
 * This service implements the medication lifecycle described in design.md
 * ("Components and Interfaces" > MedicationService): create, update, delete
 * (soft), and list-active. It is framework-free (no Express, no HTTP) and
 * depends only on injected repositories (the contracts in
 * `../data/interfaces.js`) plus the pure `ScheduleService.generateDoseEvents`
 * expansion and an injectable clock. This keeps the business logic directly
 * unit- and property-testable against the in-memory fakes.
 *
 * Design references (design.md > MedicationService):
 * - `createMedication(patientId, {name, dosage, schedule, refillThreshold,
 *   supply})` validates required fields (name, dosage, schedule); on missing
 *   fields returns a validation error listing each missing field (R1.2). On
 *   success, delegates to ScheduleService to generate dose events (R1.1, R1.6).
 * - `updateMedication(patientId, medicationId, patch)` persists changed
 *   name/dosage/schedule (R1.3); regenerates future dose events if the
 *   schedule changed.
 * - `deleteMedication(patientId, medicationId)` marks the medication inactive
 *   and removes its *future* dose events, preserving history (R1.4).
 * - `listActiveMedications(patientId)` returns active medications with name,
 *   dosage, schedule (R1.5).
 *
 * Requirements supported: 1.1, 1.2, 1.3, 1.4, 1.5, 6.1.
 */

import { createMedication as buildMedication } from './models.js';
import { generateDoseEvents as defaultGenerateDoseEvents } from './schedule.js';

/** Required medication fields checked by {@link MedicationService.createMedication}. */
const REQUIRED_FIELDS = Object.freeze(['name', 'dosage', 'schedule']);

/**
 * Structured error thrown when a submission is missing required fields.
 *
 * Carries `missingFields` listing exactly the fields that were absent (R1.2),
 * so the HTTP layer can translate it into a field-keyed 400 response.
 */
export class ValidationError extends Error {
  /**
   * @param {string[]} missingFields - Exactly the required fields that were missing.
   */
  constructor(missingFields) {
    const fields = [...missingFields];
    super(`Missing required field(s): ${fields.join(', ')}`);
    this.name = 'ValidationError';
    this.missingFields = fields;
  }
}

/**
 * Determine whether a required field value counts as "present".
 *
 * A field is missing when it is null/undefined, an empty/blank string, or (for
 * the schedule) an object with no times-of-day to expand. This matches R1.2's
 * intent that a "missing Schedule" is rejected.
 *
 * @param {string} field
 * @param {*} value
 * @returns {boolean} True when the field value is present/usable.
 */
function isFieldPresent(field, value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (field === 'schedule') {
    // A schedule must at least carry one time-of-day to be meaningful.
    return (
      typeof value === 'object' &&
      Array.isArray(value.times) &&
      value.times.length > 0
    );
  }
  return true;
}

/**
 * MedicationService factory. Wires the service to a set of repositories plus
 * an (optional) schedule generator, expansion window, and clock, all injectable
 * for testing.
 *
 * @param {object} deps
 * @param {import('../data/interfaces.js').MedicationRepository} deps.medications
 * @param {import('../data/interfaces.js').DoseEventRepository} deps.doseEvents
 * @param {(medication: object, window: {start: string, end: string}) => object[]} [deps.generateDoseEvents]
 *   Schedule-expansion function; defaults to the pure ScheduleService.
 * @param {() => Date} [deps.now]
 *   Clock returning "now"; the boundary between past (history) and future dose
 *   events. Defaults to `() => new Date()`.
 * @param {number} [deps.horizonDays]
 *   How far ahead of `now` to expand dose events, in days. Defaults to 30.
 * @returns {MedicationService}
 */
export function createMedicationService(deps) {
  return new MedicationService(deps);
}

export class MedicationService {
  /**
   * @param {object} deps See {@link createMedicationService}.
   */
  constructor({
    medications,
    doseEvents,
    generateDoseEvents = defaultGenerateDoseEvents,
    now = () => new Date(),
    horizonDays = 30,
  } = {}) {
    if (!medications) throw new Error('MedicationService requires a medications repository');
    if (!doseEvents) throw new Error('MedicationService requires a doseEvents repository');
    /** @private */ this._medications = medications;
    /** @private */ this._doseEvents = doseEvents;
    /** @private */ this._generateDoseEvents = generateDoseEvents;
    /** @private */ this._now = now;
    /** @private */ this._horizonDays = horizonDays;
  }

  /**
   * Create a medication for a patient (R1.1, R1.2, R1.6).
   *
   * Validates that name, dosage, and schedule are present. When any are
   * missing, throws a {@link ValidationError} enumerating exactly the missing
   * fields and persists nothing. On success, stores the medication and expands
   * its schedule into concrete dose events over the expansion horizon.
   *
   * @param {*} patientId
   * @param {object} input - { name, dosage, schedule, refillThreshold?, supply?, ... }
   * @returns {object} The persisted Medication record.
   * @throws {ValidationError} When required fields are missing.
   */
  createMedication(patientId, input = {}) {
    const missing = REQUIRED_FIELDS.filter(
      (field) => !isFieldPresent(field, input[field]),
    );
    if (missing.length > 0) throw new ValidationError(missing);

    const medication = buildMedication({
      patientId,
      name: input.name,
      dosage: input.dosage,
      schedule: input.schedule,
      refillThreshold: input.refillThreshold,
      // `supply` is the create-time alias for the stored `remainingSupply`.
      remainingSupply:
        input.remainingSupply != null ? input.remainingSupply : input.supply,
      caregiverAlertsEnabled: input.caregiverAlertsEnabled,
      caregiverRefillNotificationsEnabled: input.caregiverRefillNotificationsEnabled,
      active: true,
    });

    const stored = this._medications.insert(medication);

    // Delegate to ScheduleService to generate the dose events (R1.6).
    const events = this._generateDoseEvents(stored, this._expansionWindow());
    if (events.length > 0) this._doseEvents.insertMany(events);

    return stored;
  }

  /**
   * Update a medication's name, dosage, and/or schedule (R1.3).
   *
   * Persists only the recognized editable fields present in `patch`. When the
   * schedule changes, future dose events are regenerated: existing future
   * events are removed and the new schedule is expanded over the horizon, while
   * past dose events (history) are left untouched.
   *
   * @param {*} patientId
   * @param {*} medicationId
   * @param {object} patch - Any of { name, dosage, schedule }.
   * @returns {object|null} The updated Medication record, or null if it does
   *   not exist or does not belong to the patient.
   * @throws {ValidationError} When the patch blanks out a required field.
   */
  updateMedication(patientId, medicationId, patch = {}) {
    const existing = this._medications.getById(medicationId);
    if (!existing || String(existing.patientId) !== String(patientId)) return null;

    // Editable fields that are part of the patch must still be present: an
    // edit cannot blank out a required field (same rule as create, R1.2).
    const blanked = REQUIRED_FIELDS.filter(
      (field) => field in patch && !isFieldPresent(field, patch[field]),
    );
    if (blanked.length > 0) throw new ValidationError(blanked);

    const changes = {};
    if ('name' in patch) changes.name = patch.name;
    if ('dosage' in patch) changes.dosage = patch.dosage;
    const scheduleChanged = 'schedule' in patch;
    if (scheduleChanged) changes.schedule = patch.schedule;

    const updated = this._medications.update(medicationId, changes);
    if (!updated) return null;

    if (scheduleChanged) this._regenerateFutureDoseEvents(updated);

    return updated;
  }

  /**
   * Soft-delete a medication (R1.4).
   *
   * Marks the medication inactive (so it drops out of the active list) and
   * removes its future dose events, while past dose events and their logs are
   * preserved as history.
   *
   * @param {*} patientId
   * @param {*} medicationId
   * @returns {boolean} True when a matching medication was deleted.
   */
  deleteMedication(patientId, medicationId) {
    const existing = this._medications.getById(medicationId);
    if (!existing || String(existing.patientId) !== String(patientId)) return false;

    this._medications.markInactive(medicationId);
    this._doseEvents.removeFutureByMedication(medicationId, this._boundaryIso());
    return true;
  }

  /**
   * List the patient's active medications (R1.5, R6.1).
   *
   * @param {*} patientId
   * @returns {object[]} Active Medication records, each carrying name, dosage,
   *   and schedule.
   */
  listActiveMedications(patientId) {
    return this._medications.listActiveByPatient(patientId);
  }

  /**
   * Remove a medication's future dose events and regenerate them from its
   * current schedule, leaving past events intact.
   *
   * @private
   * @param {object} medication - The persisted medication with its new schedule.
   */
  _regenerateFutureDoseEvents(medication) {
    this._doseEvents.removeFutureByMedication(medication.id, this._boundaryIso());
    const events = this._generateDoseEvents(medication, this._expansionWindow());
    // Only (re)insert the future portion; past events remain untouched.
    const boundary = this._boundaryIso();
    const futureEvents = events.filter((e) => e.scheduledTime > boundary);
    if (futureEvents.length > 0) this._doseEvents.insertMany(futureEvents);
  }

  /**
   * The past/future boundary as an ISO string (the current clock reading).
   * @private
   * @returns {string}
   */
  _boundaryIso() {
    return this._now().toISOString();
  }

  /**
   * The schedule-expansion window: from now through the configured horizon.
   * @private
   * @returns {{start: string, end: string}}
   */
  _expansionWindow() {
    const start = this._now();
    const end = new Date(start.getTime() + this._horizonDays * 24 * 60 * 60 * 1000);
    return { start: start.toISOString(), end: end.toISOString() };
  }
}
