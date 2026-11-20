/**
 * Unit tests for the missed-dose designation rule (task 6.2).
 *
 * Verifies the grace-period boundary and the "unlogged" precondition. The
 * numbered design Property 11 (task 6.4) is an optional, separate task and is
 * NOT implemented here.
 *
 * Requirements: 3.3.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { isMissedDose } from './missed-dose.js';

const scheduledTimeMs = 1_000_000;
const gracePeriodMs = 60_000; // 1 minute
const deadline = scheduledTimeMs + gracePeriodMs; // 1_060_000

test('not missed while before the grace deadline', () => {
  assert.equal(
    isMissedDose({
      isLogged: false,
      scheduledTimeMs,
      gracePeriodMs,
      currentTimeMs: deadline - 1,
    }),
    false,
  );
});

test('not missed at exactly scheduled time + grace (boundary is exclusive)', () => {
  assert.equal(
    isMissedDose({
      isLogged: false,
      scheduledTimeMs,
      gracePeriodMs,
      currentTimeMs: deadline,
    }),
    false,
  );
});

test('missed once current time strictly exceeds the deadline', () => {
  assert.equal(
    isMissedDose({
      isLogged: false,
      scheduledTimeMs,
      gracePeriodMs,
      currentTimeMs: deadline + 1,
    }),
    true,
  );
});

test('a logged event is never missed, even well past the deadline', () => {
  assert.equal(
    isMissedDose({
      isLogged: true,
      scheduledTimeMs,
      gracePeriodMs,
      currentTimeMs: deadline + 1_000_000,
    }),
    false,
  );
});

test('zero grace period: missed strictly after the scheduled time', () => {
  assert.equal(
    isMissedDose({
      isLogged: false,
      scheduledTimeMs,
      gracePeriodMs: 0,
      currentTimeMs: scheduledTimeMs,
    }),
    false,
  );
  assert.equal(
    isMissedDose({
      isLogged: false,
      scheduledTimeMs,
      gracePeriodMs: 0,
      currentTimeMs: scheduledTimeMs + 1,
    }),
    true,
  );
});

test('malformed inputs are treated as not missed', () => {
  assert.equal(
    isMissedDose({
      isLogged: false,
      scheduledTimeMs: NaN,
      gracePeriodMs,
      currentTimeMs: deadline + 1,
    }),
    false,
  );
  assert.equal(
    isMissedDose({
      isLogged: false,
      scheduledTimeMs,
      gracePeriodMs: -1,
      currentTimeMs: deadline + 1,
    }),
    false,
  );
  assert.equal(isMissedDose(), false);
});
