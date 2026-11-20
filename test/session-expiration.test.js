import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { createApp } from '../src/http/server.js';
import { createInMemoryRepositories } from '../src/data/memory.js';
import { createMedicationService } from '../src/domain/medication.js';
import { createAdherenceService } from '../src/domain/adherence-service.js';
import { createDoseLogService } from '../src/domain/dose-log-service.js';
import { createContactService } from '../src/domain/contact-service.js';
import { createNoteService } from '../src/domain/note-service.js';
import { createInteractionService } from '../src/domain/interaction-service.js';
import { Role } from '../src/domain/types.js';
import { createSessionStore, mountAuthRoutes } from '../src/composition.js';
import { createInMemorySession, hashCredential } from '../src/policy/auth.js';

function buildHarness({ sessions = createSessionStore() } = {}) {
  const repos = createInMemoryRepositories();
  const patients = { getById: () => ({ gracePeriodMinutes: 60 }) };

  const services = {
    medications: createMedicationService({
      medications: repos.medications,
      doseEvents: repos.doseEvents,
    }),
    doseLogs: createDoseLogService({
      doseEvents: repos.doseEvents,
      doseLogs: repos.doseLogs,
      medications: repos.medications,
      patients,
    }),
    adherence: createAdherenceService({
      medications: repos.medications,
      doseEvents: repos.doseEvents,
      doseLogs: repos.doseLogs,
    }),
    contacts: createContactService({ caregivers: repos.caregivers }),
    notes: createNoteService({ noteRepository: repos.notes }),
    interactions: createInteractionService({
      interactionWarnings: repos.interactionWarnings,
      interactionRules: repos.interactionRules,
    }),
  };

  const users = repos.users;
  users.insert({
    id: 'patient-1',
    role: Role.PATIENT,
    identifier: 'patient-1',
    credentialHash: hashCredential('patient-pass'),
  });

  const app = createApp({
    services,
    providerAssignments: repos.providerAssignments,
    auditEntries: repos.auditEntries,
    sessions,
    publicApiRoutes: (targetApp) => {
      mountAuthRoutes(targetApp, { users, sessions, createSession: createInMemorySession });
    },
  });

  return { app, sessions, users };
}

function request(app, { method = 'GET', path, token = null, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const payload = body != null ? JSON.stringify(body) : null;
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          method,
          path,
          headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (c) => {
            data += c;
          });
          res.on('end', () => {
            server.close();
            let json = null;
            try {
              json = data ? JSON.parse(data) : null;
            } catch {
              json = data;
            }
            resolve({ status: res.statusCode, body: json });
          });
        },
      );
      req.on('error', (err) => {
        server.close();
        reject(err);
      });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

test('login response includes token, identity, and expiresAt', async () => {
  const { app } = buildHarness();
  const res = await request(app, {
    method: 'POST',
    path: '/api/auth/login',
    body: { identifier: 'patient-1', password: 'patient-pass' },
  });

  assert.equal(res.status, 201);
  assert.ok(res.body.token, 'token is returned');
  assert.equal(res.body.identity.userId, 'patient-1');
  assert.ok(res.body.expiresAt, 'expiresAt timestamp is returned');
  assert.ok(new Date(res.body.expiresAt).getTime() > Date.now());
});

test('expired session receives 401 Authentication required on protected route', async () => {
  const sessions = createSessionStore();
  const { app } = buildHarness({ sessions });

  // Save an expired session
  const expiredSession = {
    token: 'token-expired',
    userId: 'patient-1',
    role: Role.PATIENT,
    expiresAt: new Date(Date.now() - 5000).toISOString(),
  };
  sessions.save(expiredSession);

  const res = await request(app, {
    method: 'GET',
    path: '/api/medications',
    token: 'token-expired',
  });

  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'Authentication required');
});
