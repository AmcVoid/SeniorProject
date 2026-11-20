/**
 * Unit tests for the scheduler tick — due-reminder pass (task 15.1).
 *
 * Covers: claiming due, pending dose events within the window and dispatching
 * exactly one dose reminder per event (R2.1); overlapping/repeated ticks not
 * double-sending (R13.1 at-most-once); the reminder payload carrying medication
 * name / dosage / scheduled time (R2.2); channel resolution (R2.4); and the
 * configured interval staying <= 60s (R13.1). Uses in-memory repositories, the
 * real dispatcher over stub channels, and an injected fixed clock.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createScheduler,
  normalizeTickIntervalMs,
  DEFAULT_TICK_INTERVAL_MS,
  MAX_TICK_INTERVAL_MS,
} from './scheduler.js';
import {
  createInMemoryDoseEventRepository,
  createInMemoryMedicationRepository,
  createInMemoryMemoryNoteRepository,
  createInMemoryNotificationRepository,
} from '../data/memory.js';
import { createDoseEvent, createMedication, createMemoryNote } from '../domain/models.js';
import { DoseEventStatus, NotificationType } from '../domain/types.js';
import { createNotificationDispatcher } from '../notifications/dispatcher.js';
import { ChannelName, createStubChannels } from '../notifications/channels.js';

const NOW = new Date('2026-01-15T08:00:00.000Z');
const fixedClock = (date = NOW) => () => date;

/**
 * Build a scheduler wired to fresh in-memory repositories and a real dispatcher
 * over stub channels, seeded with the given medications and dose events.
 */
function setup({ medications = [], doseEvents = [], notes = [], channelOutcomes, ...schedulerOpts } = {}) {
  const doseEventRepository = createInMemoryDoseEventRepository();
  const medicationRepository = createInMemoryMedicationRepository();
  const noteRepository = createInMemoryMemoryNoteRepository();
  const notificationRepository = createInMemoryNotificationRepository();
  const channels = createStubChannels(channelOutcomes);
  const dispatcher = createNotificationDispatcher({ channels, notificationRepository });

  for (const m of medications) medicationRepository.insert(m);
  for (const e of doseEvents) doseEventRepository.insert(e);
  for (const n of notes) noteRepository.insert(n);

  const scheduler = createScheduler({
    doseEventRepository,
    medicationRepository,
    noteRepository,
    dispatcher,
    clock: fixedClock(),
    ...schedulerOpts,
  });

  return {
    scheduler,
    doseEventRepository,
    medicationRepository,
    noteRepository,
    notificationRepository,
    channels,
  };
}

test('claims a due pending event and dispatches exactly one dose reminder (R2.1)', () => {
  const medication = createMedication({ id: 'med-1', patientId: 'pat-1', name: 'Aspirin', dosage: '100mg' });
  const event = createDoseEvent({ id: 'ev-1', medicationId: 'med-1', scheduledTime: '2026-01-15T07:59:30.000Z' });
  const { scheduler, channels } = setup({ medications: [medication], doseEvents: [event] });

  const result = scheduler.tick();

  assert.equal(result.dueReminders.claimed.length, 1);
  assert.equal(result.dueReminders.dispatched.length, 1);
  const totalSent = Object.values(channels).reduce((n, c) => n + c.sent.length, 0);
  assert.equal(totalSent, 1, 'exactly one reminder delivered');
  assert.equal(result.dueReminders.dispatched[0].dispatch.delivered, true);
});

test('reminder payload identifies medication name, dosage, and scheduled time (R2.2)', () => {
  const medication = createMedication({ id: 'med-1', patientId: 'pat-1', name: 'Metformin', dosage: '500mg' });
  const event = createDoseEvent({ id: 'ev-1', medicationId: 'med-1', scheduledTime: '2026-01-15T07:59:00.000Z' });
  const { scheduler } = setup({ medications: [medication], doseEvents: [event] });

  const { dispatched } = scheduler.tick().dueReminders;
  const payload = dispatched[0].dispatch.notification.payload;

  assert.equal(payload.type, NotificationType.DOSE);
  assert.equal(payload.medicationName, 'Metformin');
  assert.equal(payload.dosage, '500mg');
  assert.equal(payload.scheduledTime, '2026-01-15T07:59:00.000Z');
});

test('includes the newest memory note in the reminder payload (R2.2/R10.5)', () => {
  const medication = createMedication({ id: 'med-1', patientId: 'pat-1', name: 'Aspirin', dosage: '100mg' });
  const event = createDoseEvent({ id: 'ev-1', medicationId: 'med-1', scheduledTime: '2026-01-15T07:59:00.000Z' });
  const older = createMemoryNote({ id: 'n-1', medicationId: 'med-1', text: 'old', updatedAt: '2026-01-01T00:00:00.000Z' });
  const newer = createMemoryNote({ id: 'n-2', medicationId: 'med-1', text: 'take with food', updatedAt: '2026-01-10T00:00:00.000Z' });
  const { scheduler } = setup({ medications: [medication], doseEvents: [event], notes: [older, newer] });

  const { dispatched } = scheduler.tick().dueReminders;
  assert.equal(dispatched[0].dispatch.notification.payload.memoryNote, 'take with food');
});

test('overlapping/repeated ticks do not double-send the same event (R13.1)', () => {
  const medication = createMedication({ id: 'med-1', patientId: 'pat-1', name: 'Aspirin', dosage: '100mg' });
  const event = createDoseEvent({ id: 'ev-1', medicationId: 'med-1', scheduledTime: '2026-01-15T07:59:30.000Z' });
  const { scheduler, channels, doseEventRepository } = setup({
    medications: [medication],
    doseEvents: [event],
  });

  const first = scheduler.tick();
  const second = scheduler.tick();

  assert.equal(first.dueReminders.claimed.length, 1);
  assert.equal(second.dueReminders.claimed.length, 0, 'second tick claims nothing');
  const totalSent = Object.values(channels).reduce((n, c) => n + c.sent.length, 0);
  assert.equal(totalSent, 1, 'reminder sent exactly once across two ticks');

  // The claim marker is recorded; adherence status remains pending until logged.
  const stored = doseEventRepository.getById('ev-1');
  assert.equal(stored.status, DoseEventStatus.PENDING);
  assert.ok(stored.reminderSentAt != null);
});

test('does not remind events outside the due window or not yet due', () => {
  const medication = createMedication({ id: 'med-1', patientId: 'pat-1', name: 'Aspirin', dosage: '100mg' });
  const future = createDoseEvent({ id: 'future', medicationId: 'med-1', scheduledTime: '2026-01-15T09:00:00.000Z' });
  const tooOld = createDoseEvent({ id: 'old', medicationId: 'med-1', scheduledTime: '2026-01-15T07:00:00.000Z' });
  const { scheduler } = setup({
    medications: [medication],
    doseEvents: [future, tooOld],
    dueWindowMs: 90_000,
  });

  const { claimed } = scheduler.tick().dueReminders;
  assert.equal(claimed.length, 0);
});

test('does not remind events already taken or missed', () => {
  const medication = createMedication({ id: 'med-1', patientId: 'pat-1', name: 'Aspirin', dosage: '100mg' });
  const taken = createDoseEvent({
    id: 'taken',
    medicationId: 'med-1',
    scheduledTime: '2026-01-15T07:59:00.000Z',
    status: DoseEventStatus.TAKEN,
  });
  const missed = createDoseEvent({
    id: 'missed',
    medicationId: 'med-1',
    scheduledTime: '2026-01-15T07:59:10.000Z',
    status: DoseEventStatus.MISSED,
  });
  const { scheduler } = setup({ medications: [medication], doseEvents: [taken, missed] });

  const { claimed } = scheduler.tick().dueReminders;
  assert.equal(claimed.length, 0);
});

test('resolves the reminder channel from the medication (R2.4)', () => {
  const medication = createMedication({ id: 'med-1', patientId: 'pat-1', name: 'Aspirin', dosage: '100mg' });
  const event = createDoseEvent({ id: 'ev-1', medicationId: 'med-1', scheduledTime: '2026-01-15T07:59:30.000Z' });
  const { scheduler, channels } = setup({
    medications: [medication],
    doseEvents: [event],
    resolveReminderChannel: () => ChannelName.SMS,
  });

  const { dispatched } = scheduler.tick().dueReminders;
  assert.equal(dispatched[0].dispatch.channel, ChannelName.SMS);
  assert.equal(channels[ChannelName.SMS].sent.length, 1);
  assert.equal(channels[ChannelName.EMAIL].sent.length, 0);
});

test('skips an event whose medication no longer exists without aborting the tick', () => {
  const medication = createMedication({ id: 'med-1', patientId: 'pat-1', name: 'Aspirin', dosage: '100mg' });
  const good = createDoseEvent({ id: 'good', medicationId: 'med-1', scheduledTime: '2026-01-15T07:59:20.000Z' });
  const orphan = createDoseEvent({ id: 'orphan', medicationId: 'gone', scheduledTime: '2026-01-15T07:59:25.000Z' });
  const { scheduler } = setup({ medications: [medication], doseEvents: [good, orphan] });

  const { dispatched } = scheduler.tick().dueReminders;
  const skipped = dispatched.find((d) => d.skipped === 'medication-not-found');
  const delivered = dispatched.find((d) => d.dispatch && d.dispatch.delivered);
  assert.ok(skipped, 'orphan event is skipped');
  assert.ok(delivered, 'good event is still delivered');
});

test('configured interval is clamped to <= 60s (R13.1)', () => {
  const medication = createMedication({ id: 'med-1', patientId: 'pat-1', name: 'Aspirin', dosage: '100mg' });
  const over = setup({ medications: [medication], intervalMs: 120_000 });
  assert.ok(over.scheduler.intervalMs <= MAX_TICK_INTERVAL_MS);
  assert.equal(over.scheduler.intervalMs, MAX_TICK_INTERVAL_MS);

  const under = setup({ medications: [medication], intervalMs: 15_000 });
  assert.equal(under.scheduler.intervalMs, 15_000);

  const bad = setup({ medications: [medication], intervalMs: -5 });
  assert.equal(bad.scheduler.intervalMs, DEFAULT_TICK_INTERVAL_MS);
});

test('normalizeTickIntervalMs clamps and defaults', () => {
  assert.equal(normalizeTickIntervalMs(15_000), 15_000);
  assert.equal(normalizeTickIntervalMs(999_999), MAX_TICK_INTERVAL_MS);
  assert.equal(normalizeTickIntervalMs(0), DEFAULT_TICK_INTERVAL_MS);
  assert.equal(normalizeTickIntervalMs('nope'), DEFAULT_TICK_INTERVAL_MS);
});

test('accepts an object-style clock exposing now()', () => {
  const medication = createMedication({ id: 'med-1', patientId: 'pat-1', name: 'Aspirin', dosage: '100mg' });
  const event = createDoseEvent({ id: 'ev-1', medicationId: 'med-1', scheduledTime: '2026-01-15T07:59:30.000Z' });
  const doseEventRepository = createInMemoryDoseEventRepository();
  const medicationRepository = createInMemoryMedicationRepository();
  const channels = createStubChannels();
  const dispatcher = createNotificationDispatcher({ channels });
  medicationRepository.insert(medication);
  doseEventRepository.insert(event);

  const scheduler = createScheduler({
    doseEventRepository,
    medicationRepository,
    dispatcher,
    clock: { now: () => NOW },
  });

  assert.equal(scheduler.tick().dueReminders.claimed.length, 1);
});
