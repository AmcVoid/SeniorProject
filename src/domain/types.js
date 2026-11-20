/**
 * Shared domain types/enums for the Medication Management System.
 *
 * These enums are the single source of truth for the string values used
 * across services (domain, policy, scheduler, notifications, data, http).
 * Values align with the entities described in design.md.
 *
 * Requirements supported (foundational):
 * - 1.1: creating a medication associates a record with the patient.
 * - 11.1: authentication / session establishment (Role).
 */

/**
 * User roles. Design: User.role is `patient` | `provider`.
 * @readonly
 * @enum {string}
 */
export const Role = Object.freeze({
  PATIENT: 'patient',
  PROVIDER: 'provider',
});

/**
 * Lifecycle status of a scheduled Dose_Event.
 * Design: Dose_Event.status is `pending` | `taken` | `missed`.
 * @readonly
 * @enum {string}
 */
export const DoseEventStatus = Object.freeze({
  PENDING: 'pending',
  TAKEN: 'taken',
  MISSED: 'missed',
});

/**
 * Recorded outcome on a Dose_Log.
 * Design: Dose_Log.status is `taken` | `missed`.
 * @readonly
 * @enum {string}
 */
export const DoseLogStatus = Object.freeze({
  TAKEN: 'taken',
  MISSED: 'missed',
});

/**
 * Kind of outbound notification.
 * Design: Notification.type is `dose` | `missed` | `refill`.
 * @readonly
 * @enum {string}
 */
export const NotificationType = Object.freeze({
  DOSE: 'dose',
  MISSED: 'missed',
  REFILL: 'refill',
});

/**
 * Delivery status of a Notification.
 * Design: Notification.status is `pending` | `delivered` | `failed` | `undelivered`.
 * @readonly
 * @enum {string}
 */
export const NotificationStatus = Object.freeze({
  PENDING: 'pending',
  DELIVERED: 'delivered',
  FAILED: 'failed',
  UNDELIVERED: 'undelivered',
});

/**
 * Status of a drug Interaction_Warning.
 * Design: Interaction_Warning.status is `active` | `resolved`.
 * @readonly
 * @enum {string}
 */
export const InteractionWarningStatus = Object.freeze({
  ACTIVE: 'active',
  RESOLVED: 'resolved',
});

/**
 * Convenience list of all enums, useful for wiring/smoke checks.
 */
export const Enums = Object.freeze({
  Role,
  DoseEventStatus,
  DoseLogStatus,
  NotificationType,
  NotificationStatus,
  InteractionWarningStatus,
});
