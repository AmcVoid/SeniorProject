-- SQLite schema (DDL) for the Medication Management System.
--
-- Mirrors the ER model in design.md ("Data Models"). Foreign keys encode the
-- ownership/reference relationships:
--   PATIENT  1--*  MEDICATION            (medication.patient_id)
--   PATIENT  1--*  CAREGIVER_CONTACT     (caregiver_contact.patient_id)
--   PATIENT  1--*  PROVIDER_ASSIGNMENT   (provider_assignment.patient_id)
--   PROVIDER 1--*  PROVIDER_ASSIGNMENT   (provider_assignment.provider_id)
--   MEDICATION 1--* DOSE_EVENT           (dose_event.medication_id)
--   MEDICATION 1--* MEMORY_NOTE          (memory_note.medication_id)
--   MEDICATION 1--* INTERACTION_WARNING  (interaction_warning.medication_id_a/b)
--   DOSE_EVENT 1--0..1 DOSE_LOG          (dose_log.dose_event_id, UNIQUE)
--   NOTIFICATION *--1 PATIENT            (notification.recipient_ref -> logical)
--   AUDIT_ENTRY  *--1 USER               (audit_entry.user_id -> logical)
--
-- Notes on shape:
-- * Embedded/complex fields from the plain models are stored as JSON TEXT
--   columns and rematerialized on read (medication.schedule,
--   caregiver_contact.delivery_addresses, notification.payload).
-- * Booleans are stored as INTEGER 0/1 and rematerialized as true/false.
-- * InteractionRule is the shared, non-PHI rule set keyed by the normalized
--   (drug_a, drug_b) unordered pair; it has no surrogate id.
-- * Foreign keys are declared for the model relationships; NOT VALIDATED for
--   the logical User/Patient references (users/patients are managed by the
--   auth layer in later tasks and their tables are not owned by task 2.3).
--
-- PHI at-rest protection: this file only declares structure. The encryption
-- key (SQLCipher-style `PRAGMA key`) is applied at connection open time by
-- db.js from an injected runtime secret; it is never written into the DDL or
-- stored beside the database.

PRAGMA foreign_keys = ON;

-- Users referenced by audit entries and owned by patients/providers.
-- Minimal shell table so foreign keys have a target; the auth layer (task 17)
-- owns the full user lifecycle.
CREATE TABLE IF NOT EXISTS users (
  id                          TEXT PRIMARY KEY,
  role                        TEXT NOT NULL,
  credential_hash             TEXT NOT NULL DEFAULT '',
  preferred_reminder_channel  TEXT,
  created_at                  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS patients (
  id                    TEXT PRIMARY KEY,
  role                  TEXT NOT NULL DEFAULT 'patient',
  display_name          TEXT NOT NULL DEFAULT '',
  grace_period_minutes  INTEGER NOT NULL DEFAULT 0,
  preferences           TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS providers (
  id            TEXT PRIMARY KEY,
  role          TEXT NOT NULL DEFAULT 'provider',
  display_name  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS provider_assignments (
  id           TEXT PRIMARY KEY,
  provider_id  TEXT NOT NULL,
  patient_id   TEXT NOT NULL,
  active       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_assignment_provider ON provider_assignments (provider_id);
CREATE INDEX IF NOT EXISTS idx_assignment_patient ON provider_assignments (patient_id);

CREATE TABLE IF NOT EXISTS medications (
  id                                     TEXT PRIMARY KEY,
  patient_id                             TEXT NOT NULL,
  name                                   TEXT NOT NULL DEFAULT '',
  dosage                                 TEXT NOT NULL DEFAULT '',
  schedule                               TEXT,          -- JSON: { times, recurrence, startDate, endDate }
  refill_threshold                       INTEGER NOT NULL DEFAULT 0,
  remaining_supply                       INTEGER NOT NULL DEFAULT 0,
  caregiver_alerts_enabled               INTEGER NOT NULL DEFAULT 1,
  caregiver_refill_notifications_enabled INTEGER NOT NULL DEFAULT 0,
  active                                 INTEGER NOT NULL DEFAULT 1,
  created_at                             TEXT
);
CREATE INDEX IF NOT EXISTS idx_medication_patient ON medications (patient_id);

CREATE TABLE IF NOT EXISTS dose_events (
  id             TEXT PRIMARY KEY,
  medication_id  TEXT NOT NULL,
  scheduled_time TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',
  FOREIGN KEY (medication_id) REFERENCES medications (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_dose_event_medication ON dose_events (medication_id);
CREATE INDEX IF NOT EXISTS idx_dose_event_time ON dose_events (scheduled_time);

CREATE TABLE IF NOT EXISTS dose_logs (
  id            TEXT PRIMARY KEY,
  dose_event_id TEXT NOT NULL UNIQUE,   -- at most one active log per event
  status        TEXT NOT NULL DEFAULT 'taken',
  logged_at     TEXT,
  FOREIGN KEY (dose_event_id) REFERENCES dose_events (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS caregiver_contacts (
  id                 TEXT PRIMARY KEY,
  patient_id         TEXT NOT NULL,
  name               TEXT NOT NULL DEFAULT '',
  delivery_addresses TEXT NOT NULL DEFAULT '[]',  -- JSON array
  channel_preference TEXT,
  active             INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_caregiver_patient ON caregiver_contacts (patient_id);

CREATE TABLE IF NOT EXISTS memory_notes (
  id            TEXT PRIMARY KEY,
  medication_id TEXT NOT NULL,
  text          TEXT NOT NULL DEFAULT '',
  created_at    TEXT,
  updated_at    TEXT,
  FOREIGN KEY (medication_id) REFERENCES medications (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_note_medication ON memory_notes (medication_id);

CREATE TABLE IF NOT EXISTS interaction_warnings (
  id              TEXT PRIMARY KEY,
  patient_id      TEXT NOT NULL,
  medication_id_a TEXT NOT NULL,
  medication_id_b TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_warning_patient ON interaction_warnings (patient_id);

-- Shared rule set (not per-patient PHI); keyed by the normalized drug pair.
CREATE TABLE IF NOT EXISTS interaction_rules (
  drug_a      TEXT NOT NULL,
  drug_b      TEXT NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'unknown',
  description TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (drug_a, drug_b)
);

CREATE TABLE IF NOT EXISTS notifications (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL DEFAULT 'dose',
  recipient_ref TEXT,
  channel       TEXT,
  payload       TEXT NOT NULL DEFAULT '{}',  -- JSON
  status        TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 1,
  scheduled_for TEXT
);
CREATE INDEX IF NOT EXISTS idx_notification_status ON notifications (status);

CREATE TABLE IF NOT EXISTS audit_entries (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  record_ref TEXT,
  action     TEXT NOT NULL DEFAULT 'read',
  timestamp  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_entries (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_record ON audit_entries (record_ref);
