/**
 * Unit tests for ScheduleService.generateDoseEvents (task 3.1).
 *
 * Covers example cases and edge cases: daily/weekday/interval recurrence,
 * inclusive window bounds, schedule start/end clamping, invalid windows,
 * malformed inputs, and idempotent regeneration. (R1.6)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { generateDoseEvents, doseEventId } from './schedule.js';
import { createMedication, createSchedule } from './models.js';

// Schedule times are wall-clock times in the server's local zone. Pin this
// file to UTC so the expected ISO timestamps below are exact on any machine.
// Local-zone behavior is covered in schedule-local-time.test.js.
process.env.TZ = 'UTC';

const med = (schedule, id = 'm1') =>
  createMedication({ id, patientId: 'p1', name: 'Aspirin', dosage: '81mg', schedule });

test('daily recurrence generates one event per time per day in the inclusive window', () => {
  const m = med(createSchedule({ times: ['08:00', '20:00'], recurrence: 'daily' }));
  const events = generateDoseEvents(m, {
    start: '2026-01-01T00:00:00.000Z',
    end: '2026-01-02T23:59:59.999Z',
  });
  assert.equal(events.length, 4);
  assert.deepEqual(
    events.map((e) => e.scheduledTime),
    [
      '2026-01-01T08:00:00.000Z',
      '2026-01-01T20:00:00.000Z',
      '2026-01-02T08:00:00.000Z',
      '2026-01-02T20:00:00.000Z',
    ],
  );
  for (const e of events) {
    assert.equal(e.medicationId, 'm1');
    assert.equal(e.status, 'pending');
  }
});

test('window bounds are inclusive at both ends', () => {
  const m = med(createSchedule({ times: ['08:00'], recurrence: 'daily' }));
  const events = generateDoseEvents(m, {
    start: '2026-01-01T08:00:00.000Z',
    end: '2026-01-02T08:00:00.000Z',
  });
  assert.deepEqual(
    events.map((e) => e.scheduledTime),
    ['2026-01-01T08:00:00.000Z', '2026-01-02T08:00:00.000Z'],
  );
});

test('every generated event falls on a schedule time within the window (soundness)', () => {
  const m = med(createSchedule({ times: ['09:30'], recurrence: 'daily' }));
  const start = Date.parse('2026-03-01T00:00:00.000Z');
  const end = Date.parse('2026-03-05T00:00:00.000Z');
  const events = generateDoseEvents(m, { start, end });
  for (const e of events) {
    const t = Date.parse(e.scheduledTime);
    assert.ok(t >= start && t <= end);
    assert.ok(e.scheduledTime.endsWith('T09:30:00.000Z'));
  }
});

test('weekday recurrence only generates the named weekdays', () => {
  // 2026-01-01 is a Thursday. Mon/Wed within the first week.
  const m = med(createSchedule({ times: ['08:00'], recurrence: 'weekdays', daysOfWeek: ['mon', 'wed'] }));
  m.schedule.daysOfWeek = ['mon', 'wed'];
  const events = generateDoseEvents(m, {
    start: '2026-01-01T00:00:00.000Z',
    end: '2026-01-11T23:59:59.999Z',
  });
  // Mondays: Jan 5, Jan 12(excl). Wednesdays: Jan 7. Within range: Jan 5, Jan 7.
  assert.deepEqual(
    events.map((e) => e.scheduledTime),
    ['2026-01-05T08:00:00.000Z', '2026-01-07T08:00:00.000Z'],
  );
});

test('recurrence given directly as a weekday array works', () => {
  const m = med(createSchedule({ times: ['08:00'], recurrence: ['fri'] }));
  m.schedule.recurrence = ['fri'];
  const events = generateDoseEvents(m, {
    start: '2026-01-01T00:00:00.000Z',
    end: '2026-01-10T23:59:59.999Z',
  });
  // Fridays in range: Jan 2, Jan 9.
  assert.deepEqual(
    events.map((e) => e.scheduledTime),
    ['2026-01-02T08:00:00.000Z', '2026-01-09T08:00:00.000Z'],
  );
});

test('interval recurrence generates every Nth day from the schedule start', () => {
  const m = med(
    createSchedule({
      times: ['08:00'],
      recurrence: 'interval',
      startDate: '2026-01-01T00:00:00.000Z',
    }),
  );
  m.schedule.intervalDays = 3;
  const events = generateDoseEvents(m, {
    start: '2026-01-01T00:00:00.000Z',
    end: '2026-01-10T23:59:59.999Z',
  });
  // Every 3rd day from Jan 1: Jan 1, Jan 4, Jan 7, Jan 10.
  assert.deepEqual(
    events.map((e) => e.scheduledTime),
    [
      '2026-01-01T08:00:00.000Z',
      '2026-01-04T08:00:00.000Z',
      '2026-01-07T08:00:00.000Z',
      '2026-01-10T08:00:00.000Z',
    ],
  );
});

test('schedule startDate and endDate clamp the generated range', () => {
  const m = med(
    createSchedule({
      times: ['08:00'],
      recurrence: 'daily',
      startDate: '2026-01-03T00:00:00.000Z',
      endDate: '2026-01-04T23:59:59.999Z',
    }),
  );
  const events = generateDoseEvents(m, {
    start: '2026-01-01T00:00:00.000Z',
    end: '2026-01-10T00:00:00.000Z',
  });
  assert.deepEqual(
    events.map((e) => e.scheduledTime),
    ['2026-01-03T08:00:00.000Z', '2026-01-04T08:00:00.000Z'],
  );
});

test('invalid window (end before start) yields an empty set', () => {
  const m = med(createSchedule({ times: ['08:00'], recurrence: 'daily' }));
  const events = generateDoseEvents(m, {
    start: '2026-01-05T00:00:00.000Z',
    end: '2026-01-01T00:00:00.000Z',
  });
  assert.deepEqual(events, []);
});

test('missing/empty schedule inputs yield an empty set (never throws)', () => {
  const win = { start: '2026-01-01T00:00:00.000Z', end: '2026-01-02T00:00:00.000Z' };
  assert.deepEqual(generateDoseEvents(null, win), []);
  assert.deepEqual(generateDoseEvents(med(null), win), []);
  assert.deepEqual(generateDoseEvents(med(createSchedule({ times: [] })), win), []);
  assert.deepEqual(generateDoseEvents(med(createSchedule({ times: ['bad'] })), win), []);
  assert.deepEqual(
    generateDoseEvents(med(createSchedule({ times: ['08:00'] })), null),
    [],
  );
});

test('regeneration is idempotent: identical events (ids and order) for same medication + window', () => {
  const m = med(createSchedule({ times: ['08:00', '20:00'], recurrence: 'daily' }));
  const win = { start: '2026-01-01T00:00:00.000Z', end: '2026-01-03T23:59:59.999Z' };
  const first = generateDoseEvents(m, win);
  const second = generateDoseEvents(m, win);
  assert.deepEqual(first, second);
  // Deterministic ids derived from medication id + scheduled time.
  assert.equal(first[0].id, doseEventId('m1', '2026-01-01T08:00:00.000Z'));
  const ids = new Set(first.map((e) => e.id));
  assert.equal(ids.size, first.length, 'ids are unique within a window');
});
