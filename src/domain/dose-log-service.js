/**
 * DoseLogService — dose logging, status changes, and dose history (task 6.1).
 *
 * Pure, framework-free domain service (no Express, no direct I/O). All storage
 * happens through injected repositories, and "now" is supplied by an injectable
 * clock so behavior is deterministic and property-testable.
 *
 * Responsibilities (from design.md "DoseLogService"):
 * - `logDose(patientId, doseEventId, status)` — records taken/missed with a
 *   timestamp, referencing the dose event (R3.1, R3.2).
 * - `changeLog(patientId, doseEventId, status)` — changes a logged status only
 *   while the dose event is still within its grace period; otherwise rejects
 *   (R3.5).
 * - `getDoseHistory(patientId, range)` — one entry per dose event with its
 *   logged status and timestamp (R3.4).
 *
 * The grace period is configurable per patient via `patient.gracePeriodMinutes`
 * (see design.md, Patient entity). A dose event is "within grace" when the
 * current time is at or before `scheduledTime + gracePeriodMinutes`.
 *
 * Requirements: 3.1, 3.2, 3.4, 3.5.
 */

import { DoseLogStatus } from './types.js';
import { createDoseLog } from './models.js';

const MINUTE_MS = 60 * 1000;

/** Default clock: current wall-clock time as an ISO-8601 string. */
const defaultNow = () => new Date().toISOString();

/**
 * A structured domain error carrying a machine-readable code so the HTTP layer
 * can translate it (e.g. validation -> 400) without string matching.
 */
export class DoseLogError extends Error {
  /**
   * @param {string} code - Stable error code (see DoseLogErrorCodes).
   * @param {string} message - Human-readable description.
   */
  constructor(code, message) {
    super(message);
    this.name = 'DoseLogError';
    this.code = code;
  }
}

/** Stable error codes emitted by DoseLogService. */
export const DoseLogErrorCodes = Object.freeze({
  INVALID_STATUS: 'INVALID_STATUS',
  PATIENT_NOT_FOUND: 'PATIENT_NOT_FOUND',
  EVENT_NOT_FOUND: 'EVENT_NOT_FOUND',
  EVENT_NOT_OWNED: 'EVENT_NOT_OWNED',
  LOG_NOT_FOUND: 'LOG_NOT_FOUND',
  OUTSIDE_GRACE_PERIOD: 'OUTSIDE_GRACE_PERIOD',
});

const VALID_STATUSES = new Set([DoseLogStatus.TAKEN, DoseLogStatus.MISSED]);

/**
 * Create a DoseLogService bound to a set of repositories and a clock.
 *
 * @param {object} deps
 * @param {import('../data/interfaces.js').DoseEventRepository} deps.doseEvents
 * @param {import('../data/interfaces.js').DoseLogRepository} deps.doseLogs
 * @param {import('../data/interfaces.js').MedicationRepository} deps.medications
 * @param {{getById: (id: *) => (object | null)}} deps.patients
 *   Patient repository/lookup, used to read `gracePeriodMinutes`.
 * @param {() => string} [deps.now] - Injectable clock returning an ISO string.
 * @returns {{
 *   logDose: (patientId: *, doseEventId: *, status: string) => object,
 *   changeLog: (patientId: *, doseEventId: *, status: string) => object,
 *   getDoseHistory: (patientId: *, range?: {from?: string, to?: string}) => object[],
 *   isWithinGracePeriod: (patientId: *, doseEventId: *, atTime?: string) => boolean,
 * }}
 */
export function createDoseLogService({
  doseEvents,
  doseLogs,
  medications,
  patients,
  now = defaultNow,
} = {}) {
  /**
   * Resolve and validate a dose event owned by the given patient.
   * @param {*} patientId
   * @param {*} doseEventId
   * @returns {{event: object, medication: object}}
   */
  function resolveOwnedEvent(patientId, doseEventId) {
    const event = doseEvents.getById(doseEventId);
    if (!event) {
      throw new DoseLogError(
        DoseLogErrorCodes.EVENT_NOT_FOUND,
        `Dose event ${doseEventId} does not exist`,
      );
    }
    const medication = medications.getById(event.medicationId);
    if (!medication || String(medication.patientId) !== String(patientId)) {
      throw new DoseLogError(
        DoseLogErrorCodes.EVENT_NOT_OWNED,
        `Dose event ${doseEventId} is not owned by patient ${patientId}`,
      );
    }
    return { event, medication };
  }

  /**
   * Grace-period boundary (as epoch ms) for a dose event: scheduledTime plus
   * the patient's configured grace-period minutes.
   * @param {object} event
   * @param {*} patientId
   * @returns {number} Epoch milliseconds of the grace boundary.
   */
  function graceBoundaryMs(event, patientId) {
    const patient = patients.getById(patientId);
    if (!patient) {
      throw new DoseLogError(
        DoseLogErrorCodes.PATIENT_NOT_FOUND,
        `Patient ${patientId} does not exist`,
      );
    }
    const minutes = Number(patient.gracePeriodMinutes) || 0;
    return Date.parse(event.scheduledTime) + minutes * MINUTE_MS;
  }

  function assertValidStatus(status) {
    if (!VALID_STATUSES.has(status)) {
      throw new DoseLogError(
        DoseLogErrorCodes.INVALID_STATUS,
        `Status must be one of {taken, missed}, got: ${status}`,
      );
    }
  }

  return {
    /**
     * Record a dose as taken or missed. Creates a dose log referencing the
     * event, recording the status and a log timestamp (R3.1, R3.2).
     *
     * @param {*} patientId
     * @param {*} doseEventId
     * @param {string} status - {@link DoseLogStatus}.TAKEN | .MISSED
     * @returns {object} The persisted Dose_Log.
     */
    logDose(patientId, doseEventId, status) {
      assertValidStatus(status);
      resolveOwnedEvent(patientId, doseEventId);
      const log = createDoseLog({ doseEventId, status, loggedAt: now() });
      return doseLogs.insert(log);
    },

    /**
     * Change the logged status of a dose event, allowed only while the event
     * is still within its grace period; otherwise rejects (R3.5).
     *
     * @param {*} patientId
     * @param {*} doseEventId
     * @param {string} status - New {@link DoseLogStatus}.
     * @returns {object} The updated Dose_Log.
     */
    changeLog(patientId, doseEventId, status) {
      assertValidStatus(status);
      const { event } = resolveOwnedEvent(patientId, doseEventId);

      const existing = doseLogs.getByDoseEvent(doseEventId);
      if (!existing) {
        throw new DoseLogError(
          DoseLogErrorCodes.LOG_NOT_FOUND,
          `No log exists for dose event ${doseEventId} to change`,
        );
      }

      const boundary = graceBoundaryMs(event, patientId);
      if (Date.parse(now()) > boundary) {
        throw new DoseLogError(
          DoseLogErrorCodes.OUTSIDE_GRACE_PERIOD,
          `Dose event ${doseEventId} is past its grace period; status cannot be changed`,
        );
      }

      return doseLogs.updateByDoseEvent(doseEventId, {
        status,
        loggedAt: now(),
      });
    },

    /**
     * Return one entry per dose event with its logged status and timestamp
     * (R3.4). Unlogged events surface with a null status/timestamp so history
     * covers every event, not just logged ones. An optional `range` filters by
     * the event's `scheduledTime` inclusively.
     *
     * @param {*} patientId
     * @param {{from?: string, to?: string}} [range]
     * @returns {Array<{
     *   doseEventId: *, medicationId: *, scheduledTime: string,
     *   status: (string|null), loggedAt: (string|null),
     * }>}
     */
    getDoseHistory(patientId, range = {}) {
      const { from, to } = range;
      const patientMeds = medications.listByPatient(patientId);
      const events = [];
      for (const med of patientMeds) {
        for (const event of doseEvents.listByMedication(med.id)) {
          if (from != null && event.scheduledTime < from) continue;
          if (to != null && event.scheduledTime > to) continue;
          events.push(event);
        }
      }

      const logs = doseLogs.listByDoseEvents(events.map((e) => e.id));
      const logByEvent = new Map(logs.map((l) => [String(l.doseEventId), l]));

      return events
        .map((event) => {
          const log = logByEvent.get(String(event.id)) ?? null;
          return {
            doseEventId: event.id,
            medicationId: event.medicationId,
            scheduledTime: event.scheduledTime,
            status: log ? log.status : null,
            loggedAt: log ? log.loggedAt : null,
          };
        })
        .sort((a, b) =>
          a.scheduledTime < b.scheduledTime
            ? -1
            : a.scheduledTime > b.scheduledTime
              ? 1
              : 0,
        );
    },

    /**
     * Whether a dose event is currently (or at `atTime`) within its patient's
     * grace period. Exposed to support the status-change rule and callers that
     * need the predicate directly.
     *
     * @param {*} patientId
     * @param {*} doseEventId
     * @param {string} [atTime] - ISO time to evaluate; defaults to `now()`.
     * @returns {boolean}
     */
    isWithinGracePeriod(patientId, doseEventId, atTime = now()) {
      const { event } = resolveOwnedEvent(patientId, doseEventId);
      return Date.parse(atTime) <= graceBoundaryMs(event, patientId);
    },
  };
}
