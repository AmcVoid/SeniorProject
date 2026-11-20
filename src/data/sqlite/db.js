/**
 * SQLite connection factory for the Medication Management System.
 *
 * Responsibilities:
 * - Open a `better-sqlite3` connection (file-backed or in-memory).
 * - Apply the at-rest encryption key at runtime (SQLCipher-style `PRAGMA key`)
 *   from an injected secret, BEFORE any other statement touches the database.
 * - Load and apply the schema DDL (`schema.sql`) so a fresh database is ready.
 *
 * PHI at-rest protection (R12.2)
 * ------------------------------
 * The encryption key is NEVER hard-coded and NEVER stored beside the database
 * file. It is supplied at runtime, either:
 *   - explicitly via the `encryptionKey` option (from a secret store), or
 *   - from the `MMS_DB_ENCRYPTION_KEY` environment variable (injected by the
 *     deployment's secret manager).
 *
 * When the installed SQLite build is SQLCipher-capable, `PRAGMA key` transparently
 * encrypts the database file. The stock `better-sqlite3` binary is NOT compiled
 * with SQLCipher, so `PRAGMA key` is a harmless no-op there; in that deployment
 * at-rest protection relies on host disk/volume encryption (full-disk / encrypted
 * volume) while this code path keeps the runtime-key-from-secret-store design so
 * swapping in a SQLCipher build requires no application changes.
 *
 * The connection is synchronous (better-sqlite3), matching the repository
 * contracts in `../interfaces.js`.
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, 'schema.sql');

/**
 * Environment variable the deployment's secret manager injects the key into.
 * Kept as a name (not a value) so no key material lives in source.
 */
export const ENCRYPTION_KEY_ENV = 'MMS_DB_ENCRYPTION_KEY';

/**
 * Resolve the at-rest encryption key from an explicit option or the injected
 * environment variable. Returns `null` when no key is configured (development
 * / test convenience) — callers relying on encryption should ensure a key is
 * present in production.
 *
 * @param {string|null|undefined} explicitKey
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string|null}
 */
export function resolveEncryptionKey(explicitKey, env = process.env) {
  if (explicitKey != null && explicitKey !== '') return String(explicitKey);
  const fromEnv = env?.[ENCRYPTION_KEY_ENV];
  if (fromEnv != null && fromEnv !== '') return String(fromEnv);
  return null;
}

/**
 * Apply the SQLCipher-style key to a freshly opened connection. Must run before
 * any table access so the key is established for the whole session.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string|null} key
 */
export function applyEncryptionKey(db, key) {
  if (key == null || key === '') return;
  // Bind the key as a quoted string literal via SQLCipher's PRAGMA. A raw
  // string key is used (SQLCipher derives the actual key). Escaping single
  // quotes prevents PRAGMA syntax breakage; the value is not user-facing SQL.
  const escaped = String(key).replace(/'/g, "''");
  db.pragma(`key = '${escaped}'`);
}

/**
 * Open a SQLite connection with encryption applied and the schema loaded.
 *
 * @param {object} [options]
 * @param {string} [options.filename] - Path to the database file. Defaults to
 *   an anonymous in-memory database (`:memory:`).
 * @param {string|null} [options.encryptionKey] - Runtime key from a secret
 *   store; falls back to the `MMS_DB_ENCRYPTION_KEY` env var.
 * @param {boolean} [options.applySchema=true] - Whether to run schema.sql.
 * @param {NodeJS.ProcessEnv} [options.env] - Environment (for key resolution).
 * @returns {import('better-sqlite3').Database}
 */
export function openDatabase({
  filename = ':memory:',
  encryptionKey = undefined,
  applySchema = true,
  env = process.env,
} = {}) {
  const db = new Database(filename);

  // 1. Establish the encryption key first, from the injected runtime secret.
  applyEncryptionKey(db, resolveEncryptionKey(encryptionKey, env));

  // 2. Sensible operational pragmas.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // 3. Load structure.
  if (applySchema) {
    db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  }

  return db;
}
