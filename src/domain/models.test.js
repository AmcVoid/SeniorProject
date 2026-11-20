/**
 * Unit tests for the entity model factories (task 2.1).
 *
 * Verifies that each factory produces the field shape described in design.md
 * and that unordered pairs (interaction warnings / rules) are normalized.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createUser,
  createPatient,
  createProvider,
  createProviderAssignment,
  createSchedule,
  createMedication,
  createDoseEvent,
  createDoseLog,
  createCaregiverContact,
  createMemoryNote,
  createInteractionWarning,
  createInteractionRule,
  createNotification,
  createAuditEntry,
  normalizePair,
} from './models.js';
import {
  Role,
  DoseEventStatus,
  DoseLogStatus,
  NotificationType,
  NotificationStatus,
  InteractionWarningStatus,
} from './types.js';

test('createUser applies defaults and keeps supplied fields', () => {
  const u = createUser({ id: 'u1', role: Role.PATIENT, credentialHash: 'h' });
  assert.equal(u.id, 'u1');
  assert.equal(u.role, Role.PATIENT);
  assert.equal(u.credentialHash, 'h');
  assert.equal(u.preferredReminderChannel, null);
  assert.equal(typeof u.createdAt, 'string');
});

test('createPatient / createProvider set the correct role', () => {
  assert.equal(createPatient({ id: 'p1' }).role, Role.PATIENT);
  assert.equal(createProvider({ id: 'd1' }).role, Role.PROVIDER);
  assert.equal(createPatient({ gracePeriodMinutes: 30 }).gracePeriodMinutes, 30);
});

test('createProviderAssignment defaults to active', () => {
  const a = createProviderAssignment({ providerId: 'd1', patientId: 'p1' });
  assert.equal(a.active, true);
  assert.equal(a.providerId, 'd1');
  assert.equal(a.patientId, 'p1');
});

test('createSchedule copies the times array (no aliasing)', () => {
  const times = ['08:00'];
  const s = createSchedule({ times, recurrence: 'daily' });
  times.push('20:00');
  assert.deepEqual(s.times, ['08:00']);
  assert.equal(s.recurrence, 'daily');
});

test('createMedication carries all design fields with defaults', () => {
  const m = createMedication({ patientId: 'p1', name: 'Aspirin', dosage: '81mg' });
  assert.equal(m.patientId, 'p1');
  assert.equal(m.name, 'Aspirin');
  assert.equal(m.dosage, '81mg');
  assert.equal(m.active, true);
  assert.equal(m.caregiverAlertsEnabled, true);
  assert.equal(m.caregiverRefillNotificationsEnabled, false);
  assert.equal(m.refillThreshold, 0);
  assert.equal(m.remainingSupply, 0);
});

test('createDoseEvent defaults to pending status', () => {
  const e = createDoseEvent({ medicationId: 'm1', scheduledTime: '2026-01-01T08:00:00Z' });
  assert.equal(e.status, DoseEventStatus.PENDING);
  assert.equal(e.medicationId, 'm1');
});

test('createDoseLog defaults to taken with a timestamp', () => {
  const l = createDoseLog({ doseEventId: 'e1' });
  assert.equal(l.status, DoseLogStatus.TAKEN);
  assert.equal(l.doseEventId, 'e1');
  assert.equal(typeof l.loggedAt, 'string');
});

test('createCaregiverContact copies delivery addresses', () => {
  const addrs = ['a@x.com'];
  const c = createCaregiverContact({ patientId: 'p1', name: 'Kin', deliveryAddresses: addrs });
  addrs.push('b@x.com');
  assert.deepEqual(c.deliveryAddresses, ['a@x.com']);
  assert.equal(c.active, true);
});

test('createMemoryNote defaults updatedAt to createdAt', () => {
  const n = createMemoryNote({ medicationId: 'm1', text: 'with food', createdAt: 'T0' });
  assert.equal(n.createdAt, 'T0');
  assert.equal(n.updatedAt, 'T0');
});

test('createInteractionWarning normalizes the medication pair', () => {
  const w1 = createInteractionWarning({ patientId: 'p1', medicationIdA: 'b', medicationIdB: 'a' });
  const w2 = createInteractionWarning({ patientId: 'p1', medicationIdA: 'a', medicationIdB: 'b' });
  assert.equal(w1.medicationIdA, 'a');
  assert.equal(w1.medicationIdB, 'b');
  assert.deepEqual([w1.medicationIdA, w1.medicationIdB], [w2.medicationIdA, w2.medicationIdB]);
  assert.equal(w1.status, InteractionWarningStatus.ACTIVE);
});

test('createInteractionRule normalizes the drug pair', () => {
  const r = createInteractionRule({ drugB: 'warfarin', drugA: 'aspirin', severity: 'high' });
  assert.equal(r.drugA, 'aspirin');
  assert.equal(r.drugB, 'warfarin');
  assert.equal(r.severity, 'high');
});

test('createNotification defaults status/type/attempts', () => {
  const n = createNotification({ recipientRef: 'p1', channel: 'email' });
  assert.equal(n.type, NotificationType.DOSE);
  assert.equal(n.status, NotificationStatus.PENDING);
  assert.equal(n.attemptCount, 0);
  assert.equal(n.maxAttempts, 1);
});

test('createAuditEntry captures user, record, action, timestamp', () => {
  const a = createAuditEntry({ userId: 'u1', recordRef: 'med:1' });
  assert.equal(a.userId, 'u1');
  assert.equal(a.recordRef, 'med:1');
  assert.equal(a.action, 'read');
  assert.equal(typeof a.timestamp, 'string');
});

test('normalizePair is order independent', () => {
  assert.deepEqual(normalizePair('y', 'x'), ['x', 'y']);
  assert.deepEqual(normalizePair('x', 'y'), ['x', 'y']);
});
