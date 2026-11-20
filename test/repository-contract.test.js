/**
 * Shared repository contract tests (task 2.3).
 *
 * The same behavioral expectations run against BOTH implementations:
 *   - the in-memory fakes (`src/data/memory.js`, task 2.2), and
 *   - the SQLite repositories (`src/data/sqlite/*`, task 2.3).
 *
 * This proves the SQLite repositories are drop-in replacements for the fakes:
 * synchronous, plain-record in/out, ids assigned when absent, copy-on-read.
 *
 * SQLite runs against a temporary on-disk database (to exercise the file path
 * and encryption-key code path) which is deleted afterward, plus an in-memory
 * database for the fast bulk of assertions.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';

import { createInMemoryRepositories } from '../src/data/memory.js';
import { openDatabase, resolveEncryptionKey, ENCRYPTION_KEY_ENV } from '../src/data/sqlite/db.js';
import { createSqliteRepositories } from '../src/data/sqlite/repositories.js';

/**
 * Build a factory that yields a fresh repository set plus a teardown fn.
 * Both factories return `{ repos, cleanup, db? }`.
 */
const inMemoryFactory = () => ({ repos: createInMemoryRepositories(), cleanup: () => {} });

function sqliteFactory() {
  const db = openDatabase({ filename: ':memory:', encryptionKey: 'test-key' });
  return { repos: createSqliteRepositories(db), cleanup: () => db.close(), db };
}

const IMPLS = [
  ['in-memory', inMemoryFactory],
  ['sqlite', sqliteFactory],
];

for (const [label, factory] of IMPLS) {
  test(`[${label}] medication repository: insert assigns id, getById copies, list filters`, () => {
    const { repos, cleanup } = factory();
    try {
      const m = repos.medications.insert({
        id: null,
        patientId: 'p1',
        name: 'Aspirin',
        dosage: '100mg',
        schedule: { times: ['08:00'], recurrence: 'daily', startDate: null, endDate: null },
        refillThreshold: 5,
        remainingSupply: 30,
        caregiverAlertsEnabled: true,
        caregiverRefillNotificationsEnabled: false,
        active: true,
        createdAt: '2024-01-01T00:00:00.000Z',
      });
      assert.ok(m.id, 'insert assigns an id when absent');
      assert.equal(m.name, 'Aspirin');
      assert.deepEqual(m.schedule.times, ['08:00'], 'embedded schedule rematerializes');

      const fetched = repos.medications.getById(m.id);
      assert.deepEqual(fetched, m);
      fetched.name = 'mutated';
      assert.equal(repos.medications.getById(m.id).name, 'Aspirin', 'reads return copies');

      repos.medications.insert({ patientId: 'p1', name: 'B', active: false });
      repos.medications.insert({ patientId: 'p2', name: 'C', active: true });
      assert.equal(repos.medications.listByPatient('p1').length, 2);
      assert.equal(repos.medications.listActiveByPatient('p1').length, 1);
    } finally {
      cleanup();
    }
  });

  test(`[${label}] medication repository: update merges, markInactive, remove`, () => {
    const { repos, cleanup } = factory();
    try {
      const m = repos.medications.insert({ patientId: 'p1', name: 'X', active: true });
      const updated = repos.medications.update(m.id, { dosage: '200mg' });
      assert.equal(updated.dosage, '200mg');
      assert.equal(updated.name, 'X', 'unpatched fields preserved');
      assert.equal(repos.medications.update('nope', { dosage: 'y' }), null);

      assert.equal(repos.medications.markInactive(m.id), true);
      assert.equal(repos.medications.getById(m.id).active, false);
      assert.equal(repos.medications.markInactive('nope'), false);

      assert.equal(repos.medications.remove(m.id), true);
      assert.equal(repos.medications.getById(m.id), null);
      assert.equal(repos.medications.remove(m.id), false);
    } finally {
      cleanup();
    }
  });

  test(`[${label}] dose event repository: insertMany, future/due windows, removeFuture`, () => {
    const { repos, cleanup } = factory();
    try {
      const med = repos.medications.insert({ patientId: 'p1', name: 'M', active: true });
      const events = repos.doseEvents.insertMany([
        { medicationId: med.id, scheduledTime: '2024-01-01T08:00:00.000Z' },
        { medicationId: med.id, scheduledTime: '2024-01-02T08:00:00.000Z' },
        { medicationId: med.id, scheduledTime: '2024-01-03T08:00:00.000Z' },
      ]);
      assert.equal(events.length, 3);
      assert.ok(events.every((e) => e.id));

      assert.equal(repos.doseEvents.listByMedication(med.id).length, 3);

      const future = repos.doseEvents.listFutureByMedication(
        med.id,
        '2024-01-01T08:00:00.000Z',
      );
      assert.equal(future.length, 2, 'strictly after boundary');

      const due = repos.doseEvents.listDueBetween(
        '2024-01-01T00:00:00.000Z',
        '2024-01-02T23:59:59.000Z',
      );
      assert.equal(due.length, 2, 'inclusive window');

      const updated = repos.doseEvents.update(events[0].id, { status: 'taken' });
      assert.equal(updated.status, 'taken');

      const removed = repos.doseEvents.removeFutureByMedication(
        med.id,
        '2024-01-01T08:00:00.000Z',
      );
      assert.equal(removed, 2);
      assert.equal(repos.doseEvents.listByMedication(med.id).length, 1);
    } finally {
      cleanup();
    }
  });

  test(`[${label}] dose log repository: one per event, listByDoseEvents, updateByDoseEvent`, () => {
    const { repos, cleanup } = factory();
    try {
      const med = repos.medications.insert({ patientId: 'p1', name: 'M', active: true });
      const [e1, e2] = repos.doseEvents.insertMany([
        { medicationId: med.id, scheduledTime: '2024-01-01T08:00:00.000Z' },
        { medicationId: med.id, scheduledTime: '2024-01-02T08:00:00.000Z' },
      ]);

      assert.equal(repos.doseLogs.getByDoseEvent(e1.id), null, 'unlogged -> null');
      const log = repos.doseLogs.insert({
        doseEventId: e1.id,
        status: 'taken',
        loggedAt: '2024-01-01T08:05:00.000Z',
      });
      assert.ok(log.id);
      assert.deepEqual(repos.doseLogs.getByDoseEvent(e1.id), log);

      repos.doseLogs.insert({ doseEventId: e2.id, status: 'missed', loggedAt: 'x' });
      const both = repos.doseLogs.listByDoseEvents([e1.id, e2.id]);
      assert.equal(both.length, 2);
      assert.deepEqual(repos.doseLogs.listByDoseEvents([]), []);

      const changed = repos.doseLogs.updateByDoseEvent(e1.id, { status: 'missed' });
      assert.equal(changed.status, 'missed');
      assert.equal(repos.doseLogs.updateByDoseEvent('none', { status: 'x' }), null);

      assert.equal(repos.doseLogs.remove(log.id), true);
      assert.equal(repos.doseLogs.getById(log.id), null);
    } finally {
      cleanup();
    }
  });

  test(`[${label}] caregiver repository: deliveryAddresses roundtrip, active filter`, () => {
    const { repos, cleanup } = factory();
    try {
      const c = repos.caregivers.insert({
        patientId: 'p1',
        name: 'Nadia',
        deliveryAddresses: ['a@example.com', '+15551234'],
        channelPreference: 'email',
        active: true,
      });
      assert.deepEqual(c.deliveryAddresses, ['a@example.com', '+15551234']);
      repos.caregivers.insert({ patientId: 'p1', name: 'Inactive', deliveryAddresses: ['x'], active: false });
      assert.equal(repos.caregivers.listByPatient('p1').length, 2);
      assert.equal(repos.caregivers.listActiveByPatient('p1').length, 1);
      assert.equal(repos.caregivers.update(c.id, { name: 'Nadia R' }).name, 'Nadia R');
      assert.equal(repos.caregivers.remove(c.id), true);
    } finally {
      cleanup();
    }
  });

  test(`[${label}] memory note repository: listByMedication, update, remove`, () => {
    const { repos, cleanup } = factory();
    try {
      const med = repos.medications.insert({ patientId: 'p1', name: 'M', active: true });
      const n = repos.notes.insert({
        medicationId: med.id,
        text: 'take with food',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
      assert.equal(repos.notes.listByMedication(med.id).length, 1);
      assert.equal(repos.notes.update(n.id, { text: 'take at night' }).text, 'take at night');
      assert.equal(repos.notes.remove(n.id), true);
      assert.equal(repos.notes.listByMedication(med.id).length, 0);
    } finally {
      cleanup();
    }
  });

  test(`[${label}] interaction warning repository: active filter, resolve`, () => {
    const { repos, cleanup } = factory();
    try {
      const w = repos.interactionWarnings.insert({
        patientId: 'p1',
        medicationIdA: 'm1',
        medicationIdB: 'm2',
        description: 'bad combo',
        status: 'active',
      });
      repos.interactionWarnings.insert({
        patientId: 'p1',
        medicationIdA: 'm3',
        medicationIdB: 'm4',
        status: 'resolved',
      });
      assert.equal(repos.interactionWarnings.listByPatient('p1').length, 2);
      assert.equal(repos.interactionWarnings.listActiveByPatient('p1').length, 1);
      repos.interactionWarnings.update(w.id, { status: 'resolved' });
      assert.equal(repos.interactionWarnings.listActiveByPatient('p1').length, 0);
    } finally {
      cleanup();
    }
  });

  test(`[${label}] interaction rule repository: unordered pair keying, replace, remove`, () => {
    const { repos, cleanup } = factory();
    try {
      repos.interactionRules.insert({ drugA: 'warfarin', drugB: 'aspirin', severity: 'high' });
      // Same unordered pair -> replace.
      repos.interactionRules.insert({ drugA: 'aspirin', drugB: 'warfarin', severity: 'critical' });
      assert.equal(repos.interactionRules.list().length, 1, 'unordered pair dedupes');
      const rule = repos.interactionRules.getByPair('warfarin', 'aspirin');
      assert.equal(rule.severity, 'critical');
      // Lookup with swapped order still finds it.
      assert.ok(repos.interactionRules.getByPair('aspirin', 'warfarin'));
      assert.equal(repos.interactionRules.remove('aspirin', 'warfarin'), true);
      assert.equal(repos.interactionRules.list().length, 0);
    } finally {
      cleanup();
    }
  });

  test(`[${label}] notification repository: payload roundtrip, listByStatus, update`, () => {
    const { repos, cleanup } = factory();
    try {
      const n = repos.notifications.insert({
        type: 'dose',
        recipientRef: 'p1',
        channel: 'email',
        payload: { medication: 'Aspirin', dosage: '100mg' },
        status: 'pending',
        attemptCount: 0,
        maxAttempts: 3,
      });
      assert.deepEqual(n.payload, { medication: 'Aspirin', dosage: '100mg' });
      repos.notifications.insert({ type: 'refill', recipientRef: 'p1', status: 'undelivered' });
      assert.equal(repos.notifications.listByStatus('pending').length, 1);
      assert.equal(repos.notifications.listByStatus('undelivered').length, 1);
      const upd = repos.notifications.update(n.id, { status: 'delivered', attemptCount: 1 });
      assert.equal(upd.status, 'delivered');
      assert.equal(upd.attemptCount, 1);
      assert.equal(repos.notifications.remove(n.id), true);
    } finally {
      cleanup();
    }
  });

  test(`[${label}] provider assignment repository: isActivelyAssigned honors revocation`, () => {
    const { repos, cleanup } = factory();
    try {
      const a = repos.providerAssignments.insert({ providerId: 'dr1', patientId: 'p1', active: true });
      repos.providerAssignments.insert({ providerId: 'dr1', patientId: 'p2', active: false });
      assert.equal(repos.providerAssignments.listByProvider('dr1').length, 2);
      assert.equal(repos.providerAssignments.listByPatient('p1').length, 1);
      assert.equal(repos.providerAssignments.isActivelyAssigned('dr1', 'p1'), true);
      assert.equal(repos.providerAssignments.isActivelyAssigned('dr1', 'p2'), false);
      repos.providerAssignments.update(a.id, { active: false });
      assert.equal(repos.providerAssignments.isActivelyAssigned('dr1', 'p1'), false, 'revoked');
    } finally {
      cleanup();
    }
  });

  test(`[${label}] audit entry repository: append-only, listByUser/Record`, () => {
    const { repos, cleanup } = factory();
    try {
      repos.auditEntries.insert({ userId: 'u1', recordRef: 'r1', action: 'read', timestamp: 't1' });
      repos.auditEntries.insert({ userId: 'u1', recordRef: 'r2', action: 'read', timestamp: 't2' });
      repos.auditEntries.insert({ userId: 'u2', recordRef: 'r1', action: 'read', timestamp: 't3' });
      assert.equal(repos.auditEntries.list().length, 3);
      assert.equal(repos.auditEntries.listByUser('u1').length, 2);
      assert.equal(repos.auditEntries.listByRecord('r1').length, 2);
    } finally {
      cleanup();
    }
  });
}

/* -------------------------------------------------------------------------
 * SQLite-specific: encryption-key resolution + temp-file lifecycle (R12.2)
 * ----------------------------------------------------------------------- */

test('resolveEncryptionKey prefers explicit key, then env, else null', () => {
  assert.equal(resolveEncryptionKey('explicit', {}), 'explicit');
  assert.equal(resolveEncryptionKey(null, { [ENCRYPTION_KEY_ENV]: 'from-env' }), 'from-env');
  assert.equal(resolveEncryptionKey(undefined, {}), null);
  assert.equal(resolveEncryptionKey('', { [ENCRYPTION_KEY_ENV]: '' }), null);
});

test('sqlite: file-backed database persists across connections and cleans up', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mms-sqlite-'));
  const file = join(dir, 'mms.db');
  try {
    const db1 = openDatabase({ filename: file, encryptionKey: 'runtime-secret' });
    const repos1 = createSqliteRepositories(db1);
    const med = repos1.medications.insert({ patientId: 'p1', name: 'Persisted', active: true });
    db1.pragma('wal_checkpoint(TRUNCATE)');
    db1.close();

    assert.ok(existsSync(file), 'database file created');

    // Reopen with the SAME key: data is readable.
    const db2 = openDatabase({ filename: file, encryptionKey: 'runtime-secret', applySchema: false });
    const repos2 = createSqliteRepositories(db2);
    assert.equal(repos2.medications.getById(med.id).name, 'Persisted');
    db2.pragma('wal_checkpoint(TRUNCATE)');
    db2.close();
  } finally {
    // On Windows the OS may briefly hold the file handle after close; retry.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        rmSync(dir, { recursive: true, force: true });
        break;
      } catch (err) {
        if (attempt === 9) throw err;
        const until = Date.now() + 50;
        while (Date.now() < until) { /* brief spin before retry */ }
      }
    }
    assert.equal(existsSync(dir), false, 'temp dir cleaned up');
  }
});
