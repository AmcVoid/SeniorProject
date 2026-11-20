/**
 * Composition root for the Medication Management System (task 20.1).
 *
 * This is the single place where the otherwise-decoupled layers are wired into
 * a running application, following the request pipeline from design.md:
 *
 *   JSON API routes -> auth -> policy -> services -> repositories
 *
 * Everything below `createApp` (the HTTP factory in `./http/server.js`) is
 * pure/injectable: services take repositories, the scheduler takes a clock and
 * a dispatcher, the dispatcher takes channels. This module assembles that graph
 * once and returns the pieces so callers (the `npm start` entry point in
 * `./http/server.js`, or integration tests) can drive them without spawning
 * real timers or opening a real database unless they ask for it.
 *
 * What it wires:
 *  1. Repositories — SQLite (default) or in-memory (dev/test), selected by
 *     config. Both sets are shape-compatible (see data/memory.js and
 *     data/sqlite/repositories.js).
 *  2. A patients lookup and a users repository — the scheduler/dose-log service
 *     need `patient.gracePeriodMinutes`, and auth needs `findByIdentifier`.
 *  3. Domain services — medication, dose-log, adherence, contact, note,
 *     interaction — each bound to those repositories.
 *  4. The notification dispatcher with the stub email/SMS/in-app channels.
 *  5. A session store + a login endpoint so `sessions.getByToken` resolves the
 *     tokens the auth layer issues (R11.1).
 *  6. The Express app via `createApp`, mounting the JSON API through
 *     auth -> policy -> audit -> services, plus a `POST /api/auth/login`
 *     endpoint and the built React SPA served as static files with a
 *     client-side-routing fallback (non-/api requests -> index.html).
 *  7. A scheduler with a <=60s tick (R2.1, R13.1); starting the real timer is
 *     opt-in (`startScheduler`) so tests never spawn a live interval.
 *
 * Requirements supported: 2.1, 11.1, 12.3, 13.1.
 */

import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { createApp } from './http/server.js';
import { asyncHandler, sendError } from './http/middleware.js';

import { createInMemoryRepositories } from './data/memory.js';
import { openDatabase } from './data/sqlite/db.js';
import { createSqliteRepositories } from './data/sqlite/repositories.js';

import { createMedicationService } from './domain/medication.js';
import { createDoseLogService } from './domain/dose-log-service.js';
import { createAdherenceService } from './domain/adherence-service.js';
import { createContactService } from './domain/contact-service.js';
import { createNoteService } from './domain/note-service.js';
import { createInteractionService } from './domain/interaction-service.js';

import { createNotificationDispatcher } from './notifications/dispatcher.js';
import { createStubChannels } from './notifications/channels.js';

import { createScheduler } from './scheduler/scheduler.js';

import { authenticate, createInMemorySession } from './policy/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Default location of the built React SPA (Vite `build` output). */
const DEFAULT_CLIENT_DIST = resolve(__dirname, '..', 'client', 'dist');

/**
 * A minimal in-memory session store: maps opaque session tokens to the
 * `{ userId, role }` identity the policy layer expects. The auth layer issues
 * the tokens (see `createInMemorySession`); this store makes them resolvable by
 * `sessions.getByToken`, which is exactly the contract `createApp` requires
 * (R11.5). Kept in-memory because sessions are ephemeral; swapping in a
 * persistent/cookie/JWT store later touches only this factory.
 *
 * @returns {{
 *   save: (session: object) => object,
 *   getByToken: (token: string) => (object|null),
 *   revoke: (token: string) => boolean,
 * }}
 */
export function createSessionStore() {
  const byToken = new Map();
  return {
    save(session) {
      if (session && session.token != null) byToken.set(String(session.token), session);
      return session;
    },
    getByToken(token) {
      if (token == null) return null;
      const session = byToken.get(String(token)) ?? null;
      if (!session) return null;
      if (session.expiresAt && new Date(session.expiresAt).getTime() <= Date.now()) {
        byToken.delete(String(token));
        return null;
      }
      return session;
    },
    revoke(token) {
      if (token == null) return false;
      return byToken.delete(String(token));
    },
  };
}

/**
 * Build a `patients` lookup (with a `getById` returning at least
 * `{ id, gracePeriodMinutes }`) over a SQLite connection. The SQLite repository
 * set does not include patients (they are owned by the auth/user layer), so the
 * dose-log service and scheduler read them directly from the `patients` table
 * declared in schema.sql.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {{ getById: (id: *) => (object|null) }}
 */
function createSqlitePatientsLookup(db) {
  const stmt = db.prepare('SELECT * FROM patients WHERE id = ?');
  return {
    getById(id) {
      if (id == null) return null;
      const row = stmt.get(String(id));
      if (!row) return null;
      let preferences = {};
      try {
        preferences = row.preferences ? JSON.parse(row.preferences) : {};
      } catch {
        preferences = {};
      }
      return {
        id: row.id,
        role: row.role,
        displayName: row.display_name,
        gracePeriodMinutes: row.grace_period_minutes,
        preferences,
      };
    },
  };
}

/**
 * Build a `users` repository (with `findByIdentifier` and `getById`) over a
 * SQLite connection. Users are keyed by `id`; the login identifier is the user
 * id for this project scope (the `users` table has no separate identifier
 * column), so `findByIdentifier` resolves against `id`.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {import('./data/interfaces.js').UserRepository}
 */
function createSqliteUsersRepository(db) {
  const byId = db.prepare('SELECT * FROM users WHERE id = ?');
  const rowToModel = (row) =>
    row == null
      ? null
      : {
          id: row.id,
          role: row.role,
          credentialHash: row.credential_hash,
          preferredReminderChannel: row.preferred_reminder_channel,
          createdAt: row.created_at,
        };
  const getById = (id) => (id == null ? null : rowToModel(byId.get(String(id)) ?? null));
  return {
    getById,
    // Login identifier == user id for this scope.
    findByIdentifier: (identifier) => getById(identifier),
  };
}

/**
 * Resolve a patient's preferred reminder channel for a medication, used by the
 * scheduler to stamp the dose-reminder channel (R2.4). Falls back to null so
 * the dispatcher's own default applies when no preference is recorded.
 *
 * @param {{ getById: (id: *) => (object|null) }} patients
 * @param {import('./data/interfaces.js').UserRepository} users
 * @returns {(medication: object) => (string|null)}
 */
function makeResolveReminderChannel(patients, users) {
  return (medication) => {
    if (!medication) return null;
    const user = users?.getById?.(medication.patientId);
    if (user && user.preferredReminderChannel != null && user.preferredReminderChannel !== '') {
      return user.preferredReminderChannel;
    }
    const patient = patients?.getById?.(medication.patientId);
    const pref = patient?.preferences?.reminderChannel;
    return pref != null && pref !== '' ? pref : null;
  };
}

/**
 * Assemble the full application graph.
 *
 * @param {object} [options]
 * @param {'sqlite'|'memory'} [options.repositories] - Repository backend to use.
 *   Defaults to `'sqlite'`; `'memory'` is convenient for dev/test.
 * @param {object} [options.repositoriesInstance] - Pre-built repository set
 *   (shape of `createInMemoryRepositories`), overriding `options.repositories`.
 *   Lets tests inject seeded repositories.
 * @param {import('better-sqlite3').Database} [options.db] - Existing SQLite
 *   connection to build repositories over (used with `repositories: 'sqlite'`).
 * @param {string} [options.dbFilename] - SQLite file (default in-memory `:memory:`).
 * @param {string|null} [options.encryptionKey] - At-rest key (from a secret store).
 * @param {{ getById: (id: *) => (object|null) }} [options.patients] - Patients lookup override.
 * @param {import('./data/interfaces.js').UserRepository} [options.users] - Users repo override.
 * @param {object} [options.channels] - Channel map override (default: stub channels).
 * @param {(identity: object) => object} [options.createSession] - Session factory.
 * @param {(() => (Date|string)) | { now: () => (Date|string) }} [options.clock] - Injectable clock.
 * @param {number} [options.schedulerIntervalMs] - Tick interval; clamped to <=60s.
 * @param {string} [options.clientDist] - Path to the built SPA (Vite `dist`).
 * @param {boolean} [options.serveClient] - Serve the built SPA (default: true).
 * @returns {{
 *   app: import('express').Express,
 *   services: object,
 *   repositories: object,
 *   dispatcher: object,
 *   scheduler: { tick: () => object, intervalMs: number },
 *   sessions: ReturnType<typeof createSessionStore>,
 *   startScheduler: () => (() => void),
 *   close: () => void,
 * }}
 */
export function buildApplication(options = {}) {
  const {
    repositories: repoKind = 'sqlite',
    repositoriesInstance = null,
    db: injectedDb = null,
    dbFilename = ':memory:',
    encryptionKey = undefined,
    patients: patientsOverride = null,
    users: usersOverride = null,
    channels = createStubChannels(),
    createSession = createInMemorySession,
    clock = undefined,
    schedulerIntervalMs,
    clientDist = DEFAULT_CLIENT_DIST,
    serveClient = true,
  } = options;

  // 1. Repositories (SQLite by default; in-memory for dev/test). --------------
  let repositories;
  let db = injectedDb;
  let ownsDb = false;
  let patients = patientsOverride;
  let users = usersOverride;

  if (repositoriesInstance) {
    repositories = repositoriesInstance;
    users = users ?? repositories.users ?? null;
  } else if (repoKind === 'memory') {
    repositories = createInMemoryRepositories();
    users = users ?? repositories.users;
  } else {
    if (!db) {
      db = openDatabase({ filename: dbFilename, encryptionKey });
      ownsDb = true;
    }
    repositories = createSqliteRepositories(db);
    patients = patients ?? createSqlitePatientsLookup(db);
    users = users ?? createSqliteUsersRepository(db);
  }

  // A patients lookup is required by the dose-log service and scheduler. When
  // none was derived above (in-memory path or a repo set without one), fall
  // back to a permissive lookup so a missing patient yields a zero grace
  // period rather than crashing.
  if (!patients) {
    patients = { getById: () => null };
  }
  if (!users) {
    users = { getById: () => null, findByIdentifier: () => null };
  }

  // 2. Domain services, each bound to the repositories + patients lookup. -----
  const services = {
    medications: createMedicationService({
      medications: repositories.medications,
      doseEvents: repositories.doseEvents,
    }),
    doseLogs: createDoseLogService({
      doseEvents: repositories.doseEvents,
      doseLogs: repositories.doseLogs,
      medications: repositories.medications,
      patients,
    }),
    adherence: createAdherenceService({
      medications: repositories.medications,
      doseEvents: repositories.doseEvents,
      doseLogs: repositories.doseLogs,
    }),
    contacts: createContactService({ caregivers: repositories.caregivers }),
    notes: createNoteService({ noteRepository: repositories.notes }),
    interactions: createInteractionService({
      interactionWarnings: repositories.interactionWarnings,
      interactionRules: repositories.interactionRules,
    }),
  };

  // 3. Notification dispatcher with the stub channels registered. -------------
  const dispatcher = createNotificationDispatcher({
    channels,
    notificationRepository: repositories.notifications,
  });

  // 4. Session store + auth. The store makes issued tokens resolvable by the
  //    HTTP session middleware (R11.5); login issues them (R11.1). ------------
  const sessions = createSessionStore();

  // 5. Scheduler with a <=60s tick. The timer itself is opt-in (startScheduler)
  //    so importing/constructing the app never spawns a live interval. --------
  const scheduler = createScheduler({
    doseEventRepository: repositories.doseEvents,
    medicationRepository: repositories.medications,
    doseLogRepository: repositories.doseLogs,
    caregiverContactRepository: repositories.caregivers,
    noteRepository: repositories.notes,
    dispatcher,
    patients,
    clock,
    resolveReminderChannel: makeResolveReminderChannel(patients, users),
    ...(schedulerIntervalMs != null ? { intervalMs: schedulerIntervalMs } : {}),
  });

  // 6. Express app: JSON API (auth -> policy -> audit -> services) + login
  //    endpoint + built SPA. ---------------------------------------------------
  const app = createApp({
    services,
    providerAssignments: repositories.providerAssignments,
    auditEntries: repositories.auditEntries,
    sessions,
    clock: typeof clock === 'function' ? clock : undefined,
    // Login mounts before the PHI router (whose session middleware would
    // otherwise 401 it). See createApp's `publicApiRoutes` hook.
    publicApiRoutes: (targetApp) =>
      mountAuthRoutes(targetApp, { users, sessions, createSession }),
  });

  if (serveClient) {
    mountClientSpa(app, clientDist);
  }

  /**
   * Start the periodic scheduler tick using a real timer. Returns a `stop()`
   * function that clears it. Kept out of `buildApplication` so tests can drive
   * `scheduler.tick()` manually without a live timer.
   *
   * @returns {() => void} stop
   */
  function startScheduler() {
    const handle = setInterval(() => {
      try {
        scheduler.tick();
      } catch (err) {
        // A tick failure must not crash the process; log and keep ticking.
        // eslint-disable-next-line no-console
        console.error('scheduler tick failed:', err);
      }
    }, scheduler.intervalMs);
    if (typeof handle.unref === 'function') handle.unref();
    return function stop() {
      clearInterval(handle);
    };
  }

  /** Release owned resources (the SQLite connection, when this module opened it). */
  function close() {
    if (ownsDb && db && typeof db.close === 'function') db.close();
  }

  return {
    app,
    services,
    repositories,
    dispatcher,
    scheduler,
    sessions,
    startScheduler,
    close,
  };
}

/**
 * Mount the authentication endpoint. `POST /api/auth/login` verifies
 * credentials via the auth layer, establishes a session, stores it so the
 * session middleware can resolve the token, and returns the token + identity
 * (R11.1). Invalid credentials produce a generic 401 with no user enumeration
 * (R11.2) via the shared error translator.
 *
 * Mounted before the SPA fallback but it is fine to add after the API router:
 * it lives under `/api`, which the SPA fallback excludes.
 *
 * @param {import('express').Express} app
 * @param {object} deps
 * @param {import('./data/interfaces.js').UserRepository} deps.users
 * @param {ReturnType<typeof createSessionStore>} deps.sessions
 * @param {(identity: object) => object} deps.createSession
 */
export function mountAuthRoutes(app, { users, sessions, createSession }) {
  app.post(
    '/api/auth/login',
    express.json(),
    asyncHandler((req, res) => {
      const { identifier, password } = req.body ?? {};
      // Throws AuthenticationError on failure -> translated to a generic 401.
      const { session, identity } = authenticate(
        { identifier, password },
        { users, createSession },
      );
      sessions.save(session);
      res.status(201).json({
        token: session.token,
        identity,
        expiresAt: session.expiresAt ?? null,
      });
    }),
  );
}

/**
 * Serve the built React SPA (Vite `dist`) as static files, with a
 * client-side-routing fallback: any non-`/api`, non-file GET request returns
 * `index.html` so React Router can resolve the route in the browser. This keeps
 * the SPA and JSON API on a single origin — the SPA consumes the API at `/api`
 * (see client/src/api/client.js), while deep links like `/medications` still
 * load the app shell.
 *
 * When the build output is absent (the client has not been built yet), the
 * fallback responds with a helpful message instead of crashing, so the API is
 * still usable during development.
 *
 * @param {import('express').Express} app
 * @param {string} clientDist - Absolute path to the Vite build output.
 */
export function mountClientSpa(app, clientDist) {
  const hasBuild = existsSync(join(clientDist, 'index.html'));

  if (hasBuild) {
    app.use(express.static(clientDist));
  }

  // SPA fallback: only for GET requests that are not part of the JSON API.
  app.get(/^\/(?!api\/).*/, (req, res, next) => {
    if (!hasBuild) {
      res
        .status(200)
        .type('text/plain')
        .send(
          'React SPA not built. Run `npm run build:client` (or `cd client && npm run build`).',
        );
      return;
    }
    res.sendFile(join(clientDist, 'index.html'), (err) => {
      if (err) next(err);
    });
  });

  // Keep the uniform error translation for anything the fallback surfaces.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    sendError(res, err);
  });
}
