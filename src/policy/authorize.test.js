/**
 * Unit tests for the authorization policy layer (task 17.2).
 *
 * Exercises the central `authorize(identity, action, resource)` contract:
 * patient ownership (R11.3), provider assignment (R11.4, R6.3), denial of
 * unauthenticated requests (R11.5), and denial after revocation (R12.4). The
 * numbered property test (Property 34) is task 17.5 and is intentionally not
 * implemented here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { authorize, isAuthorized, DecisionReason } from './authorize.js';
import { Role } from '../domain/types.js';
import {
  createInMemoryProviderAssignmentRepository,
} from '../data/memory.js';

const patient = (userId) => ({ userId, role: Role.PATIENT });
const provider = (userId) => ({ userId, role: Role.PROVIDER });
const phi = (patientId) => ({ id: 'rec-1', patientId });

/** A provider-assignment repo with (providerId, patientId) actively assigned. */
function repoWithAssignment(providerId, patientId, { active = true } = {}) {
  const repo = createInMemoryProviderAssignmentRepository();
  repo.insert({ providerId, patientId, active });
  return { providerAssignments: repo };
}

// --- Patient ownership (R11.3) ---

test('grants a patient access to their own record', () => {
  const decision = authorize(patient('p1'), 'read', phi('p1'), {});
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, DecisionReason.PATIENT_OWNER);
});

test('denies a patient access to another patient record', () => {
  const decision = authorize(patient('p1'), 'read', phi('p2'), {});
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, DecisionReason.NOT_OWNER);
});

test('patient ownership compares ids by value, not reference/type', () => {
  assert.equal(isAuthorized(patient(1), 'read', phi('1'), {}), true);
});

// --- Provider assignment (R11.4, R6.3) ---

test('grants an assigned provider access to the patient record', () => {
  const deps = repoWithAssignment('doc1', 'p1');
  const decision = authorize(provider('doc1'), 'read', phi('p1'), deps);
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, DecisionReason.PROVIDER_ASSIGNED);
});

test('denies a provider not assigned to the patient', () => {
  const deps = repoWithAssignment('doc1', 'p1');
  const decision = authorize(provider('doc1'), 'read', phi('p2'), deps);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, DecisionReason.NOT_ASSIGNED);
});

test('denies a provider with no assignments at all', () => {
  const deps = { providerAssignments: createInMemoryProviderAssignmentRepository() };
  assert.equal(isAuthorized(provider('doc1'), 'read', phi('p1'), deps), false);
});

// --- Revocation (R12.4) ---

test('denies a provider whose assignment has been revoked (inactive)', () => {
  const deps = repoWithAssignment('doc1', 'p1', { active: false });
  const decision = authorize(provider('doc1'), 'read', phi('p1'), deps);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, DecisionReason.NOT_ASSIGNED);
});

test('access flips from allowed to denied after revocation', () => {
  const repo = createInMemoryProviderAssignmentRepository();
  const assignment = repo.insert({ providerId: 'doc1', patientId: 'p1', active: true });
  const deps = { providerAssignments: repo };

  assert.equal(isAuthorized(provider('doc1'), 'read', phi('p1'), deps), true);

  repo.update(assignment.id, { active: false }); // revoke
  assert.equal(isAuthorized(provider('doc1'), 'read', phi('p1'), deps), false);
});

// --- Unauthenticated requests (R11.5) ---

test('denies an unauthenticated request (null identity)', () => {
  const decision = authorize(null, 'read', phi('p1'), {});
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, DecisionReason.UNAUTHENTICATED);
});

test('denies an identity missing a subject or role', () => {
  assert.equal(authorize({ role: Role.PATIENT }, 'read', phi('p1'), {}).reason, DecisionReason.UNAUTHENTICATED);
  assert.equal(authorize({ userId: 'p1' }, 'read', phi('p1'), {}).reason, DecisionReason.UNAUTHENTICATED);
  assert.equal(authorize(undefined, 'read', phi('p1'), {}).reason, DecisionReason.UNAUTHENTICATED);
});

// --- Malformed resource / role ---

test('denies when the resource carries no patientId', () => {
  const decision = authorize(patient('p1'), 'read', { id: 'rec-1' }, {});
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, DecisionReason.INVALID_RESOURCE);
});

test('denies an unknown role by default', () => {
  const decision = authorize({ userId: 'x', role: 'admin' }, 'read', phi('p1'), {});
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, DecisionReason.UNKNOWN_ROLE);
});

test('throws if a provider is authorized without the assignments repository', () => {
  assert.throws(
    () => authorize(provider('doc1'), 'read', phi('p1'), {}),
    /providerAssignments/,
  );
});
