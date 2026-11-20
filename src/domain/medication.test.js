/**
 * Unit tests for MedicationService (task 4.1).
 *
 * Exercises create/update/delete/list against the in-memory repositories and
 * a fixed clock so the past/future boundary is deterministic. Covers the R1.1
 * association, R1.2 missing-field validation, R1.3 edit persistence, R1.4
 * delete-removes-future-preserves-history, and R1.5/R6.1 active listing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { MedicationService, ValidationError } from './medication.js';
import {
  createInMemoryMedicationRepository,
  createInMemoryDoseEventRepository,
} from '../data/memory.js';
import { createSchedule, createDoseEvent } from './models.js';

/** Build a service with fresh repos and a fixed clock (the boundary). */
function makeService(nowIso = '2026-06-15T12:00:00.000Z') {
  const medications = createInMemoryMedicationRepository();
  const doseEvents = createInMemoryDoseEventRepository();
  const service = new MedicationService({
    medications,
    doseEvents,
    now: () => new Date(nowIso),
    horizonDays: 30,
  });
  return { service, medications, doseEvents };
}

test('createMedication associates a record with the patient (R1.1)', () => {
  const { service, medications } = makeService();
  const schedule = createSchedule({ times: ['08:00'], recurrence: 'daily' });
  const med = service.createMedication('p1', {
    name: 'Aspirin',
    dosage: '81mg',
    schedule,
  });

  assert.equal(med.patientId, 'p1');
  assert.equal(med.name, 'Aspirin');
  assert.equal(med.dosage, '81mg');
  assert.deepEqual(med.schedule.times, ['08:00']);
  assert.equal(med.active, true);
  // Persisted and retrievable.
  assert.equal(medications.getById(med.id).name, 'Aspirin');
});

test('createMedication generates dose events via ScheduleService (R1.6)', () => {
  const { service, doseEvents } = makeService();
  const schedule = createSchedule({ times: ['08:00'], recurrence: 'daily' });
  const med = service.createMedication('p1', {
    name: 'Aspirin',
    dosage: '81mg',
    schedule,
  });
  const events = doseEvents.listByMedication(med.id);
  // 30-day horizon, one time per day -> at least ~30 events.
  assert.ok(events.length >= 29, `expected ~30 events, got ${events.length}`);
  assert.ok(events.every((e) => e.medicationId === med.id));
});

test('createMedication maps supply alias to remainingSupply', () => {
  const { service } = makeService();
  const med = service.createMedication('p1', {
    name: 'Aspirin',
    dosage: '81mg',
    schedule: createSchedule({ times: ['08:00'] }),
    supply: 42,
  });
  assert.equal(med.remainingSupply, 42);
});

test('createMedication reports exactly the missing required fields (R1.2)', () => {
  const { service, medications } = makeService();
  try {
    service.createMedication('p1', { dosage: '81mg' }); // missing name + schedule
    assert.fail('expected ValidationError');
  } catch (err) {
    assert.ok(err instanceof ValidationError);
    assert.deepEqual(err.missingFields.sort(), ['name', 'schedule']);
  }
  // Nothing persisted on validation failure.
  assert.equal(medications.listByPatient('p1').length, 0);
});

test('createMedication treats blank strings and empty schedule as missing', () => {
  const { service } = makeService();
  try {
    service.createMedication('p1', {
      name: '   ',
      dosage: '81mg',
      schedule: createSchedule({ times: [] }),
    });
    assert.fail('expected ValidationError');
  } catch (err) {
    assert.deepEqual(err.missingFields.sort(), ['name', 'schedule']);
  }
});

test('updateMedication persists name/dosage/schedule (R1.3)', () => {
  const { service, medications } = makeService();
  const med = service.createMedication('p1', {
    name: 'Aspirin',
    dosage: '81mg',
    schedule: createSchedule({ times: ['08:00'] }),
  });

  const updated = service.updateMedication('p1', med.id, {
    name: 'Aspirin EC',
    dosage: '325mg',
  });
  assert.equal(updated.name, 'Aspirin EC');
  assert.equal(updated.dosage, '325mg');
  // Read back.
  const readBack = medications.getById(med.id);
  assert.equal(readBack.name, 'Aspirin EC');
  assert.equal(readBack.dosage, '325mg');
});

test('updateMedication regenerates future dose events on schedule change', () => {
  const { service, doseEvents } = makeService();
  const med = service.createMedication('p1', {
    name: 'Aspirin',
    dosage: '81mg',
    schedule: createSchedule({ times: ['08:00'] }),
  });
  const before = doseEvents.listByMedication(med.id).length;

  service.updateMedication('p1', med.id, {
    schedule: createSchedule({ times: ['08:00', '20:00'] }),
  });
  const after = doseEvents.listByMedication(med.id).length;
  assert.ok(after > before, `expected more events after adding a second time (${before} -> ${after})`);
});

test('updateMedication returns null for another patient or missing med', () => {
  const { service } = makeService();
  const med = service.createMedication('p1', {
    name: 'Aspirin',
    dosage: '81mg',
    schedule: createSchedule({ times: ['08:00'] }),
  });
  assert.equal(service.updateMedication('other', med.id, { name: 'X' }), null);
  assert.equal(service.updateMedication('p1', 'nope', { name: 'X' }), null);
});

test('deleteMedication marks inactive and removes future events, preserving history (R1.4)', () => {
  const nowIso = '2026-06-15T12:00:00.000Z';
  const { service, medications, doseEvents } = makeService(nowIso);
  const med = service.createMedication('p1', {
    name: 'Aspirin',
    dosage: '81mg',
    schedule: createSchedule({ times: ['08:00'] }),
  });

  // Seed a PAST dose event (history) directly.
  const pastEvent = doseEvents.insert(
    createDoseEvent({
      medicationId: med.id,
      scheduledTime: '2026-06-10T08:00:00.000Z',
    }),
  );

  const ok = service.deleteMedication('p1', med.id);
  assert.equal(ok, true);

  // Medication marked inactive (dropped from active list).
  assert.equal(medications.getById(med.id).active, false);
  assert.equal(service.listActiveMedications('p1').length, 0);

  const remaining = doseEvents.listByMedication(med.id);
  // Past event preserved.
  assert.ok(remaining.some((e) => e.id === pastEvent.id));
  // All remaining events are at or before the boundary (no future events).
  assert.ok(remaining.every((e) => e.scheduledTime <= nowIso));
});

test('deleteMedication returns false for another patient or missing med', () => {
  const { service } = makeService();
  const med = service.createMedication('p1', {
    name: 'Aspirin',
    dosage: '81mg',
    schedule: createSchedule({ times: ['08:00'] }),
  });
  assert.equal(service.deleteMedication('other', med.id), false);
  assert.equal(service.deleteMedication('p1', 'nope'), false);
});

test('listActiveMedications returns exactly the active medications (R1.5, R6.1)', () => {
  const { service } = makeService();
  const a = service.createMedication('p1', {
    name: 'Aspirin',
    dosage: '81mg',
    schedule: createSchedule({ times: ['08:00'] }),
  });
  const b = service.createMedication('p1', {
    name: 'Metformin',
    dosage: '500mg',
    schedule: createSchedule({ times: ['09:00'] }),
  });
  // Another patient's med should not appear.
  service.createMedication('p2', {
    name: 'Lisinopril',
    dosage: '10mg',
    schedule: createSchedule({ times: ['07:00'] }),
  });

  service.deleteMedication('p1', b.id); // make one inactive

  const active = service.listActiveMedications('p1');
  assert.deepEqual(
    active.map((m) => m.id).sort(),
    [a.id].sort(),
  );
  assert.ok(active.every((m) => m.name && m.dosage && m.schedule));
});

test('updateMedication rejects a patch that blanks a required field', () => {
  const { service, medications } = makeService();
  const med = service.createMedication('p1', {
    name: 'Aspirin',
    dosage: '81mg',
    schedule: createSchedule({ times: ['08:00'] }),
  });
  assert.throws(
    () => service.updateMedication('p1', med.id, {
      name: '  ',
      schedule: createSchedule({ times: [] }),
    }),
    (err) => {
      assert.ok(err instanceof ValidationError);
      assert.deepEqual(err.missingFields.sort(), ['name', 'schedule']);
      return true;
    },
  );
  assert.equal(medications.getById(med.id).name, 'Aspirin', 'nothing persisted');
});
