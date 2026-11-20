/**
 * Development seed script (SQLite).
 *
 * Populates a SQLite database with enough data to exercise the running site:
 *   - a PATIENT user with a real scrypt credential hash (so login works),
 *   - a matching `patients` row (patient id == user id, which is what the
 *     patient-scoped API routes act on),
 *   - two medications with dose events + logs so Medications, Dose history and
 *     Adherence show data,
 *   - a caregiver contact,
 *   - a PROVIDER user + active assignment so the Provider dashboard works.
 *
 * Users/patients/providers are NOT owned by the SQLite repository set (the
 * composition root reads them directly), so those rows are written with plain
 * parameterized SQL. Everything else goes through the real SQLite repositories
 * so record shapes stay correct.
 *
 * Usage:
 *   npm run seed                       # seeds the default file (mms.db)
 *   MMS_DB_FILE=other.db npm run seed  # seeds a specific file
 *
 * The target defaults to the same SQLite file the server uses (see
 * DEFAULT_DB_FILE), so `npm run seed` then `npm start` "just work" with no env
 * vars. `MMS_DB_FILE` overrides the location for both.
 *
 * Re-running is safe: existing seed rows are replaced (INSERT OR REPLACE / the
 * repositories' id-based upserts).
 */

import { openDatabase } from '../src/data/sqlite/db.js';
import { createSqliteRepositories } from '../src/data/sqlite/repositories.js';
import { DEFAULT_DB_FILE } from '../src/http/server.js';
import { hashCredential } from '../src/policy/auth.js';
import {
  createMedication,
  createSchedule,
  createDoseEvent,
  createDoseLog,
  createCaregiverContact,
} from '../src/domain/models.js';
import { Role, DoseEventStatus, DoseLogStatus } from '../src/domain/types.js';

// ---- Fixed dev identities & credentials ------------------------------------
// Login identifier == user id for this project scope (see composition.js).
const PATIENT_ID = 'patient-1';
const PROVIDER_ID = 'provider-1';
const PATIENT_PASSWORD = 'patient-pass';
const PROVIDER_PASSWORD = 'provider-pass';

const nowIso = () => new Date().toISOString();
/** ISO timestamp `n` hours from now (negative = in the past). */
const hoursFromNow = (n) => new Date(Date.now() + n * 3600 * 1000).toISOString();

const dbFilename = process.env.MMS_DB_FILE || DEFAULT_DB_FILE;
if (dbFilename === ':memory:') {
  console.error(
    'Cannot seed an in-memory database (:memory:) — it would be discarded when\n' +
      'this script exits. Seed a file instead, e.g. `npm run seed` (uses ' +
      `${DEFAULT_DB_FILE}).`,
  );
  process.exit(1);
}

const db = openDatabase({ filename: dbFilename });
const repos = createSqliteRepositories(db);

// ---- Users / patients / providers (written directly; not repo-owned) -------
const upsertUser = db.prepare(`
  INSERT INTO users (id, role, credential_hash, preferred_reminder_channel, created_at)
  VALUES (@id, @role, @credentialHash, @preferredReminderChannel, @createdAt)
  ON CONFLICT(id) DO UPDATE SET
    role = excluded.role,
    credential_hash = excluded.credential_hash,
    preferred_reminder_channel = excluded.preferred_reminder_channel
`);

const upsertPatient = db.prepare(`
  INSERT INTO patients (id, role, display_name, grace_period_minutes, preferences)
  VALUES (@id, @role, @displayName, @gracePeriodMinutes, @preferences)
  ON CONFLICT(id) DO UPDATE SET
    display_name = excluded.display_name,
    grace_period_minutes = excluded.grace_period_minutes,
    preferences = excluded.preferences
`);

const upsertProvider = db.prepare(`
  INSERT INTO providers (id, role, display_name)
  VALUES (@id, @role, @displayName)
  ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name
`);

const upsertAssignment = db.prepare(`
  INSERT INTO provider_assignments (id, provider_id, patient_id, active)
  VALUES (@id, @providerId, @patientId, @active)
  ON CONFLICT(id) DO UPDATE SET
    provider_id = excluded.provider_id,
    patient_id = excluded.patient_id,
    active = excluded.active
`);

const seed = db.transaction(() => {
  // Patient user + patient profile.
  upsertUser.run({
    id: PATIENT_ID,
    role: Role.PATIENT,
    credentialHash: hashCredential(PATIENT_PASSWORD),
    preferredReminderChannel: 'email',
    createdAt: nowIso(),
  });
  upsertPatient.run({
    id: PATIENT_ID,
    role: Role.PATIENT,
    displayName: 'Pat Patient',
    gracePeriodMinutes: 30,
    preferences: JSON.stringify({ reminderChannel: 'email' }),
  });

  // Provider user + active assignment to the patient.
  upsertUser.run({
    id: PROVIDER_ID,
    role: Role.PROVIDER,
    credentialHash: hashCredential(PROVIDER_PASSWORD),
    preferredReminderChannel: null,
    createdAt: nowIso(),
  });
  upsertProvider.run({
    id: PROVIDER_ID,
    role: Role.PROVIDER,
    displayName: 'Dr. Provider',
  });
  upsertAssignment.run({
    id: 'assignment-1',
    providerId: PROVIDER_ID,
    patientId: PATIENT_ID,
    active: 1,
  });

  // Medications (fixed ids so re-running upserts rather than duplicates).
  const med1 = repos.medications.insert(
    createMedication({
      id: 'med-1',
      patientId: PATIENT_ID,
      name: 'Lisinopril',
      dosage: '10 mg',
      schedule: createSchedule({ times: ['08:00'], recurrence: 'daily' }),
      refillThreshold: 5,
      remainingSupply: 20,
    }),
  );
  const med2 = repos.medications.insert(
    createMedication({
      id: 'med-2',
      patientId: PATIENT_ID,
      name: 'Metformin',
      dosage: '500 mg',
      schedule: createSchedule({ times: ['08:00', '20:00'], recurrence: 'daily' }),
      refillThreshold: 10,
      remainingSupply: 8, // below threshold -> shows a refill signal
    }),
  );

  // Dose events: a couple in the past (with logs) and one upcoming per med.
  const events = [
    { id: 'evt-1', medicationId: med1.id, scheduledTime: hoursFromNow(-26), status: DoseEventStatus.PENDING },
    { id: 'evt-2', medicationId: med1.id, scheduledTime: hoursFromNow(-2), status: DoseEventStatus.PENDING },
    { id: 'evt-3', medicationId: med1.id, scheduledTime: hoursFromNow(6), status: DoseEventStatus.PENDING },
    { id: 'evt-4', medicationId: med2.id, scheduledTime: hoursFromNow(-14), status: DoseEventStatus.PENDING },
    { id: 'evt-5', medicationId: med2.id, scheduledTime: hoursFromNow(4), status: DoseEventStatus.PENDING },
  ];
  for (const e of events) repos.doseEvents.insert(createDoseEvent(e));

  // Logs for the past events (one missed to make adherence interesting).
  const logs = [
    { id: 'log-1', doseEventId: 'evt-1', status: DoseLogStatus.TAKEN, loggedAt: hoursFromNow(-25.5) },
    { id: 'log-2', doseEventId: 'evt-2', status: DoseLogStatus.TAKEN, loggedAt: hoursFromNow(-1.5) },
    { id: 'log-3', doseEventId: 'evt-4', status: DoseLogStatus.MISSED, loggedAt: hoursFromNow(-13) },
  ];
  // Dose logs are keyed uniquely by dose_event_id; upsert by replacing.
  const replaceLog = db.prepare(`
    INSERT INTO dose_logs (id, dose_event_id, status, logged_at)
    VALUES (@id, @doseEventId, @status, @loggedAt)
    ON CONFLICT(dose_event_id) DO UPDATE SET
      status = excluded.status,
      logged_at = excluded.logged_at
  `);
  for (const l of logs) {
    const log = createDoseLog(l);
    replaceLog.run({
      id: log.id,
      doseEventId: log.doseEventId,
      status: log.status,
      loggedAt: log.loggedAt,
    });
  }

  // Caregiver contact.
  repos.caregivers.insert(
    createCaregiverContact({
      id: 'caregiver-1',
      patientId: PATIENT_ID,
      name: 'Casey Caregiver',
      deliveryAddresses: ['casey@example.com'],
      channelPreference: 'email',
    }),
  );
});

seed();
db.close();

console.log('Seed complete. Log in with:');
console.log(`  Patient  -> identifier: ${PATIENT_ID}   password: ${PATIENT_PASSWORD}`);
console.log(`  Provider -> identifier: ${PROVIDER_ID}  password: ${PROVIDER_PASSWORD}`);
console.log(`Database: ${dbFilename}`);
