/**
 * Plain data models (factories) for the Medication Management System.
 *
 * These are pure, framework-free constructors that shape entity records to
 * match the "Data Models / Entities" section of design.md. They contain no
 * Express, no I/O, and no persistence concerns; repositories (task 2.2/2.3)
 * are responsible for storage. Factories normalize inputs into a plain object
 * with a stable shape so downstream services can rely on fields being present.
 *
 * Conventions:
 * - Each factory returns a plain object (no class, no prototype behavior).
 * - Callers supply ids and timestamps (kept injectable for testability); when
 *   omitted, id defaults to `null` and timestamps default to the current time.
 * - Factories do not throw on domain-invalid combinations; validation lives in
 *   `invariants.js` as separate pure helpers so models stay simple.
 *
 * Requirements supported (foundational):
 * - 1.1: Medication creation associates a record with the patient.
 * - 3.1: Dose logging records event, status, and timestamp.
 * - 7.1: Interaction warnings reference interacting medications.
 * - 12.3: Audit entries identify user, record, and timestamp.
 * - 13.2: Notification attempt tracking (attemptCount / maxAttempts).
 */

import {
  Role,
  DoseEventStatus,
  DoseLogStatus,
  NotificationType,
  NotificationStatus,
  InteractionWarningStatus,
} from './types.js';

/** @returns {string} An ISO-8601 timestamp for "now". */
const nowIso = () => new Date().toISOString();

/**
 * User — base authentication record.
 * Design: `id`, `role`, `credentialHash`, `preferredReminderChannel`, `createdAt`.
 *
 * @param {object} params
 * @param {string|null} [params.id]
 * @param {string} params.role - One of {@link Role}.
 * @param {string} [params.credentialHash]
 * @param {string|null} [params.preferredReminderChannel]
 * @param {string} [params.createdAt]
 * @returns {object} A plain User record.
 */
export function createUser({
  id = null,
  role,
  credentialHash = '',
  preferredReminderChannel = null,
  createdAt = nowIso(),
} = {}) {
  return { id, role, credentialHash, preferredReminderChannel, createdAt };
}

/**
 * Patient — extends User semantics.
 * Design: `id (userId)`, `displayName`, `gracePeriodMinutes`, profile/preferences.
 *
 * @param {object} params
 * @param {string|null} [params.id]
 * @param {string} [params.displayName]
 * @param {number} [params.gracePeriodMinutes]
 * @param {object} [params.preferences]
 * @returns {object} A plain Patient record.
 */
export function createPatient({
  id = null,
  displayName = '',
  gracePeriodMinutes = 0,
  preferences = {},
} = {}) {
  return { id, role: Role.PATIENT, displayName, gracePeriodMinutes, preferences };
}

/**
 * Provider — clinician record.
 * Design: `id (userId)`, `displayName`.
 *
 * @param {object} params
 * @param {string|null} [params.id]
 * @param {string} [params.displayName]
 * @returns {object} A plain Provider record.
 */
export function createProvider({ id = null, displayName = '' } = {}) {
  return { id, role: Role.PROVIDER, displayName };
}

/**
 * ProviderAssignment — revocable link between a provider and a patient.
 * Design: `id`, `providerId`, `patientId`, `active` (revocable, R12.4).
 *
 * @param {object} params
 * @param {string|null} [params.id]
 * @param {string} params.providerId
 * @param {string} params.patientId
 * @param {boolean} [params.active]
 * @returns {object} A plain ProviderAssignment record.
 */
export function createProviderAssignment({
  id = null,
  providerId,
  patientId,
  active = true,
} = {}) {
  return { id, providerId, patientId, active };
}

/**
 * Schedule — embedded in Medication.
 * Design: `times`, `recurrence`, `startDate`, optional `endDate`.
 *
 * @param {object} params
 * @param {string[]} [params.times] - Times-of-day (e.g. "08:00").
 * @param {string} [params.recurrence] - e.g. daily / weekdays / interval.
 * @param {string|null} [params.startDate]
 * @param {string|null} [params.endDate]
 * @returns {object} A plain Schedule value object.
 */
export function createSchedule({
  times = [],
  recurrence = 'daily',
  startDate = null,
  endDate = null,
} = {}) {
  return { times: [...times], recurrence, startDate, endDate };
}

/**
 * Medication — a drug a patient takes.
 * Design: `id`, `patientId`, `name`, `dosage`, `schedule`, `refillThreshold`,
 * `remainingSupply`, `caregiverAlertsEnabled`, `caregiverRefillNotificationsEnabled`,
 * `active`, `createdAt`.
 *
 * @param {object} params
 * @returns {object} A plain Medication record.
 */
export function createMedication({
  id = null,
  patientId,
  name = '',
  dosage = '',
  schedule = null,
  refillThreshold = 0,
  remainingSupply = 0,
  caregiverAlertsEnabled = true,
  caregiverRefillNotificationsEnabled = false,
  active = true,
  createdAt = nowIso(),
} = {}) {
  return {
    id,
    patientId,
    name,
    dosage,
    schedule,
    refillThreshold,
    remainingSupply,
    caregiverAlertsEnabled,
    caregiverRefillNotificationsEnabled,
    active,
    createdAt,
  };
}

/**
 * Dose_Event — a single scheduled occurrence of a medication.
 * Design: `id`, `medicationId`, `scheduledTime`, `status`, `future` (derived).
 *
 * @param {object} params
 * @returns {object} A plain Dose_Event record.
 */
export function createDoseEvent({
  id = null,
  medicationId,
  scheduledTime,
  status = DoseEventStatus.PENDING,
} = {}) {
  return { id, medicationId, scheduledTime, status };
}

/**
 * Dose_Log — records whether a dose event was taken or missed.
 * Design: `id`, `doseEventId`, `status` (`taken` | `missed`), `loggedAt`.
 *
 * @param {object} params
 * @returns {object} A plain Dose_Log record.
 */
export function createDoseLog({
  id = null,
  doseEventId,
  status = DoseLogStatus.TAKEN,
  loggedAt = nowIso(),
} = {}) {
  return { id, doseEventId, status, loggedAt };
}

/**
 * Caregiver_Contact — a designated notification recipient.
 * Design: `id`, `patientId`, `name`, `deliveryAddresses` (>=1), `channelPreference`, `active`.
 *
 * @param {object} params
 * @returns {object} A plain Caregiver_Contact record.
 */
export function createCaregiverContact({
  id = null,
  patientId,
  name = '',
  deliveryAddresses = [],
  channelPreference = null,
  active = true,
} = {}) {
  return {
    id,
    patientId,
    name,
    deliveryAddresses: [...deliveryAddresses],
    channelPreference,
    active,
  };
}

/**
 * Memory_Note — free-text context attached to a medication.
 * Design: `id`, `medicationId`, `text`, `createdAt`, `updatedAt`.
 *
 * @param {object} params
 * @returns {object} A plain Memory_Note record.
 */
export function createMemoryNote({
  id = null,
  medicationId,
  text = '',
  createdAt = nowIso(),
  updatedAt = createdAt,
} = {}) {
  return { id, medicationId, text, createdAt, updatedAt };
}

/**
 * Interaction_Warning — flags a dangerous pair of the patient's medications.
 * Design: `id`, `patientId`, `medicationIdA`, `medicationIdB`, `description`, `status`.
 *
 * The medication pair is unordered; the factory normalizes the two ids into a
 * canonical (sorted) order so equivalent pairs compare equal.
 *
 * @param {object} params
 * @returns {object} A plain Interaction_Warning record.
 */
export function createInteractionWarning({
  id = null,
  patientId,
  medicationIdA,
  medicationIdB,
  description = '',
  status = InteractionWarningStatus.ACTIVE,
} = {}) {
  const [a, b] = normalizePair(medicationIdA, medicationIdB);
  return { id, patientId, medicationIdA: a, medicationIdB: b, description, status };
}

/**
 * InteractionRule — an entry in the interaction rule set (not per-patient PHI).
 * Design: `drugA`, `drugB` (unordered pair), `severity`, `description`.
 *
 * The drug pair is unordered; the factory normalizes it into canonical order.
 *
 * @param {object} params
 * @returns {object} A plain InteractionRule record.
 */
export function createInteractionRule({
  drugA,
  drugB,
  severity = 'unknown',
  description = '',
} = {}) {
  const [a, b] = normalizePair(drugA, drugB);
  return { drugA: a, drugB: b, severity, description };
}

/**
 * Notification — an outbound message tracked through delivery/retry.
 * Design: `id`, `type`, `recipientRef`, `channel`, `payload`, `status`,
 * `attemptCount`, `maxAttempts`, `scheduledFor`.
 *
 * @param {object} params
 * @returns {object} A plain Notification record.
 */
export function createNotification({
  id = null,
  type = NotificationType.DOSE,
  recipientRef,
  channel = null,
  payload = {},
  status = NotificationStatus.PENDING,
  attemptCount = 0,
  maxAttempts = 1,
  scheduledFor = null,
} = {}) {
  return {
    id,
    type,
    recipientRef,
    channel,
    payload,
    status,
    attemptCount,
    maxAttempts,
    scheduledFor,
  };
}

/**
 * Audit_Entry — a record of a PHI access.
 * Design: `id`, `userId`, `recordRef`, `action`, `timestamp`.
 *
 * @param {object} params
 * @returns {object} A plain Audit_Entry record.
 */
export function createAuditEntry({
  id = null,
  userId,
  recordRef,
  action = 'read',
  timestamp = nowIso(),
} = {}) {
  return { id, userId, recordRef, action, timestamp };
}

/**
 * Normalize an unordered pair into a canonical (sorted) order so that
 * (x, y) and (y, x) yield identical tuples. Comparison is by string form,
 * which is stable for the id/drug-name values used across the model.
 *
 * @param {*} first
 * @param {*} second
 * @returns {[*, *]} The pair in canonical order.
 */
export function normalizePair(first, second) {
  return String(first) <= String(second) ? [first, second] : [second, first];
}
