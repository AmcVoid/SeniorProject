/**
 * Tests for the in-memory fake repositories (task 2.2).
 *
 * Covers, per repository, the storage contract documented in
 * `src/data/interfaces.js`: id assignment, copy-on-read/write isolation,
 * scoped queries (by patient/medication/event/status/pair), soft vs. hard
 * delete, and revocation. Includes property-based tests for the universal
 * insert -> getById round-trip and store isolation.
 *
 * These are NOT design Properties 1-36; they validate the fakes themselves so
 * later service/property tests can trust them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  createMedication,
  createDoseEvent,
  createDoseLog,
  createCaregiverContact,
  createMemoryNote,
  createInteractionWarning,
  createInteractionRule,
  createNotification,
  createProviderAssignment,
  createAuditEntry,
} from '../../src/domain/models.js';
import {
  DoseLogStatus,
  NotificationStatus,
  InteractionWarningStatus,
} from '../../src/domain/types.js';
import {
  createInMemoryMedicationRepository,
  createInMemoryDoseEventRepository,
  createInMemoryDoseLogRepository,
  createInMemoryCaregiverContactRepository,
  createInMemoryMemoryNoteRepository,
  createInMemoryInteractionWarningRepository,
  createInMemoryInteractionRuleRepository,
  createInMemoryNotificationRepository,
  createInMemoryProviderAssignmentRepository,
  createInMemoryAuditEntryRepository,
  createInMemoryRepositories,
} from '../../src/data/memory.js';

test('insert assigns an id when absent and preserves an explicit id', () => {
  const repo = createInMemoryMedicationRepository();
  const assigned = repo.insert(createMedication({ patientId: 'p1', name: 'A' }));
  assert.ok(assigned.id, 'expected an assigned id');

  const explicit = repo.insert(createMedication({ id: 'fixed', patientId: 'p1', name: 'B' }));
  assert.equal(explicit.id, 'fixed');
  assert.deepEqual(repo.getById('fixed'), explicit);
});

test('getById returns null for missing / null ids', () => {
  const repo = createInMemoryMedicationRepository();
  assert.equal(repo.getById('nope'), null);
  assert.equal(repo.getById(null), null);
  assert.equal(repo.getById(undefined), null);
});

test('reads return copies so callers cannot mutate stored state', () => {
  const repo = createInMemoryMedicationRepository();
  const stored = repo.insert(createMedication({ patientId: 'p1', name: 'A' }));
  stored.name = 'MUTATED';
  assert.equal(repo.getById(stored.id).name, 'A');

  const listed = repo.listByPatient('p1');
  listed[0].name = 'MUTATED-AGAIN';
  assert.equal(repo.getById(stored.id).name, 'A');
});

test('update merges a patch, keeps the id, and returns null when absent', () => {
  const repo = createInMemoryMedicationRepository();
  const med = repo.insert(createMedication({ patientId: 'p1', name: 'A', dosage: '1mg' }));
  const updated = repo.update(med.id, { dosage: '2mg', id: 'hacked' });
  assert.equal(updated.id, med.id, 'id must not change via patch');
  assert.equal(updated.dosage, '2mg');
  assert.equal(updated.name, 'A');
  assert.equal(repo.update('missing', { dosage: 'x' }), null);
});

test('medication repository: active scoping, soft delete, hard delete', () => {
  const repo = createInMemoryMedicationRepository();
  const a = repo.insert(createMedication({ patientId: 'p1', name: 'A', active: true }));
  const b = repo.insert(createMedication({ patientId: 'p1', name: 'B', active: false }));
  repo.insert(createMedication({ patientId: 'p2', name: 'C', active: true }));

  assert.equal(repo.listByPatient('p1').length, 2);
  assert.deepEqual(
    repo.listActiveByPatient('p1').map((m) => m.name),
    ['A'],
  );

  assert.equal(repo.markInactive(a.id), true);
  assert.equal(repo.listActiveByPatient('p1').length, 0);
  assert.equal(repo.markInactive('missing'), false);

  assert.equal(repo.remove(b.id), true);
  assert.equal(repo.listByPatient('p1').length, 1);
  assert.equal(repo.remove('missing'), false);
});

test('dose event repository: batch insert, future scoping, due window, removeFuture', () => {
  const repo = createInMemoryDoseEventRepository();
  const events = repo.insertMany([
    createDoseEvent({ medicationId: 'm1', scheduledTime: '2026-01-01T08:00:00Z' }),
    createDoseEvent({ medicationId: 'm1', scheduledTime: '2026-01-03T08:00:00Z' }),
    createDoseEvent({ medicationId: 'm2', scheduledTime: '2026-01-02T08:00:00Z' }),
  ]);
  assert.equal(events.length, 3);
  assert.ok(events.every((e) => e.id));

  const boundary = '2026-01-02T00:00:00Z';
  assert.deepEqual(
    repo.listFutureByMedication('m1', boundary).map((e) => e.scheduledTime),
    ['2026-01-03T08:00:00Z'],
  );

  assert.equal(
    repo.listDueBetween('2026-01-01T00:00:00Z', '2026-01-02T23:59:59Z').length,
    2,
  );

  assert.equal(repo.removeFutureByMedication('m1', boundary), 1);
  assert.equal(repo.listByMedication('m1').length, 1); // past event preserved
});

test('dose log repository: one log per event, lookup and update by event', () => {
  const repo = createInMemoryDoseLogRepository();
  repo.insert(createDoseLog({ doseEventId: 'e1', status: DoseLogStatus.TAKEN }));
  repo.insert(createDoseLog({ doseEventId: 'e2', status: DoseLogStatus.MISSED }));

  assert.equal(repo.getByDoseEvent('e1').status, DoseLogStatus.TAKEN);
  assert.equal(repo.getByDoseEvent('missing'), null);
  assert.equal(repo.listByDoseEvents(['e1', 'e2']).length, 2);

  const changed = repo.updateByDoseEvent('e2', { status: DoseLogStatus.TAKEN });
  assert.equal(changed.status, DoseLogStatus.TAKEN);
  assert.equal(repo.updateByDoseEvent('nope', { status: DoseLogStatus.TAKEN }), null);
});

test('caregiver repository: patient scoping, active scoping, delete stops alerts', () => {
  const repo = createInMemoryCaregiverContactRepository();
  const c1 = repo.insert(
    createCaregiverContact({ patientId: 'p1', name: 'Kid', deliveryAddresses: ['a@x'] }),
  );
  repo.insert(
    createCaregiverContact({
      patientId: 'p1',
      name: 'Nurse',
      deliveryAddresses: ['b@x'],
      active: false,
    }),
  );

  assert.equal(repo.listByPatient('p1').length, 2);
  assert.deepEqual(repo.listActiveByPatient('p1').map((c) => c.name), ['Kid']);
  assert.equal(repo.remove(c1.id), true);
  assert.equal(repo.listActiveByPatient('p1').length, 0);
});

test('memory note repository: scoped by medication, update and delete', () => {
  const repo = createInMemoryMemoryNoteRepository();
  const n = repo.insert(createMemoryNote({ medicationId: 'm1', text: 'take with food' }));
  repo.insert(createMemoryNote({ medicationId: 'm2', text: 'other' }));
  assert.equal(repo.listByMedication('m1').length, 1);
  assert.equal(repo.update(n.id, { text: 'take with water' }).text, 'take with water');
  assert.equal(repo.remove(n.id), true);
  assert.equal(repo.listByMedication('m1').length, 0);
});

test('interaction warning repository: active-status scoping and resolution', () => {
  const repo = createInMemoryInteractionWarningRepository();
  const w = repo.insert(
    createInteractionWarning({ patientId: 'p1', medicationIdA: 'a', medicationIdB: 'b' }),
  );
  repo.insert(
    createInteractionWarning({
      patientId: 'p1',
      medicationIdA: 'c',
      medicationIdB: 'd',
      status: InteractionWarningStatus.RESOLVED,
    }),
  );
  assert.equal(repo.listActiveByPatient('p1').length, 1);
  repo.update(w.id, { status: InteractionWarningStatus.RESOLVED });
  assert.equal(repo.listActiveByPatient('p1').length, 0);
});

test('interaction rule repository: keyed by unordered pair, replace and remove', () => {
  const repo = createInMemoryInteractionRuleRepository();
  repo.insert(createInteractionRule({ drugA: 'warfarin', drugB: 'aspirin', severity: 'high' }));
  // Same pair, reversed order -> replaces, not duplicates.
  repo.insert(createInteractionRule({ drugA: 'aspirin', drugB: 'warfarin', severity: 'severe' }));

  assert.equal(repo.list().length, 1);
  assert.equal(repo.getByPair('warfarin', 'aspirin').severity, 'severe');
  assert.equal(repo.getByPair('aspirin', 'warfarin').severity, 'severe');
  assert.equal(repo.remove('aspirin', 'warfarin'), true);
  assert.equal(repo.getByPair('warfarin', 'aspirin'), null);
});

test('notification repository: listByStatus and status/attempt updates', () => {
  const repo = createInMemoryNotificationRepository();
  const n = repo.insert(
    createNotification({ recipientRef: 'p1', status: NotificationStatus.PENDING, maxAttempts: 3 }),
  );
  repo.insert(
    createNotification({ recipientRef: 'p2', status: NotificationStatus.UNDELIVERED }),
  );
  assert.equal(repo.listByStatus(NotificationStatus.UNDELIVERED).length, 1);
  const updated = repo.update(n.id, {
    status: NotificationStatus.FAILED,
    attemptCount: 1,
  });
  assert.equal(updated.status, NotificationStatus.FAILED);
  assert.equal(updated.attemptCount, 1);
});

test('provider assignment repository: active assignment check and revocation', () => {
  const repo = createInMemoryProviderAssignmentRepository();
  const a = repo.insert(createProviderAssignment({ providerId: 'dr1', patientId: 'p1' }));
  repo.insert(createProviderAssignment({ providerId: 'dr1', patientId: 'p2', active: false }));

  assert.equal(repo.isActivelyAssigned('dr1', 'p1'), true);
  assert.equal(repo.isActivelyAssigned('dr1', 'p2'), false);
  assert.equal(repo.isActivelyAssigned('dr2', 'p1'), false);
  assert.equal(repo.listByProvider('dr1').length, 2);
  assert.equal(repo.listByPatient('p1').length, 1);

  repo.update(a.id, { active: false }); // revoke
  assert.equal(repo.isActivelyAssigned('dr1', 'p1'), false);
});

test('audit entry repository: append and scoped listing by user and record', () => {
  const repo = createInMemoryAuditEntryRepository();
  repo.insert(createAuditEntry({ userId: 'u1', recordRef: 'rec1' }));
  repo.insert(createAuditEntry({ userId: 'u1', recordRef: 'rec2' }));
  repo.insert(createAuditEntry({ userId: 'u2', recordRef: 'rec1' }));

  assert.equal(repo.list().length, 3);
  assert.equal(repo.listByUser('u1').length, 2);
  assert.equal(repo.listByRecord('rec1').length, 2);
});

test('createInMemoryRepositories returns a fresh, independent set each call', () => {
  const first = createInMemoryRepositories();
  const second = createInMemoryRepositories();
  first.medications.insert(createMedication({ patientId: 'p1', name: 'A' }));
  assert.equal(first.medications.listByPatient('p1').length, 1);
  assert.equal(second.medications.listByPatient('p1').length, 0);

  const expectedKeys = [
    'auditEntries',
    'caregivers',
    'doseEvents',
    'doseLogs',
    'interactionRules',
    'interactionWarnings',
    'medications',
    'notes',
    'notifications',
    'providerAssignments',
    'users',
  ];
  assert.deepEqual(Object.keys(first).sort(), expectedKeys);
});

test('property: insert then getById round-trips record fields (id-assigned)', () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 1 }),
      fc.string({ minLength: 1 }),
      fc.string({ minLength: 1 }),
      (patientId, name, dosage) => {
        const repo = createInMemoryMedicationRepository();
        const stored = repo.insert(createMedication({ patientId, name, dosage }));
        const fetched = repo.getById(stored.id);
        return (
          fetched !== null &&
          fetched.patientId === patientId &&
          fetched.name === name &&
          fetched.dosage === dosage &&
          fetched.id === stored.id
        );
      },
    ),
    { numRuns: 100 },
  );
});

test('property: distinct stores never leak records between each other', () => {
  fc.assert(
    fc.property(
      fc.array(fc.record({ patientId: fc.string({ minLength: 1 }), name: fc.string() }), {
        maxLength: 20,
      }),
      (rows) => {
        const a = createInMemoryMedicationRepository();
        const b = createInMemoryMedicationRepository();
        for (const row of rows) a.insert(createMedication(row));
        // b received nothing, so every patient query on b is empty.
        return rows.every((row) => b.listByPatient(row.patientId).length === 0);
      },
    ),
    { numRuns: 100 },
  );
});
