/**
 * Unit tests for DoseLogService (task 6.1).
 *
 * Covers logDose (R3.1, R3.2), changeLog grace-period rule (R3.5), and
 * getDoseHistory one-entry-per-event contents (R3.4). Uses the in-memory
 * repositories and a fixed injectable clock for deterministic timing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDoseLogService,
  DoseLogError,
  DoseLogErrorCodes,
} from './dose-log-service.js';
import { createInMemoryRepositories } from '../data/memory.js';
import { createMedication, createDoseEvent } from './models.js';
import { DoseLogStatus } from './types.js';

const PATIENT_ID = 'patient-1';
const GRACE_MINUTES = 30;
const SCHEDULED = '2026-01-01T08:00:00.000Z';

/**
 * Build a service wired to fresh in-memory repos, a patient with a grace
 * period, one active medication, and one dose event. `now` is mutable so tests
 * can advance the clock.
 */
function setup({ gracePeriodMinutes = GRACE_MINUTES } = {}) {
  const repos = createInMemoryRepositories();
  const patients = {
    getById: (id) =>
      String(id) === PATIENT_ID
        ? { id: PATIENT_ID, gracePeriodMinutes }
        : null,
  };

  const med = repos.medications.insert(
    createMedication({ patientId: PATIENT_ID, name: 'Aspirin', dosage: '10mg' }),
  );
  const event = repos.doseEvents.insert(
    createDoseEvent({ medicationId: med.id, scheduledTime: SCHEDULED }),
  );

  let clock = SCHEDULED;
  const service = createDoseLogService({
    doseEvents: repos.doseEvents,
    doseLogs: repos.doseLogs,
    medications: repos.medications,
    patients,
    now: () => clock,
  });

  return {
    repos,
    service,
    med,
    event,
    setNow: (iso) => {
      clock = iso;
    },
  };
}

/** Add `minutes` to the scheduled time and return an ISO string. */
const scheduledPlus = (minutes) =>
  new Date(Date.parse(SCHEDULED) + minutes * 60 * 1000).toISOString();

test('logDose records status, event reference, and timestamp (R3.1, R3.2)', () => {
  const { service, event, setNow } = setup();
  setNow(scheduledPlus(5));

  const log = service.logDose(PATIENT_ID, event.id, DoseLogStatus.TAKEN);

  assert.equal(log.doseEventId, event.id);
  assert.equal(log.status, DoseLogStatus.TAKEN);
  assert.equal(log.loggedAt, scheduledPlus(5));
});

test('logDose supports the missed status (R3.2)', () => {
  const { service, event } = setup();
  const log = service.logDose(PATIENT_ID, event.id, DoseLogStatus.MISSED);
  assert.equal(log.status, DoseLogStatus.MISSED);
});

test('logDose rejects an invalid status', () => {
  const { service, event } = setup();
  assert.throws(
    () => service.logDose(PATIENT_ID, event.id, 'bogus'),
    (err) =>
      err instanceof DoseLogError &&
      err.code === DoseLogErrorCodes.INVALID_STATUS,
  );
});

test('logDose rejects an event not owned by the patient', () => {
  const { service, event } = setup();
  assert.throws(
    () => service.logDose('someone-else', event.id, DoseLogStatus.TAKEN),
    (err) =>
      err instanceof DoseLogError &&
      err.code === DoseLogErrorCodes.EVENT_NOT_OWNED,
  );
});

test('changeLog updates status when within the grace period (R3.5)', () => {
  const { service, event, setNow } = setup();
  service.logDose(PATIENT_ID, event.id, DoseLogStatus.TAKEN);

  // Still inside grace (before scheduled + 30m).
  setNow(scheduledPlus(20));
  const updated = service.changeLog(PATIENT_ID, event.id, DoseLogStatus.MISSED);

  assert.equal(updated.status, DoseLogStatus.MISSED);
  assert.equal(updated.loggedAt, scheduledPlus(20));
});

test('changeLog is allowed exactly at the grace boundary (R3.5)', () => {
  const { service, event, setNow } = setup();
  service.logDose(PATIENT_ID, event.id, DoseLogStatus.TAKEN);

  setNow(scheduledPlus(GRACE_MINUTES)); // exactly scheduled + grace
  const updated = service.changeLog(PATIENT_ID, event.id, DoseLogStatus.MISSED);
  assert.equal(updated.status, DoseLogStatus.MISSED);
});

test('changeLog rejects once past the grace period (R3.5)', () => {
  const { service, event, setNow } = setup();
  service.logDose(PATIENT_ID, event.id, DoseLogStatus.TAKEN);

  setNow(scheduledPlus(GRACE_MINUTES + 1)); // one minute past grace
  assert.throws(
    () => service.changeLog(PATIENT_ID, event.id, DoseLogStatus.MISSED),
    (err) =>
      err instanceof DoseLogError &&
      err.code === DoseLogErrorCodes.OUTSIDE_GRACE_PERIOD,
  );
});

test('changeLog rejects when no log exists for the event', () => {
  const { service, event } = setup();
  assert.throws(
    () => service.changeLog(PATIENT_ID, event.id, DoseLogStatus.TAKEN),
    (err) =>
      err instanceof DoseLogError &&
      err.code === DoseLogErrorCodes.LOG_NOT_FOUND,
  );
});

test('getDoseHistory returns one entry per event with status and timestamp (R3.4)', () => {
  const { service, repos, med, event, setNow } = setup();

  // A second, unlogged event for the same patient.
  const event2 = repos.doseEvents.insert(
    createDoseEvent({
      medicationId: med.id,
      scheduledTime: scheduledPlus(60),
    }),
  );

  setNow(scheduledPlus(5));
  service.logDose(PATIENT_ID, event.id, DoseLogStatus.TAKEN);

  const history = service.getDoseHistory(PATIENT_ID);
  assert.equal(history.length, 2);

  const first = history.find((h) => h.doseEventId === event.id);
  assert.equal(first.status, DoseLogStatus.TAKEN);
  assert.equal(first.loggedAt, scheduledPlus(5));
  assert.equal(first.scheduledTime, SCHEDULED);

  const second = history.find((h) => h.doseEventId === event2.id);
  assert.equal(second.status, null);
  assert.equal(second.loggedAt, null);
});

test('getDoseHistory filters by scheduledTime range', () => {
  const { service, repos, med } = setup();
  repos.doseEvents.insert(
    createDoseEvent({ medicationId: med.id, scheduledTime: scheduledPlus(120) }),
  );

  const history = service.getDoseHistory(PATIENT_ID, {
    from: SCHEDULED,
    to: scheduledPlus(30),
  });
  assert.equal(history.length, 1);
  assert.equal(history[0].scheduledTime, SCHEDULED);
});
