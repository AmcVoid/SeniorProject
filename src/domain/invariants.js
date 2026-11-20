/**
 * Pure invariant-validation helpers for the Medication Management System.
 *
 * These functions encode the "Key Invariants" from design.md as small,
 * side-effect-free predicates/checks. They are framework-free (no Express, no
 * I/O) so services and property tests can call them directly.
 *
 * Invariants covered here (from design.md "Key Invariants"):
 * - `Notification.attemptCount <= maxAttempts`.                        (R13.2)
 * - `Interaction_Warning` pairs are unordered and reference two distinct
 *    active medications.                                               (R7.1)
 * - `adherenceRate in [0, 1]` whenever `scheduledCount > 0`.
 * - A `Dose_Log` references exactly one `Dose_Event`; at most one active log
 *    per event.                                                        (R3.1)
 *
 * Requirements supported (foundational):
 * - 3.1, 7.1, 12.3, 13.2 (invariant enforcement primitives).
 */

import { normalizePair } from './models.js';

/**
 * Invariant: `Notification.attemptCount <= maxAttempts`.
 *
 * A notification must never record more delivery attempts than its configured
 * maximum. Also guards against negative counts / non-positive maximums, which
 * would indicate a malformed record.
 *
 * @param {{attemptCount: number, maxAttempts: number}} notification
 * @returns {boolean} True when the attempt-count invariant holds.
 */
export function isAttemptCountWithinMax(notification) {
  if (!notification) return false;
  const { attemptCount, maxAttempts } = notification;
  return (
    Number.isInteger(attemptCount) &&
    Number.isInteger(maxAttempts) &&
    attemptCount >= 0 &&
    maxAttempts >= 1 &&
    attemptCount <= maxAttempts
  );
}

/**
 * Invariant: an interaction-warning medication pair is unordered and references
 * two distinct medications.
 *
 * Distinctness is checked on the raw (non-normalized) ids; two equal ids are
 * never a valid interacting pair. Because the pair is unordered, (a, b) and
 * (b, a) are treated as the same pair.
 *
 * @param {*} medicationIdA
 * @param {*} medicationIdB
 * @returns {boolean} True when the two ids are distinct and both present.
 */
export function isValidWarningPair(medicationIdA, medicationIdB) {
  if (medicationIdA == null || medicationIdB == null) return false;
  return String(medicationIdA) !== String(medicationIdB);
}

/**
 * Compute a canonical, order-independent key for an unordered medication pair.
 * Useful for de-duplicating warnings so (a, b) and (b, a) collapse to one key.
 *
 * @param {*} medicationIdA
 * @param {*} medicationIdB
 * @returns {string} A stable key identifying the unordered pair.
 */
export function warningPairKey(medicationIdA, medicationIdB) {
  const [a, b] = normalizePair(medicationIdA, medicationIdB);
  return `${a}::${b}`;
}

/**
 * Invariant: `adherenceRate in [0, 1]` whenever `scheduledCount > 0`.
 *
 * When no doses are scheduled (`scheduledCount === 0`), there is no defined
 * rate to bound, so the guard passes (the "no doses scheduled" case is handled
 * by the adherence report itself, not by this bounds check).
 *
 * @param {number} adherenceRate
 * @param {number} scheduledCount
 * @returns {boolean} True when the adherence-rate bound holds.
 */
export function isAdherenceRateInRange(adherenceRate, scheduledCount) {
  if (!Number.isInteger(scheduledCount) || scheduledCount < 0) return false;
  if (scheduledCount === 0) return true;
  return (
    typeof adherenceRate === 'number' &&
    Number.isFinite(adherenceRate) &&
    adherenceRate >= 0 &&
    adherenceRate <= 1
  );
}

/**
 * Invariant: at most one active log per dose event.
 *
 * A `Dose_Log` references exactly one `Dose_Event`; a given event may carry at
 * most one active (current) log. This checks a collection of logs for a single
 * event and returns true when zero or one active log is present.
 *
 * @param {Array<{doseEventId: *}>} logsForEvent - Active logs referencing one event.
 * @returns {boolean} True when at most one active log exists for the event.
 */
export function hasAtMostOneActiveLog(logsForEvent) {
  if (!Array.isArray(logsForEvent)) return false;
  return logsForEvent.length <= 1;
}

/**
 * Invariant helper: verify that a set of active logs holds the "at most one
 * active log per event" invariant across every event id it touches.
 *
 * @param {Array<{doseEventId: *}>} activeLogs
 * @returns {boolean} True when no dose event has more than one active log.
 */
export function hasAtMostOneActiveLogPerEvent(activeLogs) {
  if (!Array.isArray(activeLogs)) return false;
  const seen = new Set();
  for (const log of activeLogs) {
    if (!log || log.doseEventId == null) return false;
    const key = String(log.doseEventId);
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}
