/**
 * Notification payload builders for the Medication Management System.
 *
 * These are pure functions (no I/O, no side effects) that assemble the
 * `payload` object carried by a Notification record. They are deliberately
 * kept separate from the dispatcher (channel selection / delivery / retry),
 * so payload content can be composed and tested in isolation.
 *
 * Field contracts (design.md "NotificationService / Dispatcher"):
 * - Dose reminder: medication name, dosage, scheduled time, and any memory
 *   note (R2.2, R10.5).
 * - Missed-dose alert: patient, medication name, scheduled time (R4.2).
 * - Refill reminder: medication name and remaining supply (R5.2).
 *
 * Each builder returns a plain object tagged with its {@link NotificationType},
 * so a payload is self-describing when attached to a Notification.
 */

import { NotificationType } from '../domain/types.js';

/**
 * Build a dose-reminder payload.
 *
 * Includes the medication name, dosage, and scheduled time; when the
 * medication has an associated memory note, its text is included as well
 * (R2.2, R10.5). When no note is present, `memoryNote` is `null` so the
 * field shape stays stable for consumers.
 *
 * The memory note may be supplied either as a Memory_Note record (an object
 * with a `text` field) or as a raw string; both are normalized to the note
 * text. An absent/empty note yields `null`.
 *
 * @param {object} params
 * @param {object} params.medication - Medication record (needs `name`, `dosage`).
 * @param {string} params.scheduledTime - The Dose_Event scheduled time (ISO string).
 * @param {(object|string|null)} [params.memoryNote] - Memory_Note record, text, or none.
 * @returns {object} A dose-reminder payload.
 */
export function buildDoseReminderPayload({ medication, scheduledTime, memoryNote = null } = {}) {
  return {
    type: NotificationType.DOSE,
    medicationName: medication?.name ?? null,
    dosage: medication?.dosage ?? null,
    scheduledTime: scheduledTime ?? null,
    memoryNote: normalizeMemoryNote(memoryNote),
  };
}

/**
 * Build a missed-dose alert payload.
 *
 * Identifies the patient, the medication name, and the scheduled time of the
 * missed dose (R4.2). The patient may be supplied as a Patient record (with a
 * `displayName`/`id`) or a raw identifier string.
 *
 * @param {object} params
 * @param {(object|string)} params.patient - Patient record or identifier.
 * @param {object} params.medication - Medication record (needs `name`).
 * @param {string} params.scheduledTime - The missed Dose_Event scheduled time (ISO string).
 * @returns {object} A missed-dose alert payload.
 */
export function buildMissedDoseAlertPayload({ patient, medication, scheduledTime } = {}) {
  return {
    type: NotificationType.MISSED,
    patient: normalizePatient(patient),
    medicationName: medication?.name ?? null,
    scheduledTime: scheduledTime ?? null,
  };
}

/**
 * Build a refill-reminder payload.
 *
 * Identifies the medication name and the remaining supply (R5.2). Remaining
 * supply is taken from the explicit `remainingSupply` argument when provided,
 * otherwise from the medication record.
 *
 * @param {object} params
 * @param {object} params.medication - Medication record (needs `name`, `remainingSupply`).
 * @param {number} [params.remainingSupply] - Optional override for remaining supply.
 * @returns {object} A refill-reminder payload.
 */
export function buildRefillReminderPayload({ medication, remainingSupply } = {}) {
  return {
    type: NotificationType.REFILL,
    medicationName: medication?.name ?? null,
    remainingSupply: remainingSupply ?? medication?.remainingSupply ?? null,
  };
}

/**
 * Normalize a memory note input into note text (or null).
 *
 * Accepts a Memory_Note record (`{ text }`), a raw string, or a nullish value.
 * Empty/whitespace-only text is treated as "no note" and yields `null`.
 *
 * @param {(object|string|null|undefined)} note
 * @returns {string|null}
 */
function normalizeMemoryNote(note) {
  if (note == null) return null;
  const text = typeof note === 'string' ? note : note.text;
  if (typeof text !== 'string' || text.trim() === '') return null;
  return text;
}

/**
 * Normalize a patient input for a payload's `patient` field.
 *
 * Accepts a Patient record or a raw identifier. For a record, keeps the
 * identifying fields (`id`, `displayName`) so the alert can name the patient
 * without carrying the full PHI record. A raw value is returned as-is.
 *
 * @param {(object|string|null|undefined)} patient
 * @returns {(object|string|null)}
 */
function normalizePatient(patient) {
  if (patient == null) return null;
  if (typeof patient !== 'object') return patient;
  const { id = null, displayName = null } = patient;
  return { id, displayName };
}
