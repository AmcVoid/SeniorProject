/**
 * Unit tests for refill supply logic (task 14.1).
 *
 * Covers refill-reminder eligibility (including the at-or-below boundary),
 * caregiver routing per the per-medication flag, and `recordRefill` setting
 * remaining supply to original plus the non-negative refill amount.
 *
 * The numbered design Properties 16, 18, and 19 (tasks 14.2-14.4) are optional,
 * separate tasks and are NOT implemented here.
 *
 * Requirements: 5.1, 5.3, 5.4.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isRefillDue,
  shouldNotifyCaregiversForRefill,
  computeRefilledSupply,
  createRefillService,
} from './refill.js';
import { createInMemoryMedicationRepository } from '../data/memory.js';

test('refill is due when remaining supply is below the threshold', () => {
  assert.equal(isRefillDue({ remainingSupply: 3, refillThreshold: 5 }), true);
});

test('refill is due at exactly the threshold (boundary is inclusive)', () => {
  assert.equal(isRefillDue({ remainingSupply: 5, refillThreshold: 5 }), true);
});

test('refill is not due when remaining supply is above the threshold', () => {
  assert.equal(isRefillDue({ remainingSupply: 6, refillThreshold: 5 }), false);
});

test('malformed supply/threshold are treated as not due', () => {
  assert.equal(isRefillDue({ remainingSupply: NaN, refillThreshold: 5 }), false);
  assert.equal(isRefillDue({ remainingSupply: 3, refillThreshold: NaN }), false);
  assert.equal(isRefillDue(), false);
});

test('caregiver refill routing follows the per-medication flag', () => {
  assert.equal(
    shouldNotifyCaregiversForRefill({ caregiverRefillNotificationsEnabled: true }),
    true,
  );
  assert.equal(
    shouldNotifyCaregiversForRefill({ caregiverRefillNotificationsEnabled: false }),
    false,
  );
  assert.equal(shouldNotifyCaregiversForRefill({}), false);
  assert.equal(shouldNotifyCaregiversForRefill(null), false);
});

test('computeRefilledSupply adds the non-negative amount to the original', () => {
  assert.equal(computeRefilledSupply(10, 5), 15);
  assert.equal(computeRefilledSupply(0, 0), 0);
  assert.equal(computeRefilledSupply(7, 0), 7);
});

test('computeRefilledSupply rejects negative or non-finite amounts', () => {
  assert.throws(() => computeRefilledSupply(10, -1), RangeError);
  assert.throws(() => computeRefilledSupply(10, NaN), RangeError);
  assert.throws(() => computeRefilledSupply(NaN, 5), RangeError);
});

test('recordRefill sets remaining supply to original plus the refill amount', () => {
  const medications = createInMemoryMedicationRepository();
  const service = createRefillService({ medications });
  const stored = medications.insert({
    patientId: 'p1',
    name: 'Aspirin',
    refillThreshold: 5,
    remainingSupply: 10,
    caregiverRefillNotificationsEnabled: true,
  });

  const updated = service.recordRefill(stored.id, 8);

  assert.equal(updated.remainingSupply, 18);
  assert.equal(medications.getById(stored.id).remainingSupply, 18);
});

test('recordRefill with a zero amount leaves the supply unchanged', () => {
  const medications = createInMemoryMedicationRepository();
  const service = createRefillService({ medications });
  const stored = medications.insert({
    patientId: 'p1',
    remainingSupply: 4,
    refillThreshold: 5,
  });

  const updated = service.recordRefill(stored.id, 0);

  assert.equal(updated.remainingSupply, 4);
});

test('recordRefill returns null for an unknown medication', () => {
  const medications = createInMemoryMedicationRepository();
  const service = createRefillService({ medications });

  assert.equal(service.recordRefill('does-not-exist', 5), null);
});

test('recordRefill scoped to a patient ignores medications owned by others', () => {
  const medications = createInMemoryMedicationRepository();
  const service = createRefillService({ medications });
  const stored = medications.insert({
    patientId: 'p1',
    remainingSupply: 2,
    refillThreshold: 5,
  });

  assert.equal(service.recordRefill(stored.id, 5, { patientId: 'p2' }), null);
  // Supply must be untouched when the ownership check fails.
  assert.equal(medications.getById(stored.id).remainingSupply, 2);

  const updated = service.recordRefill(stored.id, 5, { patientId: 'p1' });
  assert.equal(updated.remainingSupply, 7);
});

test('recordRefill rejects a negative refill amount', () => {
  const medications = createInMemoryMedicationRepository();
  const service = createRefillService({ medications });
  const stored = medications.insert({ patientId: 'p1', remainingSupply: 5 });

  assert.throws(() => service.recordRefill(stored.id, -3), RangeError);
});

test('service predicates delegate to the pure helpers', () => {
  const medications = createInMemoryMedicationRepository();
  const service = createRefillService({ medications });

  assert.equal(
    service.isRefillDue({ remainingSupply: 5, refillThreshold: 5 }),
    true,
  );
  assert.equal(
    service.isRefillDue({ remainingSupply: 6, refillThreshold: 5 }),
    false,
  );
  assert.equal(
    service.shouldNotifyCaregivers({ caregiverRefillNotificationsEnabled: true }),
    true,
  );
  assert.equal(
    service.shouldNotifyCaregivers({ caregiverRefillNotificationsEnabled: false }),
    false,
  );
});
