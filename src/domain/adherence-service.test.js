/**
 * Unit tests for AdherenceService (task 7.1).
 *
 * Covers rate/count computation (R8.1, R8.2), the distinct "no doses
 * scheduled" report (R8.4), and provider/patient equivalence via a single
 * shared computation (R8.3, R6.2). Uses the in-memory repositories.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createAdherenceService } from './adherence-service.js';
import { createInMemoryRepositories } from '../data/memory.js';
import { createMedication, createDoseEvent } from './models.js';
import { DoseLogStatus } from './types.js';

const PATIENT_ID = 'patient-1';
const OTHER_PATIENT_ID = 'patient-2';
const SCHEDULED = '2026-01-01T08:00:00.000Z';

/** Add `minutes` to the scheduled time and return an ISO string. */
const scheduledPlus = (minutes) =>
  new Date(Date.parse(SCHEDULED) + minutes * 60 * 1000).toISOString();

/** Build a service wired to fresh in-memory repos with one active medication. */
function setup() {
  const repos = createInMemoryRepositories();
  const med = repos.medications.insert(
    createMedication({ patientId: PATIENT_ID, name: 'Aspirin', dosage: '10mg' }),
  );
  const service = createAdherenceService({
    medications: repos.medications,
    doseEvents: repos.doseEvents,
    doseLogs: repos.doseLogs,
  });
  return { repos, service, med };
}

/** Insert an event at `scheduledTime`; optionally log it with `status`. */
function addEvent(repos, medicationId, scheduledTime, status) {
  const event = repos.doseEvents.insert(
    createDoseEvent({ medicationId, scheduledTime }),
  );
  if (status) {
    repos.doseLogs.insert({ doseEventId: event.id, status, loggedAt: scheduledTime });
  }
  return event;
}

test('computeAdherence computes rate and counts (R8.1, R8.2)', () => {
  const { repos, service, med } = setup();
  addEvent(repos, med.id, scheduledPlus(0), DoseLogStatus.TAKEN);
  addEvent(repos, med.id, scheduledPlus(60), DoseLogStatus.TAKEN);
  addEvent(repos, med.id, scheduledPlus(120), DoseLogStatus.MISSED);
  addEvent(repos, med.id, scheduledPlus(180)); // unlogged -> counts as missed

  const report = service.computeAdherence(PATIENT_ID);

  assert.equal(report.scheduledCount, 4);
  assert.equal(report.takenCount, 2);
  assert.equal(report.missedCount, 2);
  assert.equal(report.adherenceRate, 0.5);
  assert.equal(report.noDosesScheduled, false);
});

test('adherenceRate is 1 when every scheduled dose is taken', () => {
  const { repos, service, med } = setup();
  addEvent(repos, med.id, scheduledPlus(0), DoseLogStatus.TAKEN);
  addEvent(repos, med.id, scheduledPlus(60), DoseLogStatus.TAKEN);

  const report = service.computeAdherence(PATIENT_ID);
  assert.equal(report.adherenceRate, 1);
  assert.equal(report.takenCount, 2);
  assert.equal(report.missedCount, 0);
});

test('adherenceRate is 0 when nothing is taken', () => {
  const { repos, service, med } = setup();
  addEvent(repos, med.id, scheduledPlus(0), DoseLogStatus.MISSED);
  addEvent(repos, med.id, scheduledPlus(60)); // unlogged

  const report = service.computeAdherence(PATIENT_ID);
  assert.equal(report.adherenceRate, 0);
  assert.equal(report.takenCount, 0);
  assert.equal(report.missedCount, 2);
});

test('empty period returns a distinct no-doses-scheduled report (R8.4)', () => {
  const { service } = setup();

  const report = service.computeAdherence(PATIENT_ID);
  assert.equal(report.noDosesScheduled, true);
  assert.equal(report.scheduledCount, 0);
  assert.equal(report.takenCount, 0);
  assert.equal(report.missedCount, 0);
  assert.equal(report.adherenceRate, null); // no division by zero
});

test('period bounds filter events by scheduledTime inclusively', () => {
  const { repos, service, med } = setup();
  addEvent(repos, med.id, SCHEDULED, DoseLogStatus.TAKEN); // at `from`
  addEvent(repos, med.id, scheduledPlus(30), DoseLogStatus.MISSED); // at `to`
  addEvent(repos, med.id, scheduledPlus(120), DoseLogStatus.TAKEN); // outside

  const report = service.computeAdherence(PATIENT_ID, {
    from: SCHEDULED,
    to: scheduledPlus(30),
  });

  assert.equal(report.scheduledCount, 2);
  assert.equal(report.takenCount, 1);
  assert.equal(report.missedCount, 1);
  assert.equal(report.adherenceRate, 0.5);
});

test('only the requested patient\'s events are counted', () => {
  const { repos, service, med } = setup();
  const otherMed = repos.medications.insert(
    createMedication({ patientId: OTHER_PATIENT_ID, name: 'X', dosage: '1mg' }),
  );
  addEvent(repos, med.id, scheduledPlus(0), DoseLogStatus.TAKEN);
  addEvent(repos, otherMed.id, scheduledPlus(0), DoseLogStatus.MISSED);

  const report = service.computeAdherence(PATIENT_ID);
  assert.equal(report.scheduledCount, 1);
  assert.equal(report.takenCount, 1);
});

test('provider and patient reports are identical (same computation) (R8.3, R6.2)', () => {
  const { repos, service, med } = setup();
  addEvent(repos, med.id, scheduledPlus(0), DoseLogStatus.TAKEN);
  addEvent(repos, med.id, scheduledPlus(60), DoseLogStatus.MISSED);

  const period = { from: SCHEDULED, to: scheduledPlus(120) };
  // The provider view and patient view invoke the same computeAdherence.
  const patientView = service.computeAdherence(PATIENT_ID, period);
  const providerView = service.computeAdherence(PATIENT_ID, period);

  assert.deepEqual(providerView, patientView);
});
