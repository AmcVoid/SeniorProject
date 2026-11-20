/**
 * SQLite-backed repository implementations for the Medication Management System.
 *
 * These conform to the contracts documented in `../interfaces.js` and are
 * drop-in replacements for the in-memory fakes in `../memory.js`: synchronous,
 * plain-record in/out, ids assigned when absent, reads return fresh objects.
 * They are built on `better-sqlite3` (synchronous) via the connection factory
 * in `./db.js`.
 *
 * Security (R12.2):
 * - Every statement uses parameterized queries (`?` placeholders). No value is
 *   ever interpolated into SQL text.
 * - At-rest encryption / key injection is handled by `./db.js`.
 *
 * Storage/shape notes:
 * - Complex model fields are stored as JSON TEXT columns and rematerialized on
 *   read (medication.schedule, caregiver.deliveryAddresses, notification.payload).
 * - Booleans map to INTEGER 0/1.
 * - Ids are assigned as `${prefix}-${n}` strings using a per-table counter
 *   seeded from existing rows, mirroring the in-memory fakes' id style.
 */

import { normalizePair } from '../../domain/models.js';
import { InteractionWarningStatus } from '../../domain/types.js';

/* --------------------------------------------------------------------------
 * Shared helpers
 * ------------------------------------------------------------------------ */

const toBool = (v) => v === 1 || v === true;
const fromBool = (v) => (v ? 1 : 0);
const toJson = (v) => JSON.stringify(v ?? null);
const parseJson = (v, fallback) => {
  if (v == null) return fallback;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
};

/**
 * Build an id allocator for a table, seeded past any existing `prefix-N` ids so
 * generated ids never collide with rows already present.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} table
 * @param {string} prefix
 * @returns {() => string}
 */
function createIdAllocator(db, table, prefix) {
  let counter = 0;
  const rows = db.prepare(`SELECT id FROM ${table}`).all();
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  for (const { id } of rows) {
    const m = re.exec(String(id));
    if (m) counter = Math.max(counter, Number(m[1]));
  }
  return () => {
    counter += 1;
    return `${prefix}-${counter}`;
  };
}

/**
 * Merge a patch into an existing model and persist via the provided writer,
 * preserving the record's id. Returns the rematerialized record, or null when
 * the record does not exist.
 *
 * @template T
 * @param {(id: *) => (T|null)} getById
 * @param {(record: T) => void} write
 * @param {*} id
 * @param {object} patch
 * @returns {T|null}
 */
function patchAndWrite(getById, write, id, patch) {
  const existing = getById(id);
  if (!existing) return null;
  const updated = { ...existing, ...patch, id: existing.id };
  write(updated);
  return updated;
}

/* --------------------------------------------------------------------------
 * Medication
 * ------------------------------------------------------------------------ */

/** @returns {import('../interfaces.js').MedicationRepository} */
export function createSqliteMedicationRepository(db) {
  const nextId = createIdAllocator(db, 'medications', 'med');

  const rowToModel = (r) =>
    r == null
      ? null
      : {
          id: r.id,
          patientId: r.patient_id,
          name: r.name,
          dosage: r.dosage,
          schedule: parseJson(r.schedule, null),
          refillThreshold: r.refill_threshold,
          remainingSupply: r.remaining_supply,
          caregiverAlertsEnabled: toBool(r.caregiver_alerts_enabled),
          caregiverRefillNotificationsEnabled: toBool(
            r.caregiver_refill_notifications_enabled,
          ),
          active: toBool(r.active),
          createdAt: r.created_at,
        };

  const upsert = db.prepare(`
    INSERT INTO medications (
      id, patient_id, name, dosage, schedule, refill_threshold, remaining_supply,
      caregiver_alerts_enabled, caregiver_refill_notifications_enabled, active, created_at
    ) VALUES (
      @id, @patientId, @name, @dosage, @schedule, @refillThreshold, @remainingSupply,
      @caregiverAlertsEnabled, @caregiverRefillNotificationsEnabled, @active, @createdAt
    )
    ON CONFLICT(id) DO UPDATE SET
      patient_id = excluded.patient_id,
      name = excluded.name,
      dosage = excluded.dosage,
      schedule = excluded.schedule,
      refill_threshold = excluded.refill_threshold,
      remaining_supply = excluded.remaining_supply,
      caregiver_alerts_enabled = excluded.caregiver_alerts_enabled,
      caregiver_refill_notifications_enabled = excluded.caregiver_refill_notifications_enabled,
      active = excluded.active,
      created_at = excluded.created_at
  `);

  const write = (m) =>
    upsert.run({
      id: m.id,
      patientId: m.patientId ?? null,
      name: m.name ?? '',
      dosage: m.dosage ?? '',
      schedule: toJson(m.schedule),
      refillThreshold: m.refillThreshold ?? 0,
      remainingSupply: m.remainingSupply ?? 0,
      caregiverAlertsEnabled: fromBool(m.caregiverAlertsEnabled),
      caregiverRefillNotificationsEnabled: fromBool(m.caregiverRefillNotificationsEnabled),
      active: fromBool(m.active),
      createdAt: m.createdAt ?? null,
    });

  const getById = (id) => {
    if (id == null) return null;
    return rowToModel(
      db.prepare('SELECT * FROM medications WHERE id = ?').get(String(id)) ?? null,
    );
  };

  return {
    insert: (medication) => {
      const id = medication?.id == null ? nextId() : medication.id;
      const stored = { ...medication, id };
      write(stored);
      return getById(id);
    },
    getById,
    listByPatient: (patientId) =>
      db
        .prepare('SELECT * FROM medications WHERE patient_id = ? ORDER BY rowid')
        .all(String(patientId))
        .map(rowToModel),
    listActiveByPatient: (patientId) =>
      db
        .prepare(
          'SELECT * FROM medications WHERE patient_id = ? AND active = 1 ORDER BY rowid',
        )
        .all(String(patientId))
        .map(rowToModel),
    update: (id, patch) => patchAndWrite(getById, write, id, patch),
    markInactive: (id) => patchAndWrite(getById, write, id, { active: false }) !== null,
    remove: (id) => {
      if (id == null) return false;
      return db.prepare('DELETE FROM medications WHERE id = ?').run(String(id)).changes > 0;
    },
  };
}

/* --------------------------------------------------------------------------
 * Dose Event
 * ------------------------------------------------------------------------ */

/** @returns {import('../interfaces.js').DoseEventRepository} */
export function createSqliteDoseEventRepository(db) {
  const nextId = createIdAllocator(db, 'dose_events', 'dose-event');

  const rowToModel = (r) =>
    r == null
      ? null
      : { id: r.id, medicationId: r.medication_id, scheduledTime: r.scheduled_time, status: r.status };

  const upsert = db.prepare(`
    INSERT INTO dose_events (id, medication_id, scheduled_time, status)
    VALUES (@id, @medicationId, @scheduledTime, @status)
    ON CONFLICT(id) DO UPDATE SET
      medication_id = excluded.medication_id,
      scheduled_time = excluded.scheduled_time,
      status = excluded.status
  `);

  const write = (e) =>
    upsert.run({
      id: e.id,
      medicationId: e.medicationId ?? null,
      scheduledTime: e.scheduledTime ?? null,
      status: e.status ?? 'pending',
    });

  const getById = (id) => {
    if (id == null) return null;
    return rowToModel(
      db.prepare('SELECT * FROM dose_events WHERE id = ?').get(String(id)) ?? null,
    );
  };

  const insert = (doseEvent) => {
    const id = doseEvent?.id == null ? nextId() : doseEvent.id;
    const stored = { ...doseEvent, id };
    write(stored);
    return getById(id);
  };

  return {
    insert,
    insertMany: (doseEvents) => (doseEvents ?? []).map((e) => insert(e)),
    getById,
    listByMedication: (medicationId) =>
      db
        .prepare('SELECT * FROM dose_events WHERE medication_id = ? ORDER BY rowid')
        .all(String(medicationId))
        .map(rowToModel),
    listFutureByMedication: (medicationId, boundaryTime) =>
      db
        .prepare(
          'SELECT * FROM dose_events WHERE medication_id = ? AND scheduled_time > ? ORDER BY rowid',
        )
        .all(String(medicationId), boundaryTime)
        .map(rowToModel),
    listDueBetween: (from, to) =>
      db
        .prepare(
          'SELECT * FROM dose_events WHERE scheduled_time >= ? AND scheduled_time <= ? ORDER BY rowid',
        )
        .all(from, to)
        .map(rowToModel),
    update: (id, patch) => patchAndWrite(getById, write, id, patch),
    remove: (id) => {
      if (id == null) return false;
      return db.prepare('DELETE FROM dose_events WHERE id = ?').run(String(id)).changes > 0;
    },
    removeFutureByMedication: (medicationId, boundaryTime) =>
      db
        .prepare('DELETE FROM dose_events WHERE medication_id = ? AND scheduled_time > ?')
        .run(String(medicationId), boundaryTime).changes,
  };
}

/* --------------------------------------------------------------------------
 * Dose Log
 * ------------------------------------------------------------------------ */

/** @returns {import('../interfaces.js').DoseLogRepository} */
export function createSqliteDoseLogRepository(db) {
  const nextId = createIdAllocator(db, 'dose_logs', 'dose-log');

  const rowToModel = (r) =>
    r == null
      ? null
      : { id: r.id, doseEventId: r.dose_event_id, status: r.status, loggedAt: r.logged_at };

  const upsert = db.prepare(`
    INSERT INTO dose_logs (id, dose_event_id, status, logged_at)
    VALUES (@id, @doseEventId, @status, @loggedAt)
    ON CONFLICT(id) DO UPDATE SET
      dose_event_id = excluded.dose_event_id,
      status = excluded.status,
      logged_at = excluded.logged_at
  `);

  const write = (l) =>
    upsert.run({
      id: l.id,
      doseEventId: l.doseEventId ?? null,
      status: l.status ?? 'taken',
      loggedAt: l.loggedAt ?? null,
    });

  const getById = (id) => {
    if (id == null) return null;
    return rowToModel(
      db.prepare('SELECT * FROM dose_logs WHERE id = ?').get(String(id)) ?? null,
    );
  };

  const getByDoseEvent = (doseEventId) => {
    if (doseEventId == null) return null;
    return rowToModel(
      db.prepare('SELECT * FROM dose_logs WHERE dose_event_id = ?').get(String(doseEventId)) ??
        null,
    );
  };

  return {
    insert: (doseLog) => {
      const id = doseLog?.id == null ? nextId() : doseLog.id;
      const stored = { ...doseLog, id };
      write(stored);
      return getById(id);
    },
    getById,
    getByDoseEvent,
    listByDoseEvents: (doseEventIds) => {
      const ids = (doseEventIds ?? []).map(String);
      if (ids.length === 0) return [];
      const placeholders = ids.map(() => '?').join(', ');
      return db
        .prepare(
          `SELECT * FROM dose_logs WHERE dose_event_id IN (${placeholders}) ORDER BY rowid`,
        )
        .all(...ids)
        .map(rowToModel);
    },
    updateByDoseEvent: (doseEventId, patch) => {
      const existing = getByDoseEvent(doseEventId);
      if (!existing) return null;
      const updated = { ...existing, ...patch, id: existing.id };
      write(updated);
      return updated;
    },
    remove: (id) => {
      if (id == null) return false;
      return db.prepare('DELETE FROM dose_logs WHERE id = ?').run(String(id)).changes > 0;
    },
  };
}

/* --------------------------------------------------------------------------
 * Caregiver Contact
 * ------------------------------------------------------------------------ */

/** @returns {import('../interfaces.js').CaregiverContactRepository} */
export function createSqliteCaregiverContactRepository(db) {
  const nextId = createIdAllocator(db, 'caregiver_contacts', 'caregiver');

  const rowToModel = (r) =>
    r == null
      ? null
      : {
          id: r.id,
          patientId: r.patient_id,
          name: r.name,
          deliveryAddresses: parseJson(r.delivery_addresses, []),
          channelPreference: r.channel_preference,
          active: toBool(r.active),
        };

  const upsert = db.prepare(`
    INSERT INTO caregiver_contacts (id, patient_id, name, delivery_addresses, channel_preference, active)
    VALUES (@id, @patientId, @name, @deliveryAddresses, @channelPreference, @active)
    ON CONFLICT(id) DO UPDATE SET
      patient_id = excluded.patient_id,
      name = excluded.name,
      delivery_addresses = excluded.delivery_addresses,
      channel_preference = excluded.channel_preference,
      active = excluded.active
  `);

  const write = (c) =>
    upsert.run({
      id: c.id,
      patientId: c.patientId ?? null,
      name: c.name ?? '',
      deliveryAddresses: toJson(c.deliveryAddresses ?? []),
      channelPreference: c.channelPreference ?? null,
      active: fromBool(c.active),
    });

  const getById = (id) => {
    if (id == null) return null;
    return rowToModel(
      db.prepare('SELECT * FROM caregiver_contacts WHERE id = ?').get(String(id)) ?? null,
    );
  };

  return {
    insert: (contact) => {
      const id = contact?.id == null ? nextId() : contact.id;
      const stored = { ...contact, id };
      write(stored);
      return getById(id);
    },
    getById,
    listByPatient: (patientId) =>
      db
        .prepare('SELECT * FROM caregiver_contacts WHERE patient_id = ? ORDER BY rowid')
        .all(String(patientId))
        .map(rowToModel),
    listActiveByPatient: (patientId) =>
      db
        .prepare(
          'SELECT * FROM caregiver_contacts WHERE patient_id = ? AND active = 1 ORDER BY rowid',
        )
        .all(String(patientId))
        .map(rowToModel),
    update: (id, patch) => patchAndWrite(getById, write, id, patch),
    remove: (id) => {
      if (id == null) return false;
      return (
        db.prepare('DELETE FROM caregiver_contacts WHERE id = ?').run(String(id)).changes > 0
      );
    },
  };
}

/* --------------------------------------------------------------------------
 * Memory Note
 * ------------------------------------------------------------------------ */

/** @returns {import('../interfaces.js').MemoryNoteRepository} */
export function createSqliteMemoryNoteRepository(db) {
  const nextId = createIdAllocator(db, 'memory_notes', 'note');

  const rowToModel = (r) =>
    r == null
      ? null
      : {
          id: r.id,
          medicationId: r.medication_id,
          text: r.text,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        };

  const upsert = db.prepare(`
    INSERT INTO memory_notes (id, medication_id, text, created_at, updated_at)
    VALUES (@id, @medicationId, @text, @createdAt, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      medication_id = excluded.medication_id,
      text = excluded.text,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `);

  const write = (n) =>
    upsert.run({
      id: n.id,
      medicationId: n.medicationId ?? null,
      text: n.text ?? '',
      createdAt: n.createdAt ?? null,
      updatedAt: n.updatedAt ?? null,
    });

  const getById = (id) => {
    if (id == null) return null;
    return rowToModel(
      db.prepare('SELECT * FROM memory_notes WHERE id = ?').get(String(id)) ?? null,
    );
  };

  return {
    insert: (note) => {
      const id = note?.id == null ? nextId() : note.id;
      const stored = { ...note, id };
      write(stored);
      return getById(id);
    },
    getById,
    listByMedication: (medicationId) =>
      db
        .prepare('SELECT * FROM memory_notes WHERE medication_id = ? ORDER BY rowid')
        .all(String(medicationId))
        .map(rowToModel),
    update: (id, patch) => patchAndWrite(getById, write, id, patch),
    remove: (id) => {
      if (id == null) return false;
      return db.prepare('DELETE FROM memory_notes WHERE id = ?').run(String(id)).changes > 0;
    },
  };
}

/* --------------------------------------------------------------------------
 * Interaction Warning
 * ------------------------------------------------------------------------ */

/** @returns {import('../interfaces.js').InteractionWarningRepository} */
export function createSqliteInteractionWarningRepository(db) {
  const nextId = createIdAllocator(db, 'interaction_warnings', 'warning');

  const rowToModel = (r) =>
    r == null
      ? null
      : {
          id: r.id,
          patientId: r.patient_id,
          medicationIdA: r.medication_id_a,
          medicationIdB: r.medication_id_b,
          description: r.description,
          status: r.status,
        };

  const upsert = db.prepare(`
    INSERT INTO interaction_warnings (id, patient_id, medication_id_a, medication_id_b, description, status)
    VALUES (@id, @patientId, @medicationIdA, @medicationIdB, @description, @status)
    ON CONFLICT(id) DO UPDATE SET
      patient_id = excluded.patient_id,
      medication_id_a = excluded.medication_id_a,
      medication_id_b = excluded.medication_id_b,
      description = excluded.description,
      status = excluded.status
  `);

  const write = (w) =>
    upsert.run({
      id: w.id,
      patientId: w.patientId ?? null,
      medicationIdA: w.medicationIdA ?? null,
      medicationIdB: w.medicationIdB ?? null,
      description: w.description ?? '',
      status: w.status ?? InteractionWarningStatus.ACTIVE,
    });

  const getById = (id) => {
    if (id == null) return null;
    return rowToModel(
      db.prepare('SELECT * FROM interaction_warnings WHERE id = ?').get(String(id)) ?? null,
    );
  };

  return {
    insert: (warning) => {
      const id = warning?.id == null ? nextId() : warning.id;
      const stored = { ...warning, id };
      write(stored);
      return getById(id);
    },
    getById,
    listByPatient: (patientId) =>
      db
        .prepare('SELECT * FROM interaction_warnings WHERE patient_id = ? ORDER BY rowid')
        .all(String(patientId))
        .map(rowToModel),
    listActiveByPatient: (patientId) =>
      db
        .prepare(
          'SELECT * FROM interaction_warnings WHERE patient_id = ? AND status = ? ORDER BY rowid',
        )
        .all(String(patientId), InteractionWarningStatus.ACTIVE)
        .map(rowToModel),
    update: (id, patch) => patchAndWrite(getById, write, id, patch),
    remove: (id) => {
      if (id == null) return false;
      return (
        db.prepare('DELETE FROM interaction_warnings WHERE id = ?').run(String(id)).changes > 0
      );
    },
  };
}

/* --------------------------------------------------------------------------
 * Interaction Rule (keyed by unordered drug pair, no surrogate id)
 * ------------------------------------------------------------------------ */

/** @returns {import('../interfaces.js').InteractionRuleRepository} */
export function createSqliteInteractionRuleRepository(db) {
  const rowToModel = (r) =>
    r == null
      ? null
      : { drugA: r.drug_a, drugB: r.drug_b, severity: r.severity, description: r.description };

  const upsert = db.prepare(`
    INSERT INTO interaction_rules (drug_a, drug_b, severity, description)
    VALUES (@drugA, @drugB, @severity, @description)
    ON CONFLICT(drug_a, drug_b) DO UPDATE SET
      severity = excluded.severity,
      description = excluded.description
  `);

  return {
    insert: (rule) => {
      const [a, b] = normalizePair(rule.drugA, rule.drugB);
      const stored = { ...rule, drugA: a, drugB: b };
      upsert.run({
        drugA: a,
        drugB: b,
        severity: stored.severity ?? 'unknown',
        description: stored.description ?? '',
      });
      return { ...stored };
    },
    list: () =>
      db.prepare('SELECT * FROM interaction_rules ORDER BY rowid').all().map(rowToModel),
    getByPair: (drugA, drugB) => {
      const [a, b] = normalizePair(drugA, drugB);
      return rowToModel(
        db
          .prepare('SELECT * FROM interaction_rules WHERE drug_a = ? AND drug_b = ?')
          .get(String(a), String(b)) ?? null,
      );
    },
    remove: (drugA, drugB) => {
      const [a, b] = normalizePair(drugA, drugB);
      return (
        db
          .prepare('DELETE FROM interaction_rules WHERE drug_a = ? AND drug_b = ?')
          .run(String(a), String(b)).changes > 0
      );
    },
  };
}

/* --------------------------------------------------------------------------
 * Notification
 * ------------------------------------------------------------------------ */

/** @returns {import('../interfaces.js').NotificationRepository} */
export function createSqliteNotificationRepository(db) {
  const nextId = createIdAllocator(db, 'notifications', 'notification');

  const rowToModel = (r) =>
    r == null
      ? null
      : {
          id: r.id,
          type: r.type,
          recipientRef: r.recipient_ref,
          channel: r.channel,
          payload: parseJson(r.payload, {}),
          status: r.status,
          attemptCount: r.attempt_count,
          maxAttempts: r.max_attempts,
          scheduledFor: r.scheduled_for,
        };

  const upsert = db.prepare(`
    INSERT INTO notifications (id, type, recipient_ref, channel, payload, status, attempt_count, max_attempts, scheduled_for)
    VALUES (@id, @type, @recipientRef, @channel, @payload, @status, @attemptCount, @maxAttempts, @scheduledFor)
    ON CONFLICT(id) DO UPDATE SET
      type = excluded.type,
      recipient_ref = excluded.recipient_ref,
      channel = excluded.channel,
      payload = excluded.payload,
      status = excluded.status,
      attempt_count = excluded.attempt_count,
      max_attempts = excluded.max_attempts,
      scheduled_for = excluded.scheduled_for
  `);

  const write = (n) =>
    upsert.run({
      id: n.id,
      type: n.type ?? 'dose',
      recipientRef: n.recipientRef ?? null,
      channel: n.channel ?? null,
      payload: toJson(n.payload ?? {}),
      status: n.status ?? 'pending',
      attemptCount: n.attemptCount ?? 0,
      maxAttempts: n.maxAttempts ?? 1,
      scheduledFor: n.scheduledFor ?? null,
    });

  const getById = (id) => {
    if (id == null) return null;
    return rowToModel(
      db.prepare('SELECT * FROM notifications WHERE id = ?').get(String(id)) ?? null,
    );
  };

  return {
    insert: (notification) => {
      const id = notification?.id == null ? nextId() : notification.id;
      const stored = { ...notification, id };
      write(stored);
      return getById(id);
    },
    getById,
    listByStatus: (status) =>
      db
        .prepare('SELECT * FROM notifications WHERE status = ? ORDER BY rowid')
        .all(status)
        .map(rowToModel),
    update: (id, patch) => patchAndWrite(getById, write, id, patch),
    remove: (id) => {
      if (id == null) return false;
      return db.prepare('DELETE FROM notifications WHERE id = ?').run(String(id)).changes > 0;
    },
  };
}

/* --------------------------------------------------------------------------
 * Provider Assignment
 * ------------------------------------------------------------------------ */

/** @returns {import('../interfaces.js').ProviderAssignmentRepository} */
export function createSqliteProviderAssignmentRepository(db) {
  const nextId = createIdAllocator(db, 'provider_assignments', 'assignment');

  const rowToModel = (r) =>
    r == null
      ? null
      : { id: r.id, providerId: r.provider_id, patientId: r.patient_id, active: toBool(r.active) };

  const upsert = db.prepare(`
    INSERT INTO provider_assignments (id, provider_id, patient_id, active)
    VALUES (@id, @providerId, @patientId, @active)
    ON CONFLICT(id) DO UPDATE SET
      provider_id = excluded.provider_id,
      patient_id = excluded.patient_id,
      active = excluded.active
  `);

  const write = (a) =>
    upsert.run({
      id: a.id,
      providerId: a.providerId ?? null,
      patientId: a.patientId ?? null,
      active: fromBool(a.active),
    });

  const getById = (id) => {
    if (id == null) return null;
    return rowToModel(
      db.prepare('SELECT * FROM provider_assignments WHERE id = ?').get(String(id)) ?? null,
    );
  };

  return {
    insert: (assignment) => {
      const id = assignment?.id == null ? nextId() : assignment.id;
      const stored = { ...assignment, id };
      write(stored);
      return getById(id);
    },
    getById,
    listByProvider: (providerId) =>
      db
        .prepare('SELECT * FROM provider_assignments WHERE provider_id = ? ORDER BY rowid')
        .all(String(providerId))
        .map(rowToModel),
    listByPatient: (patientId) =>
      db
        .prepare('SELECT * FROM provider_assignments WHERE patient_id = ? ORDER BY rowid')
        .all(String(patientId))
        .map(rowToModel),
    isActivelyAssigned: (providerId, patientId) => {
      const row = db
        .prepare(
          'SELECT 1 FROM provider_assignments WHERE provider_id = ? AND patient_id = ? AND active = 1 LIMIT 1',
        )
        .get(String(providerId), String(patientId));
      return row != null;
    },
    update: (id, patch) => patchAndWrite(getById, write, id, patch),
    remove: (id) => {
      if (id == null) return false;
      return (
        db.prepare('DELETE FROM provider_assignments WHERE id = ?').run(String(id)).changes > 0
      );
    },
  };
}

/* --------------------------------------------------------------------------
 * Audit Entry (append-only)
 * ------------------------------------------------------------------------ */

/** @returns {import('../interfaces.js').AuditEntryRepository} */
export function createSqliteAuditEntryRepository(db) {
  const nextId = createIdAllocator(db, 'audit_entries', 'audit');

  const rowToModel = (r) =>
    r == null
      ? null
      : {
          id: r.id,
          userId: r.user_id,
          recordRef: r.record_ref,
          action: r.action,
          timestamp: r.timestamp,
        };

  const insertStmt = db.prepare(`
    INSERT INTO audit_entries (id, user_id, record_ref, action, timestamp)
    VALUES (@id, @userId, @recordRef, @action, @timestamp)
  `);

  const getById = (id) => {
    if (id == null) return null;
    return rowToModel(
      db.prepare('SELECT * FROM audit_entries WHERE id = ?').get(String(id)) ?? null,
    );
  };

  return {
    insert: (entry) => {
      const id = entry?.id == null ? nextId() : entry.id;
      insertStmt.run({
        id,
        userId: entry.userId ?? null,
        recordRef: entry.recordRef ?? null,
        action: entry.action ?? 'read',
        timestamp: entry.timestamp ?? null,
      });
      return getById(id);
    },
    getById,
    listByUser: (userId) =>
      db
        .prepare('SELECT * FROM audit_entries WHERE user_id = ? ORDER BY rowid')
        .all(String(userId))
        .map(rowToModel),
    listByRecord: (recordRef) =>
      db
        .prepare('SELECT * FROM audit_entries WHERE record_ref = ? ORDER BY rowid')
        .all(String(recordRef))
        .map(rowToModel),
    list: () => db.prepare('SELECT * FROM audit_entries ORDER BY rowid').all().map(rowToModel),
  };
}

/* --------------------------------------------------------------------------
 * Aggregate factory
 * ------------------------------------------------------------------------ */

/**
 * Construct the full set of SQLite repositories over one connection. The shape
 * matches `createInMemoryRepositories` in `../memory.js`, so this is a drop-in
 * replacement for wiring services.
 *
 * @param {import('better-sqlite3').Database} db
 */
export function createSqliteRepositories(db) {
  return {
    medications: createSqliteMedicationRepository(db),
    doseEvents: createSqliteDoseEventRepository(db),
    doseLogs: createSqliteDoseLogRepository(db),
    caregivers: createSqliteCaregiverContactRepository(db),
    notes: createSqliteMemoryNoteRepository(db),
    interactionWarnings: createSqliteInteractionWarningRepository(db),
    interactionRules: createSqliteInteractionRuleRepository(db),
    notifications: createSqliteNotificationRepository(db),
    providerAssignments: createSqliteProviderAssignmentRepository(db),
    auditEntries: createSqliteAuditEntryRepository(db),
  };
}
