/**
 * AdherenceService — adherence rate/count computation over a period (task 7.1).
 *
 * Pure, framework-free domain service (no Express, no direct I/O). All storage
 * happens through injected repositories, so the computation is deterministic
 * and property-testable against the in-memory fakes.
 *
 * Behavior (design.md "AdherenceService"):
 * - `computeAdherence(patientId, period) -> Adherence_Report` — over the given
 *   period, gathers the patient's scheduled Dose_Events and their logs, then
 *   reports `adherenceRate = takenCount / scheduledCount` together with the
 *   taken count and missed count (R8.1, R8.2).
 * - When `scheduledCount === 0`, returns a distinct "no doses scheduled" report
 *   (`noDosesScheduled: true`, `adherenceRate: null`) rather than dividing by
 *   zero (R8.4).
 * - The same computation backs both the patient view and the provider view, so
 *   an assigned provider and the patient see identical rates and counts (R8.3,
 *   R6.2). Authorization for the provider path is enforced upstream by the
 *   policy layer, not here.
 *
 * Counting model: `takenCount` is the number of scheduled events in the period
 * logged as taken. Every scheduled event that is not logged as taken (logged
 * missed, or unlogged) counts against adherence, so `missedCount = scheduledCount
 * - takenCount`. This keeps `takenCount + missedCount === scheduledCount` and
 * guarantees the design invariant `adherenceRate ∈ [0, 1]` whenever
 * `scheduledCount > 0`.
 *
 * A dose event falls "within the period" when its `scheduledTime` lies in the
 * inclusive `[from, to]` window. Either bound may be omitted to leave that side
 * unbounded.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 6.2.
 */

import { DoseLogStatus } from './types.js';

/**
 * Create an AdherenceService bound to a set of repositories.
 *
 * @param {object} deps
 * @param {import('../data/interfaces.js').MedicationRepository} deps.medications
 * @param {import('../data/interfaces.js').DoseEventRepository} deps.doseEvents
 * @param {import('../data/interfaces.js').DoseLogRepository} deps.doseLogs
 * @returns {{
 *   computeAdherence: (
 *     patientId: *,
 *     period?: {from?: string, to?: string},
 *   ) => {
 *     patientId: *,
 *     period: {from: (string|null), to: (string|null)},
 *     scheduledCount: number,
 *     takenCount: number,
 *     missedCount: number,
 *     adherenceRate: (number|null),
 *     noDosesScheduled: boolean,
 *   },
 * }}
 */
export function createAdherenceService({ medications, doseEvents, doseLogs } = {}) {
  /**
   * Collect the patient's dose events whose `scheduledTime` falls within the
   * inclusive `[from, to]` window (omitted bounds are treated as unbounded).
   *
   * @param {*} patientId
   * @param {{from?: string, to?: string}} period
   * @returns {object[]}
   */
  function eventsInPeriod(patientId, { from, to }) {
    const patientMeds = medications.listByPatient(patientId);
    const events = [];
    for (const med of patientMeds) {
      for (const event of doseEvents.listByMedication(med.id)) {
        if (from != null && event.scheduledTime < from) continue;
        if (to != null && event.scheduledTime > to) continue;
        events.push(event);
      }
    }
    return events;
  }

  return {
    /**
     * Compute the Adherence_Report for a patient over a period.
     *
     * @param {*} patientId
     * @param {{from?: string, to?: string}} [period]
     * @returns {object} The Adherence_Report (see factory JSDoc for shape).
     */
    computeAdherence(patientId, period = {}) {
      const { from = null, to = null } = period;
      const events = eventsInPeriod(patientId, { from, to });
      const scheduledCount = events.length;

      // Distinct "no doses scheduled" report — never divide by zero (R8.4).
      if (scheduledCount === 0) {
        return {
          patientId,
          period: { from, to },
          scheduledCount: 0,
          takenCount: 0,
          missedCount: 0,
          adherenceRate: null,
          noDosesScheduled: true,
        };
      }

      const logs = doseLogs.listByDoseEvents(events.map((e) => e.id));
      const takenEventIds = new Set(
        logs
          .filter((log) => log.status === DoseLogStatus.TAKEN)
          .map((log) => String(log.doseEventId)),
      );

      // Count taken among scheduled events (guarding against stray logs whose
      // event is outside the period). Everything else scheduled is "missed".
      let takenCount = 0;
      for (const event of events) {
        if (takenEventIds.has(String(event.id))) takenCount += 1;
      }
      const missedCount = scheduledCount - takenCount;
      const adherenceRate = takenCount / scheduledCount;

      return {
        patientId,
        period: { from, to },
        scheduledCount,
        takenCount,
        missedCount,
        adherenceRate,
        noDosesScheduled: false,
      };
    },
  };
}
