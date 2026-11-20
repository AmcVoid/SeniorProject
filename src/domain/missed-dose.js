/**
 * Missed-dose designation rule (task 6.2).
 *
 * A pure, framework-free predicate implementing the grace-period rule from the
 * design's DoseLogService / Scheduler description:
 *
 *   A dose event is a Missed_Dose IF AND ONLY IF
 *     (a) it is unlogged, AND
 *     (b) the current time is STRICTLY GREATER than
 *         scheduledTime + gracePeriod.
 *
 * The boundary is exclusive: at exactly `scheduledTime + gracePeriod` the event
 * is NOT yet missed (the patient may still log within the grace period, per
 * R3.5). It only becomes missed once the current time passes that instant.
 *
 * This lives in `src/domain` alongside the other pure services. It is kept as a
 * dedicated module (rather than folded into DoseLogService) so it can be reused
 * by both the dose-log service and the scheduler's missed-dose detection
 * without coupling, and to avoid file conflicts with task 6.1.
 *
 * Time inputs are treated as epoch milliseconds so the rule is unit-explicit
 * and I/O-free. Callers convert their own representations (e.g. ISO strings via
 * `Date.parse`, or `gracePeriodMinutes * 60_000`) before calling.
 *
 * Requirements supported:
 * - 3.3: designate an unlogged, past-grace dose event as a Missed_Dose.
 */

/**
 * Determine whether a dose event should be designated a missed dose.
 *
 * Missed iff the event is unlogged AND the current time strictly exceeds the
 * scheduled time plus the grace period. All time values are epoch milliseconds
 * and the grace period is a non-negative duration in milliseconds.
 *
 * @param {object} params
 * @param {boolean} params.isLogged - Whether the event already has a dose log.
 * @param {number} params.scheduledTimeMs - Scheduled instant (epoch ms).
 * @param {number} params.gracePeriodMs - Grace-period duration (ms, >= 0).
 * @param {number} params.currentTimeMs - "Now" instant (epoch ms).
 * @returns {boolean} True iff the event is a Missed_Dose under the rule.
 */
export function isMissedDose({
  isLogged,
  scheduledTimeMs,
  gracePeriodMs,
  currentTimeMs,
} = {}) {
  // A logged event is never missed under this rule.
  if (isLogged) return false;

  // Guard against malformed inputs: require finite numbers and a
  // non-negative grace period. Malformed inputs are treated as "not missed"
  // so the rule never fabricates a missed designation from bad data.
  if (
    !Number.isFinite(scheduledTimeMs) ||
    !Number.isFinite(gracePeriodMs) ||
    !Number.isFinite(currentTimeMs) ||
    gracePeriodMs < 0
  ) {
    return false;
  }

  const deadline = scheduledTimeMs + gracePeriodMs;
  // Strictly greater: at exactly the deadline the event is NOT yet missed.
  return currentTimeMs > deadline;
}
