/**
 * Scheduler / Worker — the periodic tick that drives time-based behavior for
 * the Medication Management System.
 *
 * This module is framework-free: it contains NO Express, NO HTTP, NO live
 * timer, and NO direct I/O. Storage is delegated to injected repositories, the
 * current time is delegated to an injected `clock`, and delivery is delegated
 * to the injected {@link module:notifications/dispatcher.createNotificationDispatcher}.
 * The `tick` itself is a pure, synchronous function of its injected
 * dependencies plus "now", so it can be unit- and property-tested directly
 * without waiting on a real timer.
 *
 * This task (15.1) implements the *due-reminder* pass:
 * - On each tick, atomically CLAIM the due, pending `Dose_Event`s within the
 *   configured due window and dispatch exactly one dose reminder per claimed
 *   event (R2.1, R13.1).
 * - Overlapping ticks MUST NOT double-send: claiming stamps a `reminderSentAt`
 *   marker on the event, and the claim query skips events already stamped, so
 *   a second tick over the same window claims nothing.
 *
 * Design reference (design.md "Scheduler / Worker", "Concurrency"):
 * - "claim `Dose_Event`s whose scheduled time has arrived and dispatch dose
 *   reminders within 60s (R2.1, R13.1)."
 * - "Due-event claiming in the scheduler uses an atomic claim (status
 *   transition) so overlapping ticks do not double-send reminders."
 *
 * On the claim marker: the `Dose_Event` lifecycle status (`pending` | `taken`
 * | `missed`) reflects the *adherence* outcome, which stays `pending` until the
 * patient logs the dose or it is designated missed (task 15.2). Sending a
 * reminder does not change that outcome, so the claim is recorded on a separate
 * `reminderSentAt` field rather than by overloading `status`. This keeps the
 * status semantics intact for 15.2 (follow-up / missed-dose / refill) which is
 * layered on top of this same tick via `createScheduler`.
 *
 * Requirements supported: 2.1, 13.1 (and 2.2/2.4 via the reminder payload and
 * the dispatcher's channel selection).
 *
 * Task 15.2 layers three further passes onto the same `tick()`:
 * - Follow-up reminders (R2.3): for events still unlogged once the grace period
 *   has elapsed, send exactly one follow-up dose reminder. A `followUpSentAt`
 *   marker guarantees it fires at most once per event.
 * - Missed-dose detection (R3.3, R4.1, R4.3, R4.4): designate unlogged
 *   past-grace events as `missed` (recording the missed dose regardless of
 *   caregivers) and, subject to the medication's `caregiverAlertsEnabled` flag,
 *   alert each active (non-suppressed) caregiver designated by the patient.
 * - Refill checks (R5.1, R5.3): when a medication's remaining supply is at or
 *   below its refill threshold, dispatch a refill reminder to the patient and,
 *   when `caregiverRefillNotificationsEnabled`, to each active caregiver. A
 *   `refillReminderSentAt` marker avoids re-sending every tick until the supply
 *   rises back above the threshold.
 *
 * The grace period is per-patient (`patient.gracePeriodMinutes`); the scheduler
 * resolves it through an injected patients lookup so it stays repository-driven
 * and free of I/O.
 */

import { DoseEventStatus, DoseLogStatus, NotificationType } from '../domain/types.js';
import { createNotification, createDoseLog } from '../domain/models.js';
import {
  buildDoseReminderPayload,
  buildMissedDoseAlertPayload,
  buildRefillReminderPayload,
} from '../notifications/payloads.js';
import { isMissedDose } from '../domain/missed-dose.js';
import { isRefillDue, shouldNotifyCaregiversForRefill } from '../domain/refill.js';

/** Default periodic tick interval (ms). Must stay <= 60s to satisfy R13.1. */
export const DEFAULT_TICK_INTERVAL_MS = 30_000;

/** Hard upper bound on the tick interval imposed by R13.1 (60 seconds). */
export const MAX_TICK_INTERVAL_MS = 60_000;

/**
 * Default lookback window (ms) used to find events that became due since the
 * previous tick. It spans a couple of tick intervals so a briefly delayed or
 * skipped tick still catches recently-due events without re-sending older ones.
 */
export const DEFAULT_DUE_WINDOW_MS = 90_000;

/**
 * Normalize a tick interval to a positive integer no greater than the R13.1
 * bound. A malformed/oversized value is clamped rather than rejected so the
 * scheduler always runs frequently enough to meet the timeliness guarantee.
 *
 * @param {number} intervalMs
 * @returns {number} A tick interval in `(0, MAX_TICK_INTERVAL_MS]`.
 */
export function normalizeTickIntervalMs(intervalMs) {
  const n = Number(intervalMs);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TICK_INTERVAL_MS;
  return Math.min(Math.trunc(n), MAX_TICK_INTERVAL_MS);
}

/**
 * Compute the inclusive `[from, to]` due window (as ISO strings) for a tick
 * taken at `now`. Events scheduled within this window and not yet reminded are
 * the ones to claim.
 *
 * @param {Date} now
 * @param {number} dueWindowMs - How far back to look for newly-due events.
 * @returns {{ from: string, to: string }}
 */
function computeDueWindow(now, dueWindowMs) {
  const to = now.toISOString();
  const from = new Date(now.getTime() - dueWindowMs).toISOString();
  return { from, to };
}

/**
 * Resolve "now" from an injected clock. The clock may be a function returning a
 * `Date` or an ISO string, or an object exposing `now()`. Falls back to the
 * real time when no clock is supplied (production wiring).
 *
 * @param {(undefined | (() => (Date|string)) | { now: () => (Date|string) })} clock
 * @returns {Date}
 */
function resolveNow(clock) {
  let value;
  if (typeof clock === 'function') value = clock();
  else if (clock && typeof clock.now === 'function') value = clock.now();
  else value = new Date();
  return value instanceof Date ? value : new Date(value);
}

/**
 * Atomically claim the due, pending, not-yet-reminded dose events in the given
 * window and dispatch exactly one dose reminder for each.
 *
 * "Atomic" here means the claim (stamping `reminderSentAt`) happens before the
 * dispatch and is guarded by re-reading the event's current state, so if two
 * ticks overlap only the first claims a given event; the second observes the
 * marker and skips it. This yields at-most-once dispatch per event (R13.1) and
 * at-least-once per due event across ticks (R2.1).
 *
 * @param {object} deps
 * @param {import('../data/interfaces.js').DoseEventRepository} deps.doseEventRepository
 * @param {import('../data/interfaces.js').MedicationRepository} deps.medicationRepository
 * @param {{ dispatch: (n: object) => object }} deps.dispatcher
 * @param {import('../data/interfaces.js').MemoryNoteRepository} [deps.noteRepository]
 *   Optional; when present, the newest memory note for the medication is
 *   included in the reminder payload (R2.2 / R10.5).
 * @param {(medication: object) => (string|null|undefined)} [deps.resolveReminderChannel]
 *   Optional; resolves the patient's preferred reminder channel for a
 *   medication (R2.4). When omitted, the dispatcher's own channel selection
 *   (notification.channel / its resolveChannel / default) applies.
 * @param {number} [deps.maxAttempts] - Delivery attempts per reminder (R13.2).
 * @param {Date} now
 * @param {number} dueWindowMs
 * @returns {{ from: string, to: string, claimed: object[], dispatched: object[] }}
 *   The window used, the events claimed this tick, and the dispatch results.
 */
function runDueReminderPass(deps, now, dueWindowMs) {
  const {
    doseEventRepository,
    medicationRepository,
    dispatcher,
    noteRepository = null,
    resolveReminderChannel = null,
    maxAttempts = 3,
  } = deps;

  const { from, to } = computeDueWindow(now, dueWindowMs);
  const nowIso = now.toISOString();

  const candidates = doseEventRepository
    .listDueBetween(from, to)
    .filter((event) => isClaimable(event));

  const claimed = [];
  const dispatched = [];

  for (const candidate of candidates) {
    // Re-read and guard against a concurrent/overlapping tick having already
    // claimed this event between the list and the update (atomic claim).
    const current = doseEventRepository.getById(candidate.id);
    if (!isClaimable(current)) continue;

    const stamped = doseEventRepository.update(current.id, { reminderSentAt: nowIso });
    // If the update raced away (event removed), skip rather than double-send.
    if (!stamped) continue;
    claimed.push(stamped);

    const result = dispatchDoseReminder(
      { medicationRepository, dispatcher, noteRepository, resolveReminderChannel, maxAttempts },
      stamped,
    );
    dispatched.push(result);
  }

  return { from, to, claimed, dispatched };
}

/**
 * An event is claimable for a due reminder when it is still pending (adherence
 * outcome not yet recorded) and has not already had a reminder sent.
 *
 * @param {object|null} event
 * @returns {boolean}
 */
function isClaimable(event) {
  return Boolean(
    event &&
      event.status === DoseEventStatus.PENDING &&
      event.reminderSentAt == null,
  );
}

/**
 * Build and dispatch a single dose reminder for a claimed event.
 *
 * @param {object} deps
 * @param {object} event - The claimed Dose_Event.
 * @returns {{ event: object, dispatch: (object|null), skipped?: string }}
 */
function dispatchDoseReminder(deps, event) {
  const { medicationRepository, dispatcher, noteRepository, resolveReminderChannel, maxAttempts } =
    deps;

  const medication = medicationRepository.getById(event.medicationId);
  // A dose event should always reference a medication; if it does not, there is
  // nothing to remind about. Record the skip rather than throwing so one bad
  // event does not abort the whole tick.
  if (!medication) {
    return { event, dispatch: null, skipped: 'medication-not-found' };
  }

  const memoryNote = newestMemoryNote(noteRepository, medication.id);
  const payload = buildDoseReminderPayload({
    medication,
    scheduledTime: event.scheduledTime,
    memoryNote,
  });

  const channel =
    typeof resolveReminderChannel === 'function' ? resolveReminderChannel(medication) : null;

  const notification = createNotification({
    type: payload.type,
    recipientRef: medication.patientId,
    channel: channel ?? null,
    payload,
    maxAttempts,
  });

  const dispatch = dispatcher.dispatch(notification);
  return { event, dispatch };
}

/**
 * Return the most recent memory note text for a medication, or null. Uses
 * `updatedAt`/`createdAt` ordering when available, else insertion order.
 *
 * @param {import('../data/interfaces.js').MemoryNoteRepository|null} noteRepository
 * @param {*} medicationId
 * @returns {(object|null)}
 */
function newestMemoryNote(noteRepository, medicationId) {
  if (!noteRepository || typeof noteRepository.listByMedication !== 'function') return null;
  const notes = noteRepository.listByMedication(medicationId) ?? [];
  if (notes.length === 0) return null;
  return notes.reduce((newest, note) => {
    const a = note.updatedAt ?? note.createdAt ?? '';
    const b = newest.updatedAt ?? newest.createdAt ?? '';
    return a >= b ? note : newest;
  });
}

// ---------------------------------------------------------------------------
// Task 15.2 — follow-up, missed-dose, and refill passes.
// ---------------------------------------------------------------------------

/** Default grace period (minutes) used when a patient has none configured. */
const DEFAULT_GRACE_PERIOD_MINUTES = 0;

/**
 * Resolve the grace period (in milliseconds) that applies to a dose event, by
 * looking up the owning medication's patient through the injected lookup.
 *
 * The lookup may be a repository exposing `getById`, or a plain function of the
 * patient id. A missing patient falls back to a zero grace period so an event
 * is treated as past-grace as soon as its scheduled time passes.
 *
 * @param {(undefined|null|{getById: (id:*) => object}|((id:*) => object))} patients
 * @param {*} patientId
 * @returns {number} Grace period in milliseconds (>= 0).
 */
function resolveGracePeriodMs(patients, patientId) {
  const patient = lookupPatient(patients, patientId);
  const minutes = Number(patient?.gracePeriodMinutes);
  const safeMinutes = Number.isFinite(minutes) && minutes >= 0
    ? minutes
    : DEFAULT_GRACE_PERIOD_MINUTES;
  return safeMinutes * 60_000;
}

/**
 * Look up a patient through an injected repository (`getById`) or function.
 *
 * @param {(undefined|null|{getById: (id:*) => object}|((id:*) => object))} patients
 * @param {*} patientId
 * @returns {(object|null)}
 */
function lookupPatient(patients, patientId) {
  if (!patients || patientId == null) return null;
  if (typeof patients === 'function') return patients(patientId) ?? null;
  if (typeof patients.getById === 'function') return patients.getById(patientId) ?? null;
  return null;
}

/**
 * Whether a dose event is unlogged (no Dose_Log recorded for it yet). When no
 * dose-log repository is injected, an event is treated as unlogged (its
 * lifecycle `status` still gates the missed/follow-up passes).
 *
 * @param {(import('../data/interfaces.js').DoseLogRepository|null)} doseLogRepository
 * @param {*} doseEventId
 * @returns {boolean}
 */
function isEventUnlogged(doseLogRepository, doseEventId) {
  if (!doseLogRepository || typeof doseLogRepository.getByDoseEvent !== 'function') {
    return true;
  }
  return doseLogRepository.getByDoseEvent(doseEventId) == null;
}

/**
 * Whether an unlogged event is past its grace period at `now`, using the pure
 * {@link isMissedDose} rule (boundary exclusive: at exactly scheduled+grace it
 * is not yet past).
 *
 * @param {object} event
 * @param {number} gracePeriodMs
 * @param {Date} now
 * @returns {boolean}
 */
function isPastGrace(event, gracePeriodMs, now) {
  const scheduledMs = Date.parse(event.scheduledTime);
  if (!Number.isFinite(scheduledMs)) return false;
  return isMissedDose({
    isLogged: false,
    scheduledTimeMs: scheduledMs,
    gracePeriodMs,
    currentTimeMs: now.getTime(),
  });
}

/**
 * Follow-up reminder pass (R2.3).
 *
 * For each pending, still-unlogged event whose grace period has elapsed and
 * that already received its initial reminder but not a follow-up, send exactly
 * one follow-up dose reminder to the patient and stamp `followUpSentAt` so it
 * never fires again.
 *
 * @param {object} deps
 * @param {Date} now
 * @param {{from: string, to: string}} window
 * @returns {{ sent: object[] }}
 */
function runFollowUpPass(deps, now, window) {
  const {
    doseEventRepository,
    medicationRepository,
    patients,
    dispatcher,
    noteRepository,
    resolveReminderChannel,
    maxAttempts,
  } = deps;

  const nowIso = now.toISOString();
  const sent = [];

  for (const candidate of pendingUnloggedEvents(deps, window)) {
    if (candidate.followUpSentAt != null) continue;
    // Only a follow-up to an already-sent reminder; skip events never reminded.
    if (candidate.reminderSentAt == null) continue;
    // Never a follow-up in the same tick the initial reminder was sent: the
    // follow-up is the *second* nudge, fired on a later tick once the grace
    // period has elapsed. (With a zero grace period the past-grace condition
    // would otherwise coincide with the initial claim.)
    if (candidate.reminderSentAt >= nowIso) continue;

    const medication = medicationRepository.getById(candidate.medicationId);
    if (!medication) continue;

    const gracePeriodMs = resolveGracePeriodMs(patients, medication.patientId);
    if (!isPastGrace(candidate, gracePeriodMs, now)) continue;

    // Re-read and guard so overlapping ticks send at most one follow-up.
    const current = doseEventRepository.getById(candidate.id);
    if (!current || current.status !== DoseEventStatus.PENDING || current.followUpSentAt != null) {
      continue;
    }
    const stamped = doseEventRepository.update(current.id, { followUpSentAt: nowIso });
    if (!stamped) continue;

    const memoryNote = newestMemoryNote(noteRepository, medication.id);
    const payload = buildDoseReminderPayload({
      medication,
      scheduledTime: stamped.scheduledTime,
      memoryNote,
    });
    const channel =
      typeof resolveReminderChannel === 'function' ? resolveReminderChannel(medication) : null;
    const notification = createNotification({
      type: payload.type,
      recipientRef: medication.patientId,
      channel: channel ?? null,
      payload,
      maxAttempts,
    });
    const dispatch = dispatcher.dispatch(notification);
    sent.push({ event: stamped, dispatch });
  }

  return { sent };
}

/**
 * Missed-dose detection pass (R3.3, R4.1, R4.3, R4.4).
 *
 * Designate each pending, unlogged, past-grace event as `missed` — recording
 * the missed dose (status transition + Dose_Log) REGARDLESS of caregivers — and
 * then, subject to the medication's `caregiverAlertsEnabled` flag, alert each
 * active caregiver designated by the patient. The status transition off
 * `pending` is the once-only marker: a re-designated event is no longer a
 * candidate on the next tick.
 *
 * @param {object} deps
 * @param {Date} now
 * @param {{from: string, to: string}} window
 * @returns {{ missed: object[], alerts: object[] }}
 */
function runMissedDosePass(deps, now, window) {
  const {
    doseEventRepository,
    doseLogRepository,
    medicationRepository,
    caregiverContactRepository,
    patients,
    dispatcher,
    maxAttempts,
  } = deps;

  const nowIso = now.toISOString();
  const missed = [];
  const alerts = [];

  for (const candidate of pendingUnloggedEvents(deps, window)) {
    const medication = medicationRepository.getById(candidate.medicationId);
    if (!medication) continue;

    const gracePeriodMs = resolveGracePeriodMs(patients, medication.patientId);
    if (!isPastGrace(candidate, gracePeriodMs, now)) continue;
    // Do not designate missed in the same tick the initial reminder was sent:
    // the patient must be given until a later tick (past the grace period) to
    // log the dose. With a zero grace period the past-grace condition would
    // otherwise coincide with the initial claim.
    if (candidate.reminderSentAt != null && candidate.reminderSentAt >= nowIso) continue;

    // Re-read and guard against a concurrent tick having already designated it.
    const current = doseEventRepository.getById(candidate.id);
    if (!current || current.status !== DoseEventStatus.PENDING) continue;

    const designated = doseEventRepository.update(current.id, {
      status: DoseEventStatus.MISSED,
    });
    if (!designated) continue;

    // Record the missed dose regardless of caregivers (R4.3): create a
    // Dose_Log when one is not already present and a repository is available.
    if (doseLogRepository && typeof doseLogRepository.getByDoseEvent === 'function') {
      if (doseLogRepository.getByDoseEvent(designated.id) == null) {
        doseLogRepository.insert(
          createDoseLog({
            doseEventId: designated.id,
            status: DoseLogStatus.MISSED,
            loggedAt: nowIso,
          }),
        );
      }
    }
    missed.push(designated);

    // Caregiver alerts (R4.1) are suppressed per-medication (R4.4) and reach an
    // empty set when the patient designates no active caregiver (R4.3).
    if (medication.caregiverAlertsEnabled !== true) continue;

    const caregivers = activeCaregivers(caregiverContactRepository, medication.patientId);
    const patient = lookupPatient(patients, medication.patientId);
    for (const caregiver of caregivers) {
      const payload = buildMissedDoseAlertPayload({
        patient: patient ?? medication.patientId,
        medication,
        scheduledTime: designated.scheduledTime,
      });
      const notification = createNotification({
        type: payload.type,
        recipientRef: caregiver.id,
        channel: caregiver.channelPreference ?? null,
        payload,
        maxAttempts,
      });
      const dispatch = dispatcher.dispatch(notification);
      alerts.push({ event: designated, caregiver, dispatch });
    }
  }

  return { missed, alerts };
}

/**
 * Refill-check pass (R5.1, R5.3).
 *
 * For each active medication whose remaining supply is at or below its refill
 * threshold and that has not yet been reminded at the current low-supply level,
 * dispatch a refill reminder to the patient and, when
 * `caregiverRefillNotificationsEnabled`, to each active caregiver. A
 * `refillReminderSentAt` marker prevents re-sending on every subsequent tick;
 * `recordRefill` (task 14.1) clears it implicitly by raising the supply above
 * the threshold, and callers may clear the marker on refill so a later low
 * supply reminds again.
 *
 * @param {object} deps
 * @param {Date} now
 * @returns {{ reminders: object[] }}
 */
function runRefillPass(deps, now) {
  const {
    medicationRepository,
    caregiverContactRepository,
    dispatcher,
    maxAttempts,
  } = deps;

  const nowIso = now.toISOString();
  const reminders = [];

  for (const medication of refillCandidates(deps)) {
    if (!isRefillDue({
      remainingSupply: medication.remainingSupply,
      refillThreshold: medication.refillThreshold,
    })) {
      continue;
    }
    // Fire once per low-supply episode: skip if already reminded and not refilled.
    if (medication.refillReminderSentAt != null) continue;

    const stamped =
      medicationRepository.update(medication.id, { refillReminderSentAt: nowIso }) ?? medication;

    const payload = buildRefillReminderPayload({ medication: stamped });

    const patientNotification = createNotification({
      type: payload.type,
      recipientRef: stamped.patientId,
      channel: null,
      payload,
      maxAttempts,
    });
    const patientDispatch = dispatcher.dispatch(patientNotification);
    reminders.push({ medication: stamped, recipient: 'patient', dispatch: patientDispatch });

    if (shouldNotifyCaregiversForRefill(stamped)) {
      const caregivers = activeCaregivers(caregiverContactRepository, stamped.patientId);
      for (const caregiver of caregivers) {
        const notification = createNotification({
          type: payload.type,
          recipientRef: caregiver.id,
          channel: caregiver.channelPreference ?? null,
          payload,
          maxAttempts,
        });
        const dispatch = dispatcher.dispatch(notification);
        reminders.push({ medication: stamped, recipient: 'caregiver', caregiver, dispatch });
      }
    }
  }

  return { reminders };
}

/**
 * The pending, still-unlogged dose events in the current due window, shared by
 * the follow-up and missed-dose passes.
 *
 * @param {object} deps
 * @param {{from: string, to: string}} window
 * @returns {object[]}
 */
function pendingUnloggedEvents(deps, window) {
  const { doseEventRepository, doseLogRepository } = deps;
  return doseEventRepository
    .listDueBetween(window.from, window.to)
    .filter(
      (event) =>
        event.status === DoseEventStatus.PENDING &&
        isEventUnlogged(doseLogRepository, event.id),
    );
}

/**
 * The active caregivers designated for a patient, or an empty array when none
 * / no repository is available (R4.3 empty-set handling).
 *
 * @param {(import('../data/interfaces.js').CaregiverContactRepository|null)} caregiverContactRepository
 * @param {*} patientId
 * @returns {object[]}
 */
function activeCaregivers(caregiverContactRepository, patientId) {
  if (
    !caregiverContactRepository ||
    typeof caregiverContactRepository.listActiveByPatient !== 'function'
  ) {
    return [];
  }
  return caregiverContactRepository.listActiveByPatient(patientId) ?? [];
}

/**
 * The active medications to evaluate for a refill. When explicit `patientIds`
 * are configured, only those patients' active medications are considered;
 * otherwise every stored medication is scanned (in-memory scope). Falls back to
 * scanning `list()` when the repository does not expose a patient-scoped query.
 *
 * @param {object} deps
 * @returns {object[]}
 */
function refillCandidates(deps) {
  const { medicationRepository, patientIds } = deps;

  if (Array.isArray(patientIds) && patientIds.length > 0) {
    const seen = new Set();
    const out = [];
    for (const patientId of patientIds) {
      const meds =
        typeof medicationRepository.listActiveByPatient === 'function'
          ? medicationRepository.listActiveByPatient(patientId)
          : [];
      for (const med of meds) {
        if (!seen.has(String(med.id))) {
          seen.add(String(med.id));
          out.push(med);
        }
      }
    }
    return out;
  }

  if (typeof medicationRepository.list === 'function') {
    return medicationRepository.list().filter((m) => m.active === true);
  }
  return [];
}

/**
 * Create a scheduler bound to its dependencies.
 *
 * The returned object exposes:
 * - `tick()` — run one pass at the clock's current time. Pure with respect to
 *   its injected dependencies (no timer); returns a summary of what was claimed
 *   and dispatched so tests can assert on it. Task 15.2 extends the tick with
 *   follow-up / missed-dose / refill passes; those layer onto this same entry
 *   point so a single `tick()` drives all time-based behavior.
 * - `intervalMs` — the configured periodic interval, clamped to <= 60s (R13.1).
 *
 * @param {object} deps
 * @param {import('../data/interfaces.js').DoseEventRepository} deps.doseEventRepository
 * @param {import('../data/interfaces.js').MedicationRepository} deps.medicationRepository
 * @param {{ dispatch: (n: object) => object }} deps.dispatcher
 * @param {import('../data/interfaces.js').MemoryNoteRepository} [deps.noteRepository]
 * @param {(undefined | (() => (Date|string)) | { now: () => (Date|string) })} [deps.clock]
 *   Injectable clock; defaults to the real time.
 * @param {(medication: object) => (string|null|undefined)} [deps.resolveReminderChannel]
 * @param {number} [deps.intervalMs] - Periodic interval; clamped to <= 60s.
 * @param {number} [deps.dueWindowMs] - Lookback window for newly-due events.
 * @param {number} [deps.maxAttempts] - Delivery attempts per reminder.
 * @returns {{ tick: () => object, intervalMs: number }}
 */
export function createScheduler({
  doseEventRepository,
  medicationRepository,
  dispatcher,
  noteRepository = null,
  doseLogRepository = null,
  caregiverContactRepository = null,
  patients = null,
  patientIds = null,
  clock = undefined,
  resolveReminderChannel = null,
  intervalMs = DEFAULT_TICK_INTERVAL_MS,
  dueWindowMs = DEFAULT_DUE_WINDOW_MS,
  maxAttempts = 3,
} = {}) {
  if (!doseEventRepository) throw new Error('createScheduler requires a doseEventRepository');
  if (!medicationRepository) throw new Error('createScheduler requires a medicationRepository');
  if (!dispatcher || typeof dispatcher.dispatch !== 'function') {
    throw new Error('createScheduler requires a dispatcher with a dispatch() method');
  }

  const normalizedInterval = normalizeTickIntervalMs(intervalMs);
  const window = Number.isFinite(Number(dueWindowMs)) && Number(dueWindowMs) > 0
    ? Math.trunc(Number(dueWindowMs))
    : DEFAULT_DUE_WINDOW_MS;

  const deps = {
    doseEventRepository,
    medicationRepository,
    dispatcher,
    noteRepository,
    doseLogRepository,
    caregiverContactRepository,
    patients,
    patientIds,
    resolveReminderChannel,
    maxAttempts,
  };

  function tick() {
    const now = resolveNow(clock);
    const dueWindow = computeDueWindow(now, window);

    // Due reminders run first (initial send + claim marker), so that within the
    // same tick a just-claimed event is not also treated as "past grace with a
    // reminder already sent" — the follow-up/missed passes only act once the
    // grace period has elapsed, which is a later tick than the initial claim.
    const dueReminders = runDueReminderPass(deps, now, window);
    const followUps = runFollowUpPass(deps, now, dueWindow);
    const missedDoses = runMissedDosePass(deps, now, dueWindow);
    const refills = runRefillPass(deps, now);

    return {
      now: now.toISOString(),
      dueReminders,
      followUps,
      missedDoses,
      refills,
    };
  }

  return { tick, intervalMs: normalizedInterval };
}
