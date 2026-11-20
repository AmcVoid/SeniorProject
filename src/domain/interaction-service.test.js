/**
 * Unit tests for InteractionService (task 8.1).
 *
 * Covers the pure `evaluateInteractions` detection (one warning per matched
 * unordered active-medication pair, identifying both medications and the
 * interaction nature — R7.1, R7.2), the `reconcileWarnings` diff, and the
 * persistence-bound service that recomputes on add/remove and marks warnings
 * resolved when a match breaks (R7.4), surfacing active warnings (R7.3, R6.4).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateInteractions,
  reconcileWarnings,
  createInteractionService,
} from './interaction-service.js';
import { createMedication, createInteractionRule } from './models.js';
import { InteractionWarningStatus } from './types.js';
import {
  createInMemoryInteractionWarningRepository,
  createInMemoryInteractionRuleRepository,
} from '../data/memory.js';

/** Build a medication with a fixed id/name for a patient. */
function med(id, name, patientId = 'p1') {
  return createMedication({ id, patientId, name, dosage: '1', schedule: { times: ['08:00'] } });
}

/** Build a fresh service + repos, seeded with the given rules. */
function setup(rules = []) {
  const interactionWarnings = createInMemoryInteractionWarningRepository();
  const interactionRules = createInMemoryInteractionRuleRepository();
  for (const r of rules) interactionRules.insert(r);
  const service = createInteractionService({ interactionWarnings, interactionRules });
  return { service, interactionWarnings, interactionRules };
}

test('evaluateInteractions emits one warning per matched unordered pair (R7.1)', () => {
  const meds = [med('m1', 'Aspirin'), med('m2', 'Warfarin'), med('m3', 'Vitamin C')];
  const rules = [
    createInteractionRule({ drugA: 'Warfarin', drugB: 'Aspirin', description: 'bleeding risk' }),
  ];
  const warnings = evaluateInteractions(meds, rules);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].description, 'bleeding risk');
});

test('evaluateInteractions identifies both medications and the interaction nature (R7.2)', () => {
  const meds = [med('m1', 'Aspirin'), med('m2', 'Warfarin')];
  const rules = [
    createInteractionRule({ drugA: 'Aspirin', drugB: 'Warfarin', description: 'bleeding risk' }),
  ];
  const [w] = evaluateInteractions(meds, rules);
  // Pair is unordered/normalized; both ids present.
  assert.deepEqual([w.medicationIdA, w.medicationIdB].sort(), ['m1', 'm2']);
  assert.equal(w.description, 'bleeding risk');
  assert.equal(w.status, InteractionWarningStatus.ACTIVE);
  assert.equal(w.patientId, 'p1');
});

test('evaluateInteractions matches drug names case-insensitively', () => {
  const meds = [med('m1', ' aspirin '), med('m2', 'WARFARIN')];
  const rules = [
    createInteractionRule({ drugA: 'Aspirin', drugB: 'Warfarin', description: 'x' }),
  ];
  assert.equal(evaluateInteractions(meds, rules).length, 1);
});

test('evaluateInteractions emits no warnings when no pair matches a rule', () => {
  const meds = [med('m1', 'Aspirin'), med('m2', 'Ibuprofen')];
  const rules = [
    createInteractionRule({ drugA: 'Warfarin', drugB: 'Aspirin', description: 'x' }),
  ];
  assert.deepEqual(evaluateInteractions(meds, rules), []);
});

test('evaluateInteractions handles empty inputs', () => {
  assert.deepEqual(evaluateInteractions([], []), []);
  assert.deepEqual(evaluateInteractions(undefined, undefined), []);
});

test('evaluateInteractions emits one warning per pair across three interacting meds', () => {
  const meds = [med('m1', 'A'), med('m2', 'B'), med('m3', 'C')];
  const rules = [
    createInteractionRule({ drugA: 'A', drugB: 'B', description: 'ab' }),
    createInteractionRule({ drugA: 'B', drugB: 'C', description: 'bc' }),
    createInteractionRule({ drugA: 'A', drugB: 'C', description: 'ac' }),
  ];
  assert.equal(evaluateInteractions(meds, rules).length, 3);
});

test('reconcileWarnings creates newly matched pairs and resolves broken ones (R7.4)', () => {
  // Existing active warning for a pair {m1,m2} that is no longer matched.
  const existing = [
    {
      id: 'w1',
      patientId: 'p1',
      medicationIdA: 'm1',
      medicationIdB: 'm2',
      description: 'old',
      status: InteractionWarningStatus.ACTIVE,
    },
  ];
  // Evaluated set now matches a different pair {m1,m3}.
  const evaluated = evaluateInteractions(
    [med('m1', 'A'), med('m3', 'C')],
    [createInteractionRule({ drugA: 'A', drugB: 'C', description: 'ac' })],
  );

  const { toCreate, toResolve } = reconcileWarnings(evaluated, existing);
  assert.equal(toCreate.length, 1);
  assert.deepEqual([toCreate[0].medicationIdA, toCreate[0].medicationIdB].sort(), ['m1', 'm3']);
  assert.equal(toResolve.length, 1);
  assert.equal(toResolve[0].id, 'w1');
  assert.equal(toResolve[0].status, InteractionWarningStatus.RESOLVED);
});

test('reconcileWarnings leaves a still-matching active warning untouched (no duplicate)', () => {
  const existing = [
    {
      id: 'w1',
      patientId: 'p1',
      medicationIdA: 'm1',
      medicationIdB: 'm2',
      description: 'x',
      status: InteractionWarningStatus.ACTIVE,
    },
  ];
  const evaluated = evaluateInteractions(
    [med('m1', 'A'), med('m2', 'B')],
    [createInteractionRule({ drugA: 'A', drugB: 'B', description: 'x' })],
  );
  const { toCreate, toResolve } = reconcileWarnings(evaluated, existing);
  assert.equal(toCreate.length, 0);
  assert.equal(toResolve.length, 0);
});

test('refreshForPatient persists a warning when adding an interacting medication (R7.1)', () => {
  const { service, interactionWarnings } = setup([
    createInteractionRule({ drugA: 'Aspirin', drugB: 'Warfarin', description: 'bleeding' }),
  ]);
  const active = service.refreshForPatient('p1', [med('m1', 'Aspirin'), med('m2', 'Warfarin')]);
  assert.equal(active.length, 1);
  assert.equal(interactionWarnings.listActiveByPatient('p1').length, 1);
  assert.equal(active[0].description, 'bleeding');
});

test('refreshForPatient marks a warning resolved when a medication is removed (R7.4)', () => {
  const { service, interactionWarnings } = setup([
    createInteractionRule({ drugA: 'Aspirin', drugB: 'Warfarin', description: 'bleeding' }),
  ]);
  // Add both — warning created.
  service.refreshForPatient('p1', [med('m1', 'Aspirin'), med('m2', 'Warfarin')]);
  assert.equal(interactionWarnings.listActiveByPatient('p1').length, 1);

  // Remove one — the match breaks; warning is resolved, not deleted.
  const active = service.refreshForPatient('p1', [med('m1', 'Aspirin')]);
  assert.equal(active.length, 0);
  assert.equal(interactionWarnings.listActiveByPatient('p1').length, 0);
  const all = interactionWarnings.listByPatient('p1');
  assert.equal(all.length, 1);
  assert.equal(all[0].status, InteractionWarningStatus.RESOLVED);
});

test('refreshForPatient is idempotent — re-running does not duplicate warnings', () => {
  const { service, interactionWarnings } = setup([
    createInteractionRule({ drugA: 'A', drugB: 'B', description: 'x' }),
  ]);
  const meds = [med('m1', 'A'), med('m2', 'B')];
  service.refreshForPatient('p1', meds);
  service.refreshForPatient('p1', meds);
  assert.equal(interactionWarnings.listActiveByPatient('p1').length, 1);
});

test('listActiveWarnings surfaces only active warnings (R7.3, R6.4)', () => {
  const { service } = setup([
    createInteractionRule({ drugA: 'A', drugB: 'B', description: 'x' }),
  ]);
  service.refreshForPatient('p1', [med('m1', 'A'), med('m2', 'B')]);
  service.refreshForPatient('p1', [med('m1', 'A')]); // resolve it
  assert.equal(service.listActiveWarnings('p1').length, 0);
});
