/**
 * Unit tests for notification payload builders (task 12.2).
 *
 * Verifies the field contracts from design.md:
 * - Dose reminder: medication name, dosage, scheduled time, any memory note (R2.2, R10.5).
 * - Missed-dose alert: patient, medication name, scheduled time (R4.2).
 * - Refill reminder: medication name and remaining supply (R5.2).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDoseReminderPayload,
  buildMissedDoseAlertPayload,
  buildRefillReminderPayload,
} from './payloads.js';
import { NotificationType } from '../domain/types.js';
import { createMedication, createPatient, createMemoryNote } from '../domain/models.js';

test('buildDoseReminderPayload includes medication name, dosage, and scheduled time', () => {
  const medication = createMedication({ name: 'Aspirin', dosage: '81 mg' });
  const payload = buildDoseReminderPayload({ medication, scheduledTime: '2026-01-01T08:00:00Z' });

  assert.equal(payload.type, NotificationType.DOSE);
  assert.equal(payload.medicationName, 'Aspirin');
  assert.equal(payload.dosage, '81 mg');
  assert.equal(payload.scheduledTime, '2026-01-01T08:00:00Z');
  assert.equal(payload.memoryNote, null);
});

test('buildDoseReminderPayload includes memory note text from a Memory_Note record', () => {
  const medication = createMedication({ name: 'Metformin', dosage: '500 mg' });
  const note = createMemoryNote({ medicationId: 'm1', text: 'take with food' });
  const payload = buildDoseReminderPayload({
    medication,
    scheduledTime: '2026-01-01T08:00:00Z',
    memoryNote: note,
  });

  assert.equal(payload.memoryNote, 'take with food');
});

test('buildDoseReminderPayload accepts a raw string memory note', () => {
  const medication = createMedication({ name: 'Metformin', dosage: '500 mg' });
  const payload = buildDoseReminderPayload({
    medication,
    scheduledTime: '2026-01-01T08:00:00Z',
    memoryNote: 'avoid grapefruit',
  });

  assert.equal(payload.memoryNote, 'avoid grapefruit');
});

test('buildDoseReminderPayload treats empty/whitespace note as no note', () => {
  const medication = createMedication({ name: 'Metformin', dosage: '500 mg' });
  const payload = buildDoseReminderPayload({
    medication,
    scheduledTime: '2026-01-01T08:00:00Z',
    memoryNote: '   ',
  });

  assert.equal(payload.memoryNote, null);
});

test('buildMissedDoseAlertPayload includes patient, medication name, and scheduled time', () => {
  const patient = createPatient({ id: 'p1', displayName: 'Jane Doe' });
  const medication = createMedication({ name: 'Lisinopril', dosage: '10 mg' });
  const payload = buildMissedDoseAlertPayload({
    patient,
    medication,
    scheduledTime: '2026-01-01T09:00:00Z',
  });

  assert.equal(payload.type, NotificationType.MISSED);
  assert.deepEqual(payload.patient, { id: 'p1', displayName: 'Jane Doe' });
  assert.equal(payload.medicationName, 'Lisinopril');
  assert.equal(payload.scheduledTime, '2026-01-01T09:00:00Z');
});

test('buildMissedDoseAlertPayload accepts a raw patient identifier', () => {
  const medication = createMedication({ name: 'Lisinopril', dosage: '10 mg' });
  const payload = buildMissedDoseAlertPayload({
    patient: 'p1',
    medication,
    scheduledTime: '2026-01-01T09:00:00Z',
  });

  assert.equal(payload.patient, 'p1');
});

test('buildRefillReminderPayload includes medication name and remaining supply', () => {
  const medication = createMedication({ name: 'Warfarin', remainingSupply: 3 });
  const payload = buildRefillReminderPayload({ medication });

  assert.equal(payload.type, NotificationType.REFILL);
  assert.equal(payload.medicationName, 'Warfarin');
  assert.equal(payload.remainingSupply, 3);
});

test('buildRefillReminderPayload honors an explicit remainingSupply override', () => {
  const medication = createMedication({ name: 'Warfarin', remainingSupply: 3 });
  const payload = buildRefillReminderPayload({ medication, remainingSupply: 0 });

  assert.equal(payload.remainingSupply, 0);
});
