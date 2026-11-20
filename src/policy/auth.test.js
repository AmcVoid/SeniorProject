/**
 * Unit tests for the Auth & Session layer (task 17.1).
 *
 * Covers Requirements 11.1 (valid credentials establish a session) and 11.2
 * (invalid credentials denied with a generic error, no user enumeration).
 * The design property test (Property 33, task 17.4) is implemented separately.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  authenticate,
  hashCredential,
  verifyCredential,
  AuthenticationError,
  createInMemorySession,
} from './auth.js';
import { createInMemoryUserRepository } from '../data/memory.js';
import { Role } from '../domain/types.js';
import { createSessionStore } from '../composition.js';

/** Seed a user repository with one registered patient. */
function seedUsers() {
  const users = createInMemoryUserRepository();
  const stored = users.insert({
    role: Role.PATIENT,
    identifier: 'alice@example.com',
    credentialHash: hashCredential('correct horse battery'),
  });
  return { users, stored };
}

// --- credential hashing / verification ---

test('hashCredential produces a salted, self-describing scrypt string', () => {
  const hash = hashCredential('s3cret');
  const parts = hash.split('$');
  assert.equal(parts.length, 3);
  assert.equal(parts[0], 'scrypt');
  assert.ok(parts[1].length > 0 && parts[2].length > 0);
});

test('hashCredential salts: same password hashes differently each time', () => {
  assert.notEqual(hashCredential('same'), hashCredential('same'));
});

test('verifyCredential accepts the matching password and rejects others', () => {
  const hash = hashCredential('open sesame');
  assert.equal(verifyCredential('open sesame', hash), true);
  assert.equal(verifyCredential('wrong', hash), false);
});

test('verifyCredential returns false for malformed input or hash', () => {
  assert.equal(verifyCredential('x', 'not-a-hash'), false);
  assert.equal(verifyCredential('x', 'bcrypt$aa$bb'), false, 'wrong scheme');
  assert.equal(verifyCredential('x', 'scrypt$$'), false, 'empty salt/hash');
  assert.equal(verifyCredential(null, hashCredential('x')), false);
  assert.equal(verifyCredential('x', null), false);
});

test('hashCredential rejects empty/non-string passwords', () => {
  assert.throws(() => hashCredential(''), TypeError);
  assert.throws(() => hashCredential(123), TypeError);
});

// --- authenticate: success (R11.1) ---

test('authenticate establishes a session for valid credentials (R11.1)', () => {
  const { users, stored } = seedUsers();
  const { session, identity } = authenticate(
    { identifier: 'alice@example.com', password: 'correct horse battery' },
    { users },
  );
  assert.equal(identity.userId, stored.id);
  assert.equal(identity.role, Role.PATIENT);
  assert.ok(session.token, 'a session token is issued');
  assert.equal(session.userId, stored.id);
  assert.equal(session.role, Role.PATIENT);
});

test('authenticate uses an injectable session factory', () => {
  const { users, stored } = seedUsers();
  const { session } = authenticate(
    { identifier: 'alice@example.com', password: 'correct horse battery' },
    { users, createSession: (id) => ({ custom: true, ...id }) },
  );
  assert.deepEqual(session, { custom: true, userId: stored.id, role: Role.PATIENT });
});

// --- authenticate: failure is generic (R11.2, no user enumeration) ---

test('authenticate denies a wrong password with a generic error (R11.2)', () => {
  const { users } = seedUsers();
  assert.throws(
    () => authenticate({ identifier: 'alice@example.com', password: 'nope' }, { users }),
    (err) => err instanceof AuthenticationError && err.code === 'AUTHENTICATION_FAILED',
  );
});

test('authenticate denies an unknown identifier with the SAME error (no enumeration)', () => {
  const { users } = seedUsers();
  let unknownMessage;
  let wrongMessage;
  try {
    authenticate({ identifier: 'nobody@example.com', password: 'whatever' }, { users });
  } catch (err) {
    unknownMessage = err.message;
    assert.ok(err instanceof AuthenticationError);
  }
  try {
    authenticate({ identifier: 'alice@example.com', password: 'wrong' }, { users });
  } catch (err) {
    wrongMessage = err.message;
  }
  assert.equal(
    unknownMessage,
    wrongMessage,
    'unknown-user and wrong-password errors are indistinguishable',
  );
});

test('authenticate denies empty/missing credentials generically', () => {
  const { users } = seedUsers();
  assert.throws(() => authenticate({}, { users }), AuthenticationError);
  assert.throws(
    () => authenticate({ identifier: '', password: '' }, { users }),
    AuthenticationError,
  );
});

test('authenticate requires a users repository dependency', () => {
  assert.throws(
    () => authenticate({ identifier: 'a', password: 'b' }, {}),
    TypeError,
  );
});

// --- Session expiration ---

test('createInMemorySession includes createdAt and expiresAt within TTL window', () => {
  const session = createInMemorySession({ userId: 'u1', role: Role.PATIENT }, { ttlMs: 60000 });
  assert.ok(session.token);
  assert.equal(session.userId, 'u1');
  assert.equal(session.role, Role.PATIENT);
  assert.ok(session.createdAt);
  assert.ok(session.expiresAt);
  const created = new Date(session.createdAt).getTime();
  const expires = new Date(session.expiresAt).getTime();
  assert.ok(expires > created);
  assert.equal(expires - created, 60000);
});

test('createSessionStore rejects and evicts expired sessions', () => {
  const store = createSessionStore();
  const activeSession = {
    token: 'active-token',
    userId: 'u1',
    role: Role.PATIENT,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };
  const expiredSession = {
    token: 'expired-token',
    userId: 'u2',
    role: Role.PATIENT,
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  };

  store.save(activeSession);
  store.save(expiredSession);

  assert.equal(store.getByToken('active-token')?.userId, 'u1');
  assert.equal(store.getByToken('expired-token'), null, 'expired session returns null');
  // Evicted from store:
  assert.equal(store.getByToken('expired-token'), null);
});
