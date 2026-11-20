/**
 * In-memory fake repositories for the Medication Management System.
 *
 * These fakes conform to the contracts documented in `./interfaces.js`. They
 * back pure-logic and property tests without a live database, and are shape-
 * compatible with the SQLite repositories built in task 2.3 (synchronous,
 * plain-record in/out). Each factory returns an independent store, so tests
 * get a clean slate per construction.
 *
 * Design notes:
 * - Storage is plain and framework-free (no Express, no I/O). No domain
 *   decision logic lives here — repositories only persist and retrieve.
 * - Reads return shallow copies and writes clone their inputs, so callers
 *   cannot mutate stored state by holding a reference. (Nested arrays such as
 *   `deliveryAddresses`/`times` are the model factories' responsibility; the
 *   shallow clone here matches how the SQLite layer will rematerialize rows.)
 * - Ids are assigned as monotonically increasing strings when a record is
 *   inserted without one. Tests may also supply explicit ids.
 *
 * Requirements supported (foundational): 1.1, 3.1, 9.1, 12.3.
 */

import { InteractionWarningStatus } from '../domain/types.js';
import { normalizePair } from '../domain/models.js';

/** Shallow copy that treats null/undefined safely. */
const clone = (record) => (record == null ? record : { ...record });

/**
 * Create an id generator producing stable, unique string ids for a store.
 * @param {string} prefix
 * @returns {() => string}
 */
function createIdSequence(prefix) {
  let counter = 0;
  return () => {
    counter += 1;
    return `${prefix}-${counter}`;
  };
}

/**
 * Build a keyed in-memory table with id assignment and copy-on-read/write.
 *
 * @param {string} prefix - Id prefix used when assigning new ids.
 * @returns {{
 *   map: Map<string, object>,
 *   insert: (record: object) => object,
 *   getById: (id: *) => (object | null),
 *   update: (id: *, patch: object) => (object | null),
 *   remove: (id: *) => boolean,
 *   values: () => object[],
 * }}
 */
function createTable(prefix) {
  const map = new Map();
  const nextId = createIdSequence(prefix);

  const insert = (record) => {
    const id = record?.id == null ? nextId() : record.id;
    const stored = { ...record, id };
    map.set(String(id), stored);
    return clone(stored);
  };

  const getById = (id) => {
    if (id == null) return null;
    return clone(map.get(String(id)) ?? null);
  };

  const update = (id, patch) => {
    if (id == null) return null;
    const key = String(id);
    const existing = map.get(key);
    if (!existing) return null;
    // Preserve identity of `id`; patch cannot change the record's key.
    const updated = { ...existing, ...patch, id: existing.id };
    map.set(key, updated);
    return clone(updated);
  };

  const remove = (id) => {
    if (id == null) return false;
    return map.delete(String(id));
  };

  const values = () => [...map.values()].map(clone);

  return { map, insert, getById, update, remove, values };
}

/**
 * @returns {import('./interfaces.js').MedicationRepository}
 */
export function createInMemoryMedicationRepository() {
  const t = createTable('med');
  return {
    insert: (medication) => t.insert(medication),
    getById: (id) => t.getById(id),
    listByPatient: (patientId) =>
      t.values().filter((m) => String(m.patientId) === String(patientId)),
    listActiveByPatient: (patientId) =>
      t
        .values()
        .filter((m) => String(m.patientId) === String(patientId) && m.active === true),
    update: (id, patch) => t.update(id, patch),
    markInactive: (id) => t.update(id, { active: false }) !== null,
    remove: (id) => t.remove(id),
  };
}

/**
 * @returns {import('./interfaces.js').DoseEventRepository}
 */
export function createInMemoryDoseEventRepository() {
  const t = createTable('dose-event');
  return {
    insert: (doseEvent) => t.insert(doseEvent),
    insertMany: (doseEvents) => (doseEvents ?? []).map((e) => t.insert(e)),
    getById: (id) => t.getById(id),
    listByMedication: (medicationId) =>
      t.values().filter((e) => String(e.medicationId) === String(medicationId)),
    listFutureByMedication: (medicationId, boundaryTime) =>
      t
        .values()
        .filter(
          (e) =>
            String(e.medicationId) === String(medicationId) &&
            e.scheduledTime > boundaryTime,
        ),
    listDueBetween: (from, to) =>
      t.values().filter((e) => e.scheduledTime >= from && e.scheduledTime <= to),
    update: (id, patch) => t.update(id, patch),
    remove: (id) => t.remove(id),
    removeFutureByMedication: (medicationId, boundaryTime) => {
      const doomed = t
        .values()
        .filter(
          (e) =>
            String(e.medicationId) === String(medicationId) &&
            e.scheduledTime > boundaryTime,
        );
      for (const e of doomed) t.remove(e.id);
      return doomed.length;
    },
  };
}

/**
 * @returns {import('./interfaces.js').DoseLogRepository}
 */
export function createInMemoryDoseLogRepository() {
  const t = createTable('dose-log');
  const findByEvent = (doseEventId) =>
    t.values().find((l) => String(l.doseEventId) === String(doseEventId)) ?? null;
  return {
    insert: (doseLog) => t.insert(doseLog),
    getById: (id) => t.getById(id),
    getByDoseEvent: (doseEventId) => findByEvent(doseEventId),
    listByDoseEvents: (doseEventIds) => {
      const wanted = new Set((doseEventIds ?? []).map(String));
      return t.values().filter((l) => wanted.has(String(l.doseEventId)));
    },
    updateByDoseEvent: (doseEventId, patch) => {
      const existing = findByEvent(doseEventId);
      if (!existing) return null;
      return t.update(existing.id, patch);
    },
    remove: (id) => t.remove(id),
  };
}

/**
 * @returns {import('./interfaces.js').CaregiverContactRepository}
 */
export function createInMemoryCaregiverContactRepository() {
  const t = createTable('caregiver');
  return {
    insert: (contact) => t.insert(contact),
    getById: (id) => t.getById(id),
    listByPatient: (patientId) =>
      t.values().filter((c) => String(c.patientId) === String(patientId)),
    listActiveByPatient: (patientId) =>
      t
        .values()
        .filter((c) => String(c.patientId) === String(patientId) && c.active === true),
    update: (id, patch) => t.update(id, patch),
    remove: (id) => t.remove(id),
  };
}

/**
 * @returns {import('./interfaces.js').MemoryNoteRepository}
 */
export function createInMemoryMemoryNoteRepository() {
  const t = createTable('note');
  return {
    insert: (note) => t.insert(note),
    getById: (id) => t.getById(id),
    listByMedication: (medicationId) =>
      t.values().filter((n) => String(n.medicationId) === String(medicationId)),
    update: (id, patch) => t.update(id, patch),
    remove: (id) => t.remove(id),
  };
}

/**
 * @returns {import('./interfaces.js').InteractionWarningRepository}
 */
export function createInMemoryInteractionWarningRepository() {
  const t = createTable('warning');
  return {
    insert: (warning) => t.insert(warning),
    getById: (id) => t.getById(id),
    listByPatient: (patientId) =>
      t.values().filter((w) => String(w.patientId) === String(patientId)),
    listActiveByPatient: (patientId) =>
      t
        .values()
        .filter(
          (w) =>
            String(w.patientId) === String(patientId) &&
            w.status === InteractionWarningStatus.ACTIVE,
        ),
    update: (id, patch) => t.update(id, patch),
    remove: (id) => t.remove(id),
  };
}

/**
 * Interaction rules are keyed by their unordered drug pair rather than an id.
 *
 * @returns {import('./interfaces.js').InteractionRuleRepository}
 */
export function createInMemoryInteractionRuleRepository() {
  const map = new Map();
  const keyFor = (drugA, drugB) => {
    const [a, b] = normalizePair(drugA, drugB);
    return `${a}::${b}`;
  };
  return {
    insert: (rule) => {
      const key = keyFor(rule.drugA, rule.drugB);
      const stored = { ...rule };
      map.set(key, stored);
      return clone(stored);
    },
    list: () => [...map.values()].map(clone),
    getByPair: (drugA, drugB) => clone(map.get(keyFor(drugA, drugB)) ?? null),
    remove: (drugA, drugB) => map.delete(keyFor(drugA, drugB)),
  };
}

/**
 * @returns {import('./interfaces.js').NotificationRepository}
 */
export function createInMemoryNotificationRepository() {
  const t = createTable('notification');
  return {
    insert: (notification) => t.insert(notification),
    getById: (id) => t.getById(id),
    listByStatus: (status) => t.values().filter((n) => n.status === status),
    update: (id, patch) => t.update(id, patch),
    remove: (id) => t.remove(id),
  };
}

/**
 * @returns {import('./interfaces.js').ProviderAssignmentRepository}
 */
export function createInMemoryProviderAssignmentRepository() {
  const t = createTable('assignment');
  return {
    insert: (assignment) => t.insert(assignment),
    getById: (id) => t.getById(id),
    listByProvider: (providerId) =>
      t.values().filter((a) => String(a.providerId) === String(providerId)),
    listByPatient: (patientId) =>
      t.values().filter((a) => String(a.patientId) === String(patientId)),
    isActivelyAssigned: (providerId, patientId) =>
      t
        .values()
        .some(
          (a) =>
            String(a.providerId) === String(providerId) &&
            String(a.patientId) === String(patientId) &&
            a.active === true,
        ),
    update: (id, patch) => t.update(id, patch),
    remove: (id) => t.remove(id),
  };
}

/**
 * Users are looked up both by surrogate id and by login identifier. The login
 * `identifier` is stored on the record and indexed for `findByIdentifier`.
 *
 * @returns {import('./interfaces.js').UserRepository}
 */
export function createInMemoryUserRepository() {
  const t = createTable('user');
  return {
    insert: (user) => t.insert(user),
    getById: (id) => t.getById(id),
    findByIdentifier: (identifier) => {
      if (identifier == null) return null;
      return (
        t.values().find((u) => String(u.identifier) === String(identifier)) ?? null
      );
    },
  };
}

/**
 * @returns {import('./interfaces.js').AuditEntryRepository}
 */
export function createInMemoryAuditEntryRepository() {
  const t = createTable('audit');
  return {
    insert: (entry) => t.insert(entry),
    getById: (id) => t.getById(id),
    listByUser: (userId) =>
      t.values().filter((e) => String(e.userId) === String(userId)),
    listByRecord: (recordRef) =>
      t.values().filter((e) => String(e.recordRef) === String(recordRef)),
    list: () => t.values(),
  };
}

/**
 * Convenience factory that constructs a full set of fresh in-memory
 * repositories. Useful for wiring services in tests with a single call.
 *
 * @returns {{
 *   medications: import('./interfaces.js').MedicationRepository,
 *   doseEvents: import('./interfaces.js').DoseEventRepository,
 *   doseLogs: import('./interfaces.js').DoseLogRepository,
 *   caregivers: import('./interfaces.js').CaregiverContactRepository,
 *   notes: import('./interfaces.js').MemoryNoteRepository,
 *   interactionWarnings: import('./interfaces.js').InteractionWarningRepository,
 *   interactionRules: import('./interfaces.js').InteractionRuleRepository,
 *   notifications: import('./interfaces.js').NotificationRepository,
 *   providerAssignments: import('./interfaces.js').ProviderAssignmentRepository,
 *   auditEntries: import('./interfaces.js').AuditEntryRepository,
 *   users: import('./interfaces.js').UserRepository,
 * }}
 */
export function createInMemoryRepositories() {
  return {
    users: createInMemoryUserRepository(),
    medications: createInMemoryMedicationRepository(),
    doseEvents: createInMemoryDoseEventRepository(),
    doseLogs: createInMemoryDoseLogRepository(),
    caregivers: createInMemoryCaregiverContactRepository(),
    notes: createInMemoryMemoryNoteRepository(),
    interactionWarnings: createInMemoryInteractionWarningRepository(),
    interactionRules: createInMemoryInteractionRuleRepository(),
    notifications: createInMemoryNotificationRepository(),
    providerAssignments: createInMemoryProviderAssignmentRepository(),
    auditEntries: createInMemoryAuditEntryRepository(),
  };
}
