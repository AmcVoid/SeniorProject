/**
 * ScheduleService — pure schedule expansion for the Medication Management System.
 *
 * This module contains the single pure function `generateDoseEvents`, which
 * expands a medication's embedded `Schedule` (times-of-day + recurrence rule +
 * start/optional end) into concrete `Dose_Event` records that fall inside a
 * requested time window. It is framework-free: no Express, no I/O, no clock —
 * the caller supplies the window explicitly, so the function is deterministic
 * given its inputs (design.md "ScheduleService": deterministic given inputs).
 *
 * Design references (design.md):
 * - `generateDoseEvents(medication, window) -> Dose_Event[]` expands a Schedule
 *   (times + recurrence rule) into concrete Dose_Events within a time window
 *   (R1.6). Deterministic given inputs.
 * - Schedule = `times` (times-of-day), `recurrence` (daily / specific weekdays /
 *   interval), `startDate`, optional `endDate`.
 * - Dose_Event = `id`, `medicationId`, `scheduledTime`, `status`.
 * - Key Invariant: a Dose_Event.scheduledTime always lies within its
 *   medication's schedule window.
 * - Error handling: invalid windows (end before start) yield an empty event
 *   set; regeneration is idempotent for a given medication + window.
 *
 * Idempotency: each generated event carries a deterministic `id` derived from
 * the medication id and the event's scheduled time. Re-running the expansion
 * for the same medication + window therefore yields byte-for-byte identical
 * events (same ids, same order), so a repository keyed by id can upsert without
 * creating duplicates.
 *
 * Requirements supported:
 * - 1.6: defining a Schedule generates the corresponding Dose_Events.
 */

import { createDoseEvent } from './models.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Weekday name -> JS `Date.getDay()` index (0 = Sunday).
 * Accepts full names and common three-letter abbreviations, case-insensitive.
 */
const WEEKDAY_INDEX = Object.freeze({
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
});

/**
 * Expand a medication's schedule into concrete Dose_Events within a window.
 *
 * The window is inclusive on both ends: an event whose scheduled time equals
 * `window.start` or `window.end` is included. Events are also clamped to the
 * schedule's own `startDate`/`endDate` (a Dose_Event never lies outside its
 * medication's schedule window). The result is sorted ascending by scheduled
 * time (ties broken by the order of `schedule.times`).
 *
 * Times of day (e.g. `"08:00"`) are wall-clock times in the server's local
 * time zone (`process.env.TZ`, else the OS zone), and days are local calendar
 * days. The returned `scheduledTime` values are UTC ISO-8601 instants.
 *
 * Supported recurrence forms (from design.md "Schedule"):
 * - `daily` (default): every calendar day in range.
 * - specific weekdays: `recurrence === 'weekdays'` with `schedule.daysOfWeek`
 *   (array of weekday names/indices), or `recurrence` itself set to an array of
 *   weekday names/indices. Only the named weekdays are generated.
 * - interval: `recurrence === 'interval'` (or `'everyNDays'`) with
 *   `schedule.intervalDays >= 1` — every Nth day counting from the schedule's
 *   start date.
 *
 * Invalid or unusable inputs yield an empty array (never throws):
 * - `window.end` strictly before `window.start`.
 * - missing medication / schedule / times, or an empty `times` list.
 * - a recurrence rule that matches no day (e.g. empty weekday set,
 *   non-positive interval).
 *
 * @param {object} medication - A Medication record ({@link createMedication}).
 *   Must carry `id` and an embedded `schedule`.
 * @param {{start: (string|Date), end: (string|Date)}} window - Inclusive time
 *   window to expand into. Accepts ISO-8601 strings or Date objects.
 * @returns {object[]} Deterministically ordered Dose_Event records; empty when
 *   inputs are invalid or nothing falls in range.
 */
export function generateDoseEvents(medication, window) {
  if (!medication || !window) return [];

  const schedule = medication.schedule;
  if (!schedule || !Array.isArray(schedule.times) || schedule.times.length === 0) {
    return [];
  }

  const windowStart = toDate(window.start);
  const windowEnd = toDate(window.end);
  if (windowStart == null || windowEnd == null) return [];

  // Invalid window: end strictly before start yields an empty set (R error handling).
  if (windowEnd.getTime() < windowStart.getTime()) return [];

  // Clamp the effective range to the schedule's own start/optional end.
  const scheduleStart = toDate(schedule.startDate);
  const scheduleEnd = toDate(schedule.endDate); // optional; null when absent

  let rangeStart = windowStart;
  if (scheduleStart != null && scheduleStart.getTime() > rangeStart.getTime()) {
    rangeStart = scheduleStart;
  }
  let rangeEnd = windowEnd;
  if (scheduleEnd != null && scheduleEnd.getTime() < rangeEnd.getTime()) {
    rangeEnd = scheduleEnd;
  }
  if (rangeEnd.getTime() < rangeStart.getTime()) return [];

  // Parse the times-of-day once; skip any malformed entries.
  const parsedTimes = schedule.times
    .map((t) => parseTimeOfDay(t))
    .filter((t) => t != null);
  if (parsedTimes.length === 0) return [];

  const recurrence = resolveRecurrence(schedule);
  // A day anchor for interval recurrence: the schedule start, else the window start.
  const intervalAnchor = scheduleStart != null ? scheduleStart : windowStart;

  const events = [];
  // Iterate local calendar days (the server's time zone) from the day
  // containing rangeStart to rangeEnd. Times of day like "08:00" are wall-clock
  // times in that zone. Days advance by calendar date, not by 24 hours, so
  // daylight-saving transitions do not shift dose times.
  let day = startOfLocalDay(rangeStart);
  const lastDay = startOfLocalDay(rangeEnd);
  while (day.getTime() <= lastDay.getTime()) {
    if (dayMatchesRecurrence(day, recurrence, intervalAnchor)) {
      for (const { hours, minutes } of parsedTimes) {
        const scheduled = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes, 0, 0);
        const t = scheduled.getTime();
        // Inclusive window bounds, respecting the clamped schedule range.
        if (t >= rangeStart.getTime() && t <= rangeEnd.getTime()) {
          const scheduledTime = scheduled.toISOString();
          events.push(
            createDoseEvent({
              id: doseEventId(medication.id, scheduledTime),
              medicationId: medication.id,
              scheduledTime,
            }),
          );
        }
      }
    }
    day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  }

  // Deterministic order: ascending by scheduled time.
  events.sort((a, b) => (a.scheduledTime < b.scheduledTime ? -1 : a.scheduledTime > b.scheduledTime ? 1 : 0));
  return events;
}

/**
 * Build a deterministic Dose_Event id from the medication id and scheduled time.
 * Stable across regenerations so idempotent expansion produces identical ids.
 *
 * @param {*} medicationId
 * @param {string} scheduledTimeIso
 * @returns {string}
 */
export function doseEventId(medicationId, scheduledTimeIso) {
  return `${medicationId}@${scheduledTimeIso}`;
}

/**
 * Normalize a schedule's recurrence into a structured descriptor.
 *
 * @param {object} schedule
 * @returns {{kind: string, days?: Set<number>, intervalDays?: number}}
 */
function resolveRecurrence(schedule) {
  const rec = schedule.recurrence;

  // recurrence provided directly as a list of weekdays.
  if (Array.isArray(rec)) {
    return { kind: 'weekdays', days: toWeekdaySet(rec) };
  }

  const kind = typeof rec === 'string' ? rec.toLowerCase() : 'daily';

  if (kind === 'weekdays' || kind === 'weekly') {
    return { kind: 'weekdays', days: toWeekdaySet(schedule.daysOfWeek) };
  }

  if (kind === 'interval' || kind === 'everyndays') {
    const n = Number(schedule.intervalDays);
    return { kind: 'interval', intervalDays: Number.isInteger(n) && n >= 1 ? n : 0 };
  }

  // Default and unknown recurrences fall back to daily.
  return { kind: 'daily' };
}

/**
 * Decide whether a given local calendar day matches the recurrence rule.
 *
 * @param {Date} day - Start-of-local-day date.
 * @param {{kind: string, days?: Set<number>, intervalDays?: number}} recurrence
 * @param {Date} intervalAnchor - Anchor day for interval counting.
 * @returns {boolean}
 */
function dayMatchesRecurrence(day, recurrence, intervalAnchor) {
  switch (recurrence.kind) {
    case 'daily':
      return true;
    case 'weekdays':
      return recurrence.days.size > 0 && recurrence.days.has(day.getDay());
    case 'interval': {
      if (!recurrence.intervalDays || recurrence.intervalDays < 1) return false;
      const diffDays = calendarDaysBetween(startOfLocalDay(intervalAnchor), day);
      return diffDays >= 0 && diffDays % recurrence.intervalDays === 0;
    }
    default:
      return false;
  }
}

/**
 * Convert a list of weekday names/indices into a Set of day indices (0=Sun).
 *
 * @param {Array<string|number>|undefined} days
 * @returns {Set<number>}
 */
function toWeekdaySet(days) {
  const set = new Set();
  if (!Array.isArray(days)) return set;
  for (const d of days) {
    if (typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6) {
      set.add(d);
    } else if (typeof d === 'string') {
      const idx = WEEKDAY_INDEX[d.trim().toLowerCase()];
      if (idx != null) set.add(idx);
    }
  }
  return set;
}

/**
 * Parse a "HH:MM" (or "HH:MM:SS") time-of-day string into hours/minutes.
 * Returns null for malformed or out-of-range values.
 *
 * @param {string} value
 * @returns {{hours: number, minutes: number}|null}
 */
function parseTimeOfDay(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

/**
 * Coerce an ISO-8601 string or Date into a valid Date, or null.
 *
 * @param {string|Date|null|undefined} value
 * @returns {Date|null}
 */
function toDate(value) {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Return a new Date at local midnight of the same local calendar day.
 *
 * @param {Date} date
 * @returns {Date}
 */
function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Whole calendar days from `a` to `b` (local dates), unaffected by DST.
 *
 * @param {Date} a
 * @param {Date} b
 * @returns {number}
 */
function calendarDaysBetween(a, b) {
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((ub - ua) / MS_PER_DAY);
}
