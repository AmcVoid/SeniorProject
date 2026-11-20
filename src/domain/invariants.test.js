/**
 * Unit + property tests for the invariant-validation helpers (task 2.1).
 *
 * Covers the four invariants called out by the task:
 *   - attemptCount <= maxAttempts
 *   - unordered distinct medication pairs for warnings
 *   - adherenceRate in [0, 1] guard
 *   - at-most-one active log per event
 *
 * These are foundational validation primitives (Requirements 3.1, 7.1, 13.2);
 * the numbered design Properties (1-36) are implemented in their own tasks.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  isAttemptCountWithinMax,
  isValidWarningPair,
  warningPairKey,
  isAdherenceRateInRange,
  hasAtMostOneActiveLog,
  hasAtMostOneActiveLogPerEvent,
} from './invariants.js';

// --- attemptCount <= maxAttempts ---

test('isAttemptCountWithinMax accepts valid attempt counts', () => {
  assert.equal(isAttemptCountWithinMax({ attemptCount: 0, maxAttempts: 3 }), true);
  assert.equal(isAttemptCountWithinMax({ attemptCount: 3, maxAttempts: 3 }), true);
});

test('isAttemptCountWithinMax rejects overflow and malformed records', () => {
  assert.equal(isAttemptCountWithinMax({ attemptCount: 4, maxAttempts: 3 }), false);
  assert.equal(isAttemptCountWithinMax({ attemptCount: -1, maxAttempts: 3 }), false);
  assert.equal(isAttemptCountWithinMax({ attemptCount: 1, maxAttempts: 0 }), false);
  assert.equal(isAttemptCountWithinMax(null), false);
});

test('property: attemptCount<=maxAttempts holds iff count in [0, max]', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: -2, max: 10 }),
      fc.integer({ min: 0, max: 10 }),
      (attemptCount, maxAttempts) => {
        const expected =
          attemptCount >= 0 && maxAttempts >= 1 && attemptCount <= maxAttempts;
        return isAttemptCountWithinMax({ attemptCount, maxAttempts }) === expected;
      },
    ),
    { numRuns: 100 },
  );
});

// --- unordered distinct medication pairs ---

test('isValidWarningPair requires two distinct, present ids', () => {
  assert.equal(isValidWarningPair('a', 'b'), true);
  assert.equal(isValidWarningPair('a', 'a'), false);
  assert.equal(isValidWarningPair('a', null), false);
  assert.equal(isValidWarningPair(null, 'b'), false);
});

test('property: warningPairKey is order independent for distinct pairs', () => {
  fc.assert(
    fc.property(fc.string(), fc.string(), (a, b) => {
      return warningPairKey(a, b) === warningPairKey(b, a);
    }),
    { numRuns: 100 },
  );
});

// --- adherenceRate in [0, 1] guard ---

test('isAdherenceRateInRange passes vacuously when nothing scheduled', () => {
  assert.equal(isAdherenceRateInRange(NaN, 0), true);
});

test('isAdherenceRateInRange bounds the rate when doses scheduled', () => {
  assert.equal(isAdherenceRateInRange(0, 5), true);
  assert.equal(isAdherenceRateInRange(1, 5), true);
  assert.equal(isAdherenceRateInRange(0.5, 5), true);
  assert.equal(isAdherenceRateInRange(1.01, 5), false);
  assert.equal(isAdherenceRateInRange(-0.01, 5), false);
  assert.equal(isAdherenceRateInRange(0.5, -1), false);
});

test('property: rate is in range iff scheduledCount==0 or rate in [0,1]', () => {
  fc.assert(
    fc.property(
      fc.double({ min: -2, max: 2, noNaN: true }),
      fc.integer({ min: 0, max: 20 }),
      (rate, scheduledCount) => {
        const expected = scheduledCount === 0 ? true : rate >= 0 && rate <= 1;
        return isAdherenceRateInRange(rate, scheduledCount) === expected;
      },
    ),
    { numRuns: 100 },
  );
});

// --- at-most-one active log per event ---

test('hasAtMostOneActiveLog allows 0 or 1 logs', () => {
  assert.equal(hasAtMostOneActiveLog([]), true);
  assert.equal(hasAtMostOneActiveLog([{ doseEventId: 'e1' }]), true);
  assert.equal(hasAtMostOneActiveLog([{ doseEventId: 'e1' }, { doseEventId: 'e1' }]), false);
  assert.equal(hasAtMostOneActiveLog('nope'), false);
});

test('hasAtMostOneActiveLogPerEvent detects duplicate event logs', () => {
  assert.equal(
    hasAtMostOneActiveLogPerEvent([{ doseEventId: 'e1' }, { doseEventId: 'e2' }]),
    true,
  );
  assert.equal(
    hasAtMostOneActiveLogPerEvent([{ doseEventId: 'e1' }, { doseEventId: 'e1' }]),
    false,
  );
  assert.equal(hasAtMostOneActiveLogPerEvent([{ doseEventId: null }]), false);
});

test('property: at-most-one-active-log-per-event iff event ids are unique', () => {
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 0, max: 5 }), { maxLength: 8 }),
      (eventIds) => {
        const logs = eventIds.map((id) => ({ doseEventId: id }));
        const unique = new Set(eventIds).size === eventIds.length;
        return hasAtMostOneActiveLogPerEvent(logs) === unique;
      },
    ),
    { numRuns: 100 },
  );
});
