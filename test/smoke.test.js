/**
 * Smoke test for the project scaffolding (task 1).
 *
 * Confirms that:
 *  1. fast-check is installed and runs a property with >= 100 iterations.
 *  2. The shared domain enums are importable/wired and carry the expected values.
 *
 * This is intentionally trivial; real property tests (Properties 1-36) live
 * next to the code they validate in later tasks.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  Role,
  DoseEventStatus,
  DoseLogStatus,
  NotificationType,
  NotificationStatus,
  InteractionWarningStatus,
  Enums,
} from '../src/domain/types.js';

test('fast-check is wired and runs at least 100 iterations', () => {
  let runs = 0;
  fc.assert(
    fc.property(fc.integer(), fc.integer(), (a, b) => {
      runs += 1;
      // Trivial, always-true property: integer addition is commutative.
      return a + b === b + a;
    }),
    { numRuns: 100 },
  );
  assert.ok(runs >= 100, `expected >= 100 iterations, got ${runs}`);
});

test('shared domain enums are importable and carry expected values', () => {
  assert.deepEqual(Object.values(Role).sort(), ['patient', 'provider']);
  assert.deepEqual(Object.values(DoseEventStatus).sort(), ['missed', 'pending', 'taken']);
  assert.deepEqual(Object.values(DoseLogStatus).sort(), ['missed', 'taken']);
  assert.deepEqual(Object.values(NotificationType).sort(), ['dose', 'missed', 'refill']);
  assert.deepEqual(
    Object.values(NotificationStatus).sort(),
    ['delivered', 'failed', 'pending', 'undelivered'],
  );
  assert.deepEqual(Object.values(InteractionWarningStatus).sort(), ['active', 'resolved']);

  // The aggregate export exposes every enum.
  assert.deepEqual(Object.keys(Enums).sort(), [
    'DoseEventStatus',
    'DoseLogStatus',
    'InteractionWarningStatus',
    'NotificationStatus',
    'NotificationType',
    'Role',
  ]);
});
