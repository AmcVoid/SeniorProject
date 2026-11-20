/**
 * Unit tests for the audit logging wrapper (task 17.3).
 *
 * Covers Requirement 12.3: every PHI access records exactly one audit entry
 * (identifying user, record, and timestamp), and the access fails closed when
 * the audit write fails. The design property test (Property 35, task 17.6) is
 * implemented separately.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { recordPhiAccess, withAudit, AuditWriteError } from './audit.js';
import { createInMemoryAuditEntryRepository } from '../data/memory.js';

/** A repository whose insert always throws, to exercise the fail-closed path. */
function failingAuditRepository() {
  return {
    insert() {
      throw new Error('audit store unavailable');
    },
    getById: () => null,
    listByUser: () => [],
    listByRecord: () => [],
    list: () => [],
  };
}

// --- recordPhiAccess ---

test('recordPhiAccess records exactly one entry with user, record, timestamp', () => {
  const auditEntries = createInMemoryAuditEntryRepository();
  const clock = () => '2026-01-01T00:00:00.000Z';

  const entry = recordPhiAccess(
    { userId: 'u1', recordRef: 'med:42', action: 'read' },
    { auditEntries, clock },
  );

  const all = auditEntries.list();
  assert.equal(all.length, 1);
  assert.equal(entry.userId, 'u1');
  assert.equal(entry.recordRef, 'med:42');
  assert.equal(entry.action, 'read');
  assert.equal(entry.timestamp, '2026-01-01T00:00:00.000Z');
  assert.ok(entry.id, 'entry is assigned an id by the repository');
});

test('recordPhiAccess defaults action to "read"', () => {
  const auditEntries = createInMemoryAuditEntryRepository();
  const entry = recordPhiAccess(
    { userId: 'u1', recordRef: 'med:42' },
    { auditEntries },
  );
  assert.equal(entry.action, 'read');
});

test('recordPhiAccess fails closed as AuditWriteError when the write throws', () => {
  const auditEntries = failingAuditRepository();
  assert.throws(
    () => recordPhiAccess({ userId: 'u1', recordRef: 'med:42' }, { auditEntries }),
    (err) => {
      assert.ok(err instanceof AuditWriteError);
      assert.equal(err.code, 'AUDIT_WRITE_FAILED');
      assert.ok(err.cause instanceof Error);
      return true;
    },
  );
});

test('recordPhiAccess validates required inputs and deps', () => {
  const auditEntries = createInMemoryAuditEntryRepository();
  assert.throws(() => recordPhiAccess({ recordRef: 'r' }, { auditEntries }), TypeError);
  assert.throws(() => recordPhiAccess({ userId: 'u' }, { auditEntries }), TypeError);
  assert.throws(() => recordPhiAccess({ userId: 'u', recordRef: 'r' }, {}), TypeError);
});

// --- withAudit ---

test('withAudit records one entry then runs the PHI operation', () => {
  const auditEntries = createInMemoryAuditEntryRepository();
  let ran = false;
  const result = withAudit(
    { userId: 'u1', recordRef: 'med:42' },
    () => {
      ran = true;
      return { phi: 'secret' };
    },
    { auditEntries },
  );

  assert.equal(ran, true);
  assert.deepEqual(result, { phi: 'secret' });
  assert.equal(auditEntries.list().length, 1);
});

test('withAudit fails closed: PHI operation never runs when audit write fails', () => {
  const auditEntries = failingAuditRepository();
  let ran = false;
  assert.throws(
    () =>
      withAudit(
        { userId: 'u1', recordRef: 'med:42' },
        () => {
          ran = true;
          return 'phi';
        },
        { auditEntries },
      ),
    AuditWriteError,
  );
  assert.equal(ran, false, 'PHI operation must not execute on audit failure');
});

test('withAudit records exactly one entry even when the PHI operation throws', () => {
  const auditEntries = createInMemoryAuditEntryRepository();
  assert.throws(
    () =>
      withAudit(
        { userId: 'u1', recordRef: 'med:42' },
        () => {
          throw new Error('read failed downstream');
        },
        { auditEntries },
      ),
    /read failed downstream/,
  );
  // The access was audited exactly once before the operation ran.
  assert.equal(auditEntries.list().length, 1);
});

test('withAudit requires operation to be a function', () => {
  const auditEntries = createInMemoryAuditEntryRepository();
  assert.throws(
    () => withAudit({ userId: 'u1', recordRef: 'r' }, null, { auditEntries }),
    TypeError,
  );
});
