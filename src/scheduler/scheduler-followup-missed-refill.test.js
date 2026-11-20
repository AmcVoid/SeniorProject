/**
 * Unit tests for the scheduler tick — follow-up, missed-dose, and refill passes
 * (task 15.2).
 *
 * Covers:
 * - Follow-up reminders (R2.3): exactly one follow-up dose reminder for an event
 *   still unlogged once the grace period has elapsed, fired at most once via the
 *   `followUpSentAt` marker, and never in the same tick as the initial reminder.
 * - Missed-dose detection (R3.3): an unlogged past-grace event is designated
 *   `missed` and a missed Dose_Log is recorded regardless of caregivers (R4.3).
 * - Caregiver alerts (R4.1, R4.3, R4.4): alerts reach exactly the active
 *   caregivers, are suppressed per-medication, and the missed dose is recorded
 *   even with an empty caregiver set.
 * - Refill checks (R5.1, R5.3): a refill reminder to the patient at/below the
 *   threshold, plus caregivers only when the per-medication flag is enabled,
 *   fired once per low-supply episode.
 *
 * Uses in-memory repositories, the real dispatcher over stub channels, and an
 * injected clock so the tick stays pure and deterministic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createScheduler } from './scheduler.js';
import {
  createInMemoryDoseEventRepository,
  createInMemoryDoseLogRepository,
  createInMemoryMedicationRepository,
  createInMemoryCaregiverContactRepository,
  createInMemoryMemoryNoteRepository,
  createInMemoryNotificationRepository,
} from '../data/memory.js';
import {
  createDoseEvent,
  createDoseLog,
  createMedication,
  createCaregiverContact,
  createPatient,
} from '../domain/models.js';
import { DoseEventStatus, DoseLogStatus, NotificationType } from '../domain/types.js';
import { createNotificationDispatcher } from '../notifications/dispatcher.js';
import { createStubChannels } from '../notifications/channels.js';

const NOW = new Date('2026-01-15T08:00:00.000Z');
const fixedClock = (date = NOW) => () => date;

/**
 * Build a scheduler wired to fresh in-memory repositories with the full set of
 * dependencies task 15.2 uses (dose logs, caregivers, a patients lookup).
 */
function setup({
  medications = [],
  doseEvents = [],
  doseLogs = [],
  caregivers = [],
  patients = [],
  notes = [],
  now = NOW,
  ...schedulerOpts
} = {}) {
  const doseEventRepository = createInMemoryDoseEventRepository();
  const doseLogRepository = createInMemoryDoseLogRepository();
  const medicationRepository = createInMemoryMedicationRepository();
  const caregiverContactRepository = createInMemoryCaregiverContactRepository();
  const noteRepository = createInMemoryMemoryNoteRepository();
  const notificationRepository = createInMemoryNotificationRepository();
  const channels = createStubChannels();
  const dispatcher = createNotificationDispatcher({ channels, notificationRepository });

  for (const m of medications) medicationRepository.insert(m);
  for (const e of doseEvents) doseEventRepository.insert(e);
  for (const l of doseLogs) doseLogRepository.insert(l);
  for (const c of caregivers) caregiverContactRepository.insert(c);
  for (const n of notes) noteRepository.insert(n);

  const patientMap = new Map(patients.map((p) => [String(p.id), p]));
  const patientsLookup = { getById: (id) => patientMap.get(String(id)) ?? null };
  const patientIds = patients.map((p) => p.id);

  const scheduler = createScheduler({
    doseEventRepository,
    doseLogRepository,
    medicationRepository,
    caregiverContactRepository,
    noteRepository,
    patients: patientsLookup,
    patientIds,
    dispatcher,
    clock: fixedClock(now),
    dueWindowMs: 3_600_000, // an hour, so past-grace events stay in the window
    ...schedulerOpts,
  });

  return {
    scheduler,
    doseEventRepository,
    doseLogRepository,
    medicationRepository,
    caregiverContactRepository,
    notificationRepository,
    channels,
  };
}

const patient = (id, gracePeriodMinutes = 10) =>
  createPatient({ id, displayName: `Patient ${id}`, gracePeriodMinutes });

// ---------------------------------------------------------------------------
// Follow-up reminders (R2.3)
// ---------------------------------------------------------------------------

test('sends exactly one follow-up reminder for an event unlogged past grace (R2.3)', () => {
  // Scheduled 30m ago, grace 10m => past grace at NOW. Initial reminder was
  // already sent on a prior tick.
  const med = createMedication({ id: 'med-1', patientId: 'pat-1', name: 'Aspirin', dosage: '100mg' });
  const event = createDoseEvent({
    id: 'ev-1',
    medicationId: 'med-1',
    scheduledTime: '2026-01-15T07:30:00.000Z',
  });
  event.reminderSentAt = '2026-01-15T07:31:00.000Z'; // prior tick

  const { scheduler, doseEventRepository } = setup({
    medications: [med],
    doseEvents: [event],
    patients: [patient('pat-1', 10)],
  });

  const first = scheduler.tick();
  assert.equal(first.followUps.sent.length, 1, 'one follow-up sent');
  assert.equal(first.followUps.sent[0].dispatch.notification.payload.type, NotificationType.DOSE);
  assert.equal(doseEventRepository.getById('ev-1').followUpSentAt != null, true);

  // A second tick must not send another follow-up (fires exactly once).
  const second = scheduler.tick();
  assert.equal(second.followUps.sent.length, 0, 'no duplicate follow-up');
});

test('does not send a follow-up in the same tick the initial reminder was sent', () => {
  // grace 0: the initial reminder is claimed this tick; no follow-up yet.
  const med = createMedication({ id: 'med-1', patientId: 'pat-1', name: 'Aspirin', dosage: '100mg' });
  const event = createDoseEvent({
    id: 'ev-1',
    medicationId: 'med-1',
    scheduledTime: '2026-01-15T07:59:30.000Z',
  });
  const { scheduler } = setup({
    medications: [med],
    doseEvents: [event],
    patients: [patient('pat-1', 0)],
  });

  const result = scheduler.tick();
  assert.equal(result.dueReminders.claimed.length, 1, 'initial reminder claimed');
  assert.equal(result.followUps.sent.length, 0, 'no follow-up in the same tick');
});

test('does not send a follow-up for an event still within the grace period', () => {
  // Scheduled 5m ago, grace 10m => NOT past grace at NOW.
  const med = createMedication({ id: 'med-1', patientId: 'pat-1', name: 'Aspirin', dosage: '100mg' });
  const event = createDoseEvent({
    id: 'ev-1',
    medicationId: 'med-1',
    scheduledTime: '2026-01-15T07:55:00.000Z',
  });
  event.reminderSentAt = '2026-01-15T07:55:30.000Z';
  const { scheduler } = setup({
    medications: [med],
    doseEvents: [event],
    patients: [patient('pat-1', 10)],
  });

  assert.equal(scheduler.tick().followUps.sent.length, 0);
});

test('does not send a follow-up for an event that was logged', () => {
  const med = createMedication({ id: 'med-1', patientId: 'pat-1', name: 'Aspirin', dosage: '100mg' });
  const event = createDoseEvent({
    id: 'ev-1',
    medicationId: 'med-1',
    scheduledTime: '2026-01-15T07:30:00.000Z',
  });
  event.reminderSentAt = '2026-01-15T07:31:00.000Z';
  const log = createDoseLog({ doseEventId: 'ev-1', status: DoseLogStatus.TAKEN });
  const { scheduler } = setup({
    medications: [med],
    doseEvents: [event],
    doseLogs: [log],
    patients: [patient('pat-1', 10)],
  });

  assert.equal(scheduler.tick().followUps.sent.length, 0);
});

// ---------------------------------------------------------------------------
// Missed-dose detection + caregiver alerts (R3.3, R4.1, R4.3, R4.4)
// ---------------------------------------------------------------------------

test('designates an unlogged past-grace event as missed and records a missed log (R3.3, R4.3)', () => {
  const med = createMedication({ id: 'med-1', patientId: 'pat-1', name: 'Aspirin', dosage: '100mg' });
  const event = createDoseEvent({
    id: 'ev-1',
    medicationId: 'med-1',
    scheduledTime: '2026-01-15T07:30:00.000Z',
  });
  event.reminderSentAt = '2026-01-15T07:31:00.000Z';
  const { scheduler, doseEventRepository, doseLogRepository } = setup({
    medications: [med],
    doseEvents: [event],
    patients: [patient('pat-1', 10)],
    // no caregivers — missed dose recorded regardless (R4.3)
  });

  const result = scheduler.tick();
  assert.equal(result.missedDoses.missed.length, 1);
  assert.equal(doseEventRepository.getById('ev-1').status, DoseEventStatus.MISSED);
  const log = doseLogRepository.getByDoseEvent('ev-1');
  assert.ok(log, 'a dose log was recorded');
  assert.equal(log.status, DoseLogStatus.MISSED);
  assert.equal(result.missedDoses.alerts.length, 0, 'no caregivers => no alerts');
});

test('alerts exactly the active caregivers on a missed dose (R4.1)', () => {
  const med = createMedication({
    id: 'med-1',
    patientId: 'pat-1',
    name: 'Aspirin',
    dosage: '100mg',
    caregiverAlertsEnabled: true,
  });
  const event = createDoseEvent({
    id: 'ev-1',
    medicationId: 'med-1',
    scheduledTime: '2026-01-15T07:30:00.000Z',
  });
  event.reminderSentAt = '2026-01-15T07:31:00.000Z';
  const active1 = createCaregiverContact({ id: 'cg-1', patientId: 'pat-1', name: 'A', deliveryAddresses: ['a@x'] });
  const active2 = createCaregiverContact({ id: 'cg-2', patientId: 'pat-1', name: 'B', deliveryAddresses: ['b@x'] });
  const inactive = createCaregiverContact({ id: 'cg-3', patientId: 'pat-1', name: 'C', deliveryAddresses: ['c@x'], active: false });

  const { scheduler } = setup({
    medications: [med],
    doseEvents: [event],
    caregivers: [active1, active2, inactive],
    patients: [patient('pat-1', 10)],
  });

  const { alerts } = scheduler.tick().missedDoses;
  const recipients = alerts.map((a) => a.caregiver.id).sort();
  assert.deepEqual(recipients, ['cg-1', 'cg-2'], 'only active caregivers alerted');
  const payload = alerts[0].dispatch.notification.payload;
  assert.equal(payload.type, NotificationType.MISSED);
  assert.equal(payload.medicationName, 'Aspirin');
  assert.equal(payload.scheduledTime, '2026-01-15T07:30:00.000Z');
});

test('suppresses caregiver alerts when disabled for the medication but still records the miss (R4.4)', () => {
  const med = createMedication({
    id: 'med-1',
    patientId: 'pat-1',
    name: 'Aspirin',
    dosage: '100mg',
    caregiverAlertsEnabled: false,
  });
  const event = createDoseEvent({
    id: 'ev-1',
    medicationId: 'med-1',
    scheduledTime: '2026-01-15T07:30:00.000Z',
  });
  event.reminderSentAt = '2026-01-15T07:31:00.000Z';
  const caregiver = createCaregiverContact({ id: 'cg-1', patientId: 'pat-1', name: 'A', deliveryAddresses: ['a@x'] });

  const { scheduler, doseEventRepository } = setup({
    medications: [med],
    doseEvents: [event],
    caregivers: [caregiver],
    patients: [patient('pat-1', 10)],
  });

  const result = scheduler.tick();
  assert.equal(result.missedDoses.alerts.length, 0, 'alerts suppressed');
  assert.equal(result.missedDoses.missed.length, 1, 'miss still recorded');
  assert.equal(doseEventRepository.getById('ev-1').status, DoseEventStatus.MISSED);
});

test('does not re-designate or re-alert an already-missed event on a later tick', () => {
  const med = createMedication({
    id: 'med-1',
    patientId: 'pat-1',
    name: 'Aspirin',
    dosage: '100mg',
    caregiverAlertsEnabled: true,
  });
  const event = createDoseEvent({
    id: 'ev-1',
    medicationId: 'med-1',
    scheduledTime: '2026-01-15T07:30:00.000Z',
  });
  event.reminderSentAt = '2026-01-15T07:31:00.000Z';
  const caregiver = createCaregiverContact({ id: 'cg-1', patientId: 'pat-1', name: 'A', deliveryAddresses: ['a@x'] });
  const { scheduler } = setup({
    medications: [med],
    doseEvents: [event],
    caregivers: [caregiver],
    patients: [patient('pat-1', 10)],
  });

  const first = scheduler.tick();
  const second = scheduler.tick();
  assert.equal(first.missedDoses.missed.length, 1);
  assert.equal(first.missedDoses.alerts.length, 1);
  assert.equal(second.missedDoses.missed.length, 0, 'no re-designation');
  assert.equal(second.missedDoses.alerts.length, 0, 'no re-alert');
});

// ---------------------------------------------------------------------------
// Refill checks (R5.1, R5.3)
// ---------------------------------------------------------------------------

test('sends a refill reminder to the patient at/below the threshold (R5.1)', () => {
  const med = createMedication({
    id: 'med-1',
    patientId: 'pat-1',
    name: 'Aspirin',
    dosage: '100mg',
    remainingSupply: 5,
    refillThreshold: 5, // boundary: at threshold is due
  });
  const { scheduler, medicationRepository } = setup({
    medications: [med],
    patients: [patient('pat-1', 10)],
  });

  const { reminders } = scheduler.tick().refills;
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].recipient, 'patient');
  const payload = reminders[0].dispatch.notification.payload;
  assert.equal(payload.type, NotificationType.REFILL);
  assert.equal(payload.medicationName, 'Aspirin');
  assert.equal(payload.remainingSupply, 5);
  assert.ok(medicationRepository.getById('med-1').refillReminderSentAt != null);
});

test('does not send a refill reminder above the threshold', () => {
  const med = createMedication({
    id: 'med-1',
    patientId: 'pat-1',
    name: 'Aspirin',
    remainingSupply: 6,
    refillThreshold: 5,
  });
  const { scheduler } = setup({ medications: [med], patients: [patient('pat-1', 10)] });
  assert.equal(scheduler.tick().refills.reminders.length, 0);
});

test('also notifies caregivers when the per-medication refill flag is enabled (R5.3)', () => {
  const med = createMedication({
    id: 'med-1',
    patientId: 'pat-1',
    name: 'Aspirin',
    remainingSupply: 2,
    refillThreshold: 5,
    caregiverRefillNotificationsEnabled: true,
  });
  const cg1 = createCaregiverContact({ id: 'cg-1', patientId: 'pat-1', name: 'A', deliveryAddresses: ['a@x'] });
  const cg2 = createCaregiverContact({ id: 'cg-2', patientId: 'pat-1', name: 'B', deliveryAddresses: ['b@x'] });
  const { scheduler } = setup({
    medications: [med],
    caregivers: [cg1, cg2],
    patients: [patient('pat-1', 10)],
  });

  const { reminders } = scheduler.tick().refills;
  const patientReminders = reminders.filter((r) => r.recipient === 'patient');
  const caregiverReminders = reminders.filter((r) => r.recipient === 'caregiver');
  assert.equal(patientReminders.length, 1);
  assert.equal(caregiverReminders.map((r) => r.caregiver.id).sort().join(','), 'cg-1,cg-2');
});

test('does not notify caregivers for refills when the flag is disabled', () => {
  const med = createMedication({
    id: 'med-1',
    patientId: 'pat-1',
    name: 'Aspirin',
    remainingSupply: 2,
    refillThreshold: 5,
    caregiverRefillNotificationsEnabled: false,
  });
  const cg1 = createCaregiverContact({ id: 'cg-1', patientId: 'pat-1', name: 'A', deliveryAddresses: ['a@x'] });
  const { scheduler } = setup({
    medications: [med],
    caregivers: [cg1],
    patients: [patient('pat-1', 10)],
  });

  const { reminders } = scheduler.tick().refills;
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].recipient, 'patient');
});

test('fires a refill reminder once per low-supply episode', () => {
  const med = createMedication({
    id: 'med-1',
    patientId: 'pat-1',
    name: 'Aspirin',
    remainingSupply: 2,
    refillThreshold: 5,
  });
  const { scheduler } = setup({ medications: [med], patients: [patient('pat-1', 10)] });

  assert.equal(scheduler.tick().refills.reminders.length, 1);
  assert.equal(scheduler.tick().refills.reminders.length, 0, 'not re-sent while still low');
});
