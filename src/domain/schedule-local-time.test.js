/**
 * Schedule times are wall-clock times in the server's local time zone.
 *
 * This file pins the zone to America/Los_Angeles (UTC-8 in winter, UTC-7 in
 * summer) to check that "08:00" means 08:00 local, that weekdays are local
 * weekdays, and that daylight-saving transitions do not shift dose times.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { generateDoseEvents } from './schedule.js';
import { createMedication, createSchedule } from './models.js';

process.env.TZ = 'America/Los_Angeles';

const med = (schedule) =>
  createMedication({ id: 'm1', patientId: 'p1', name: 'Aspirin', dosage: '81mg', schedule });

const localClock = (iso) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

test('08:00 is scheduled at 08:00 local time, not 08:00 UTC', () => {
  const m = med(createSchedule({ times: ['08:00'], recurrence: 'daily' }));
  const events = generateDoseEvents(m, {
    start: '2026-01-15T08:00:00.000Z', // 00:00 PST Jan 15
    end: '2026-01-16T07:59:59.999Z', //   23:59 PST Jan 15
  });
  assert.deepEqual(events.map((e) => e.scheduledTime), ['2026-01-15T16:00:00.000Z']);
});

test('a late-evening local dose falls on the same local day', () => {
  const m = med(createSchedule({ times: ['22:00'], recurrence: 'daily' }));
  const events = generateDoseEvents(m, {
    start: '2026-01-15T08:00:00.000Z',
    end: '2026-01-16T07:59:59.999Z',
  });
  // 22:00 PST Jan 15 is 06:00 UTC Jan 16.
  assert.deepEqual(events.map((e) => e.scheduledTime), ['2026-01-16T06:00:00.000Z']);
});

test('dose time stays at 08:00 local across the spring DST change', () => {
  const m = med(createSchedule({ times: ['08:00'], recurrence: 'daily' }));
  const events = generateDoseEvents(m, {
    start: '2026-03-07T08:00:00.000Z', // Mar 7 local midnight; DST starts Mar 8
    end: '2026-03-10T06:59:59.999Z',
  });
  assert.deepEqual(events.map((e) => e.scheduledTime), [
    '2026-03-07T16:00:00.000Z', // PST
    '2026-03-08T15:00:00.000Z', // PDT
    '2026-03-09T15:00:00.000Z',
  ]);
  assert.ok(events.every((e) => localClock(e.scheduledTime) === '08:00'));
});

test('dose time stays at 08:00 local across the fall DST change', () => {
  const m = med(createSchedule({ times: ['08:00'], recurrence: 'daily' }));
  const events = generateDoseEvents(m, {
    start: '2026-10-31T07:00:00.000Z', // Oct 31 local midnight; DST ends Nov 1
    end: '2026-11-03T07:59:59.999Z',
  });
  assert.equal(events.length, 3);
  assert.ok(events.every((e) => localClock(e.scheduledTime) === '08:00'));
});

test('weekday recurrence uses local weekdays', () => {
  // Monday 2026-01-12 at 20:00 local is Tuesday 04:00 UTC.
  const m = med(createSchedule({ times: ['20:00'], recurrence: ['Mon'] }));
  const events = generateDoseEvents(m, {
    start: '2026-01-11T08:00:00.000Z', // Sun local midnight
    end: '2026-01-18T07:59:59.999Z', //   Sat 23:59 local
  });
  assert.deepEqual(events.map((e) => e.scheduledTime), ['2026-01-13T04:00:00.000Z']);
  assert.equal(new Date(events[0].scheduledTime).getDay(), 1);
});

test('interval recurrence counts local calendar days across DST', () => {
  const m = med(
    createSchedule({
      times: ['08:00'],
      recurrence: 'interval',
      startDate: '2026-03-06T08:00:00.000Z', // Mar 6 local midnight
    }),
  );
  m.schedule.intervalDays = 2;
  const events = generateDoseEvents(m, {
    start: '2026-03-06T08:00:00.000Z',
    end: '2026-03-12T06:59:59.999Z',
  });
  assert.deepEqual(
    events.map((e) => new Date(e.scheduledTime).getDate()),
    [6, 8, 10],
  );
  assert.ok(events.every((e) => localClock(e.scheduledTime) === '08:00'));
});
