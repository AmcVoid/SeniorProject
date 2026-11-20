/**
 * HTTP / JSON API entry point (task 18.1).
 *
 * Wires the full request pipeline described in design.md
 * ("Request Lifecycle (PHI access)"):
 *
 *   route -> session validation -> authorization policy -> audit -> service
 *
 * `createApp` is a FACTORY that takes injected domain services plus the
 * repositories the policy/audit layers need (`providerAssignments`,
 * `auditEntries`) and a `sessions` store. Because everything is injected, the
 * app can be exercised end-to-end against the in-memory repositories with
 * supertest or Node's built-in `http`, with no database required (design.md
 * "Testing Strategy"; the role-based integration suite is task 18.2).
 *
 * Controllers hold no business logic: they resolve the target patient, run the
 * request through `guardPhi` (policy + audit), delegate to the injected
 * service, and shape JSON. Error translation (validation -> 400 field-keyed,
 * authentication -> 401, authorization -> 403 with no PHI) lives in
 * `./middleware.js` and is applied uniformly.
 */
import express from 'express';
import { pathToFileURL } from 'node:url';

import { createRequireSession, createGuardPhi, sendError } from './middleware.js';
import { createApiRouter } from './routes.js';

/**
 * Default SQLite database file used when `MMS_DB_FILE` is not set. The app
 * always uses SQLite (file-backed) so data persists across restarts; set
 * `MMS_DB_FILE=:memory:` to opt into an ephemeral in-memory database instead.
 * Shared with the seed script so both read/write the same file by default.
 */
export const DEFAULT_DB_FILE = 'mms.db';

/**
 * Build the Express application.
 *
 * @param {object} deps
 * @param {object} deps.services - Already-constructed domain services:
 *   `{ medications, doseLogs, adherence, contacts, notes, interactions }`.
 * @param {import('../data/interfaces.js').ProviderAssignmentRepository} deps.providerAssignments
 *   Repository the policy layer uses to check provider assignment (R11.4, R12.4).
 * @param {import('../data/interfaces.js').AuditEntryRepository} deps.auditEntries
 *   Repository the audit wrapper writes one entry per PHI access into (R12.3).
 * @param {{ getByToken: (token: string) => (object|null) }} deps.sessions
 *   Session store resolving a token to `{ userId, role }` (R11.5).
 * @param {() => string} [deps.clock] - Injectable audit timestamp source.
 * @returns {import('express').Express}
 */
export function createApp(deps = {}) {
  const { services, providerAssignments, auditEntries, sessions, clock, publicApiRoutes } = deps;

  const app = express();
  app.use(express.json());

  // Minimal, non-PHI health check (safe to leave unauthenticated).
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Unauthenticated `/api` routes (e.g. login) must mount BEFORE the PHI
  // router: that router's session middleware runs for every path under `/api`,
  // so anything mounted after it would be rejected with a 401 before its
  // handler ran. The composition root supplies the login endpoint here (R11.1).
  if (typeof publicApiRoutes === 'function') {
    publicApiRoutes(app);
  }

  // Only mount the PHI API when its dependencies are provided. This keeps the
  // module importable (e.g. for the health check / smoke tests) even before a
  // full service graph is wired.
  if (services && providerAssignments && auditEntries && sessions) {
    const requireSession = createRequireSession({ sessions });
    const guardPhi = createGuardPhi({ providerAssignments, auditEntries, clock });
    app.use('/api', createApiRouter({ requireSession, guardPhi, services }));
  }

  // Final safety net: translate any error that escaped a handler.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    sendError(res, err);
  });

  return app;
}

// Only boot the full application when run directly (not when imported by tests).
// Build the entry-point URL with Node's own path->file-URL conversion so the
// comparison is correct on every platform. Hand-building `file://<path>` breaks
// on Windows, where `import.meta.url` looks like `file:///D:/My%20Stuff/...`
// (three slashes, URL-encoded spaces) and would never match.
const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

/**
 * Boot the full application. Kept in an async function (invoked below) rather
 * than run via a top-level `await import(...)`: a dangling top-level await lets
 * Node treat module evaluation as unsettled and exit before `app.listen` holds
 * the event loop open. Awaiting inside a called function settles cleanly.
 */
async function boot() {
  // Wire the whole graph through the composition root (task 20.1): repositories
  // -> services -> auth/policy/audit -> JSON API + login endpoint + built SPA,
  // then start the periodic scheduler with its <=60s tick (R2.1, R13.1).
  const { buildApplication } = await import('../composition.js');

  const port = Number(process.env.PORT) || 3000;
  // Always use SQLite so data persists across restarts. `MMS_DB_FILE` overrides
  // the location (set it to `:memory:` for an ephemeral, non-persistent DB).
  const dbFilename = process.env.MMS_DB_FILE || DEFAULT_DB_FILE;
  const { app, startScheduler, close } = buildApplication({
    repositories: 'sqlite',
    dbFilename,
  });

  const stopScheduler = startScheduler();
  const server = app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`MMS app listening on http://localhost:${port}`);
  });

  const shutdown = () => {
    stopScheduler();
    server.close();
    close();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (isDirectRun) {
  boot().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to start MMS app:', err);
    process.exitCode = 1;
  });
}
