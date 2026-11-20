/**
 * HTTP wiring smoke test for the JSON API (task 18.1).
 *
 * This is a MINIMAL check that the app factory wires routes through session
 * validation, the authorization policy layer, and the audit wrapper. The full
 * role-based access matrix (patient own-record, provider assigned, denials for
 * unauthenticated/unassigned/revoked) is covered by the integration suite in
 * task 18.2; here we only prove the pipeline is connected end-to-end:
 *
 *   - unauthenticated PHI request -> 401 generic (R11.5)
 *   - authenticated patient can create + list their own medications (R1.1, R1.5)
 *   - a PHI access records exactly one audit entry (R12.3)
 *   - a provider not assigned to a patient is denied 403 with no PHI (R6.3)
 */
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

/** Build a fresh app + repos + a trivial token->identity session store. */
function buildHarness() {
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

  // Trivial session store: token === identity lookup key.
  const sessionsByToken = new Map();
  const sessions = { getByToken: (token) => sessionsByToken.get(token) ?? null };
  const issue = (userId, role) => {
    const token = `tok-${userId}`;
    sessionsByToken.set(token, { userId, role });
    return token;
  };

  const app = createApp({
    services,
    providerAssignments: repos.providerAssignments,
    auditEntries: repos.auditEntries,
    sessions,
  });

  return { app, repos, issue };
}

/** Minimal JSON HTTP client over an ephemeral listening server. */
function request(app, { method, path, token, body }) {
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

test('unauthenticated PHI request is rejected with a generic 401', async () => {
  const { app } = buildHarness();
  const res = await request(app, { method: 'GET', path: '/api/medications' });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'Authentication required');
});

test('authenticated patient can create and list their own medications', async () => {
  const { app, issue } = buildHarness();
  const token = issue('patient-1', Role.PATIENT);

  const created = await request(app, {
    method: 'POST',
    path: '/api/medications',
    token,
    body: { name: 'Aspirin', dosage: '81 mg', schedule: { times: ['08:00'] } },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.name, 'Aspirin');
  assert.equal(created.body.patientId, 'patient-1');

  const listed = await request(app, { method: 'GET', path: '/api/medications', token });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.medications.length, 1);
  assert.equal(listed.body.medications[0].name, 'Aspirin');
  assert.ok(Array.isArray(listed.body.interactionWarnings));
});

test('missing medication fields yield a field-keyed 400', async () => {
  const { app, issue } = buildHarness();
  const token = issue('patient-1', Role.PATIENT);
  const res = await request(app, {
    method: 'POST',
    path: '/api/medications',
    token,
    body: { name: 'Aspirin' },
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'Validation failed');
  assert.equal(res.body.fields.dosage, 'required');
  assert.equal(res.body.fields.schedule, 'required');
});

test('an invalid caregiver address yields a 400 with a readable field message', async () => {
  const { app, issue } = buildHarness();
  const token = issue('patient-1', Role.PATIENT);
  const res = await request(app, {
    method: 'POST',
    path: '/api/caregivers',
    token,
    body: { name: 'Pat', deliveryAddresses: ['not-an-address'] },
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'Validation failed');
  assert.match(res.body.fields.deliveryAddress, /valid email address or phone number/);
});

test('each PHI access records exactly one audit entry', async () => {
  const { app, repos, issue } = buildHarness();
  const token = issue('patient-1', Role.PATIENT);
  await request(app, { method: 'GET', path: '/api/medications', token });
  const entries = repos.auditEntries.list();
  assert.equal(entries.length, 1);
  assert.equal(String(entries[0].userId), 'patient-1');
});

test('a provider not assigned to the patient is denied 403 with no PHI', async () => {
  const { app, repos, issue } = buildHarness();
  // Seed a medication owned by patient-1.
  const patientToken = issue('patient-1', Role.PATIENT);
  await request(app, {
    method: 'POST',
    path: '/api/medications',
    token: patientToken,
    body: { name: 'Aspirin', dosage: '81 mg', schedule: { times: ['08:00'] } },
  });

  const providerToken = issue('provider-9', Role.PROVIDER);
  const res = await request(app, {
    method: 'GET',
    path: '/api/provider/patients/patient-1/dashboard',
    token: providerToken,
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'Not authorized');
  // No PHI leaked in the denial body.
  assert.equal(res.body.medications, undefined);

  // Now assign the provider and confirm access is granted.
  repos.providerAssignments.insert({
    providerId: 'provider-9',
    patientId: 'patient-1',
    active: true,
  });
  const ok = await request(app, {
    method: 'GET',
    path: '/api/provider/patients/patient-1/dashboard',
    token: providerToken,
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.medications.length, 1);
  assert.ok(ok.body.adherence);
});
