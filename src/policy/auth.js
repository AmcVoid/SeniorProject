/**
 * Auth & Session layer (task 17.1).
 *
 * Establishes authenticated sessions from credentials and produces the
 * identity (role + subject) that the authorization policy layer (task 17.2)
 * consumes. This module is pure with respect to Express and I/O: credential
 * lookup is delegated to an injected `users` repository and session creation
 * to an injected `createSession` function, so the logic is directly unit- and
 * property-testable (design "Auth & Session").
 *
 * Security properties (Requirements 11.1, 11.2):
 * - Credentials are verified against a salted, per-user hash using Node's
 *   built-in scrypt KDF. No plaintext credential is ever stored or compared.
 * - Verification uses a constant-time comparison to avoid timing side channels.
 * - Authentication failures are GENERIC: an unknown identifier and a wrong
 *   password produce the identical error, so an attacker cannot enumerate
 *   which identifiers are registered (R11.2, "no user enumeration"). When the
 *   identifier is unknown we still perform a dummy hash verification so the
 *   response time does not reveal whether the user exists.
 */

import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

/** scrypt parameters. N=16384 (2^14) is a sane interactive default. */
const SCRYPT_KEYLEN = 64;
const SCRYPT_PARAMS = Object.freeze({ N: 16384, r: 8, p: 1 });
const SALT_BYTES = 16;
/** Prefix identifying our hash format: `scrypt$<saltHex>$<hashHex>`. */
const HASH_SCHEME = 'scrypt';

/**
 * Error raised when authentication fails. Intentionally carries a single
 * generic message for every failure mode (unknown user, wrong password,
 * malformed stored hash) so callers cannot distinguish them (R11.2).
 */
export class AuthenticationError extends Error {
  constructor(message = 'Invalid credentials') {
    super(message);
    this.name = 'AuthenticationError';
    /** Stable machine-readable code for the HTTP layer to map to 401. */
    this.code = 'AUTHENTICATION_FAILED';
  }
}

/**
 * Hash a plaintext credential into a self-describing, salted scrypt string.
 *
 * @param {string} password - The plaintext credential to hash.
 * @returns {string} `scrypt$<saltHex>$<derivedKeyHex>`.
 */
export function hashCredential(password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new TypeError('password must be a non-empty string');
  }
  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
  return `${HASH_SCHEME}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/**
 * Verify a plaintext credential against a stored scrypt hash in constant time.
 *
 * Returns `false` (never throws) for any mismatch, malformed input, or
 * malformed stored hash, so callers can treat all negative outcomes uniformly.
 *
 * @param {string} password - The plaintext credential supplied at login.
 * @param {string} storedHash - A hash produced by {@link hashCredential}.
 * @returns {boolean} True iff the credential matches the stored hash.
 */
export function verifyCredential(password, storedHash) {
  if (typeof password !== 'string' || typeof storedHash !== 'string') return false;
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== HASH_SCHEME) return false;
  const [, saltHex, hashHex] = parts;

  let salt;
  let expected;
  try {
    salt = Buffer.from(saltHex, 'hex');
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  const actual = scryptSync(password, salt, expected.length, SCRYPT_PARAMS);
  // Lengths are equal by construction (keylen == expected.length), but guard
  // anyway since timingSafeEqual throws on length mismatch.
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/**
 * A dummy hash used to equalize timing when the identifier is unknown. Running
 * a real scrypt verification against it means the "no such user" and "wrong
 * password" paths cost roughly the same, hardening against user enumeration
 * via timing (R11.2).
 */
const DUMMY_HASH = hashCredential('unused-placeholder-credential');

/**
 * Authenticate a user by identifier + password and establish a session.
 *
 * On success returns `{ session, identity }`, where `identity` is the
 * `{ userId, role }` pair the authorization policy layer expects (R11.1).
 * On ANY failure throws {@link AuthenticationError} with a generic message so
 * the caller cannot tell an unknown identifier from a bad password (R11.2).
 *
 * @param {object} credentials
 * @param {string} credentials.identifier - Login identifier (username/email).
 * @param {string} credentials.password - Plaintext credential.
 * @param {object} deps
 * @param {{ findByIdentifier: (identifier: string) => (object | null) }} deps.users
 *   User repository able to resolve a login identifier to a user record.
 * @param {(identity: {userId: *, role: string}) => object} [deps.createSession]
 *   Session factory; defaults to {@link createInMemorySession}.
 * @returns {{ session: object, identity: {userId: *, role: string} }}
 * @throws {AuthenticationError} On invalid credentials (generic).
 */
export function authenticate(
  { identifier, password } = {},
  { users, createSession = createInMemorySession } = {},
) {
  if (!users || typeof users.findByIdentifier !== 'function') {
    throw new TypeError('deps.users with findByIdentifier is required');
  }

  const user =
    typeof identifier === 'string' && identifier.length > 0
      ? users.findByIdentifier(identifier)
      : null;

  // Always run a verification (against a dummy hash when the user is unknown)
  // so timing does not reveal whether the identifier exists (R11.2).
  const storedHash = user?.credentialHash || DUMMY_HASH;
  const matches = verifyCredential(
    typeof password === 'string' ? password : '',
    storedHash,
  );

  if (!user || !matches) {
    throw new AuthenticationError();
  }

  const identity = { userId: user.id, role: user.role };
  const session = createSession(identity);
  return { session, identity };
}

/**
 * Default session factory: a plain, opaque session bearing the authenticated
 * identity and a random token. Swappable for a cookie/JWT-backed session at
 * the HTTP layer (design "Auth & Session", task 18.1).
 *
 * @param {{ userId: *, role: string }} identity
 * @param {object} [options]
 * @param {number} [options.ttlMs] - Session time-to-live in milliseconds (default: 24 hours).
 * @returns {{ token: string, userId: *, role: string, createdAt: string, expiresAt: string }}
 */
export function createInMemorySession(identity, { ttlMs = 24 * 60 * 60 * 1000 } = {}) {
  const now = Date.now();
  return {
    token: randomBytes(24).toString('hex'),
    userId: identity.userId,
    role: identity.role,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
  };
}
