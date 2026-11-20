/**
 * Repository interface contracts for the Medication Management System.
 *
 * This module documents the storage contracts that domain/policy/scheduler/
 * notification services depend on. JavaScript has no `interface` keyword, so
 * each contract is expressed as a JSDoc `@typedef` describing the method
 * signatures. Two implementations conform to these contracts:
 *   - `memory.js` — in-memory fakes backing pure-logic and property tests
 *     (this task, 2.2).
 *   - the SQLite repositories built against `better-sqlite3` (task 2.3).
 *
 * Design principles (from design.md "Components and Interfaces"):
 * - Repositories encapsulate storage only. They contain NO Express, NO HTTP,
 *   and NO domain decision logic (scheduling math, grace-period rules,
 *   adherence arithmetic, authorization, retry policy all live in services).
 * - Records passed in/out are the plain data models from `src/domain/models.js`.
 * - Reads return copies (or fresh arrays) so callers cannot mutate stored state
 *   by reference; writes accept a record and return the persisted record
 *   (with an assigned `id` when the input `id` was null).
 * - Methods are synchronous. `better-sqlite3` is synchronous, and the pure
 *   domain services are synchronous, so a synchronous contract keeps the fakes
 *   and the real implementation shape-compatible without forcing async.
 *
 * Requirements supported (foundational):
 * - 1.1: medications repository associates records with a patient.
 * - 3.1: dose-event / dose-log repositories persist logging state.
 * - 9.1: caregiver repository associates contacts with a patient.
 * - 12.3: audit repository persists one entry per PHI access.
 */

/**
 * Common create/read shape shared by most repositories.
 *
 * @template T
 * @typedef {object} Repository
 * @property {(record: T) => T} insert
 *   Persist a new record. If `record.id` is null/undefined, the repository
 *   assigns a fresh unique id and returns the stored record with that id.
 * @property {(id: *) => (T | null)} getById
 *   Return a copy of the record with the given id, or null if none exists.
 * @property {() => T[]} list
 *   Return copies of all stored records (order is insertion order).
 */

/**
 * MedicationRepository — stores {@link module:domain/models.createMedication}
 * records. (R1.1)
 *
 * @typedef {object} MedicationRepository
 * @property {(medication: object) => object} insert
 *   Persist a new medication; assigns an id when absent.
 * @property {(id: *) => (object | null)} getById
 *   Fetch a medication by id, or null.
 * @property {(patientId: *) => object[]} listByPatient
 *   All medications owned by the patient (active and inactive).
 * @property {(patientId: *) => object[]} listActiveByPatient
 *   Only the patient's medications where `active === true` (R1.5, R6.1).
 * @property {(id: *, patch: object) => (object | null)} update
 *   Shallow-merge `patch` into the stored medication and return the updated
 *   record; null if the medication does not exist (R1.3).
 * @property {(id: *) => boolean} markInactive
 *   Set `active = false` (soft delete, preserving history). Returns true if a
 *   record was updated (R1.4).
 * @property {(id: *) => boolean} remove
 *   Hard-delete a medication by id. Returns true if a record was removed.
 */

/**
 * DoseEventRepository — stores {@link module:domain/models.createDoseEvent}
 * records. Dose events are the concrete scheduled occurrences a medication
 * expands into. (R1.6, R3.x)
 *
 * @typedef {object} DoseEventRepository
 * @property {(doseEvent: object) => object} insert
 *   Persist a new dose event; assigns an id when absent.
 * @property {(doseEvents: object[]) => object[]} insertMany
 *   Persist a batch of dose events (used by schedule expansion); returns the
 *   stored records in the same order.
 * @property {(id: *) => (object | null)} getById
 *   Fetch a dose event by id, or null.
 * @property {(medicationId: *) => object[]} listByMedication
 *   All dose events for a medication.
 * @property {(medicationId: *, boundaryTime: string) => object[]} listFutureByMedication
 *   Dose events for a medication whose `scheduledTime` is strictly after
 *   `boundaryTime` (used to remove future events on delete) (R1.4).
 * @property {(from: string, to: string) => object[]} listDueBetween
 *   Dose events with `scheduledTime` in the inclusive `[from, to]` window,
 *   used by the scheduler to claim due events (R2.1, R13.1).
 * @property {(id: *, patch: object) => (object | null)} update
 *   Shallow-merge `patch` (e.g. status) into the stored event; null if absent.
 * @property {(id: *) => boolean} remove
 *   Delete a dose event by id. Returns true if removed.
 * @property {(medicationId: *, boundaryTime: string) => number} removeFutureByMedication
 *   Delete a medication's dose events strictly after `boundaryTime`; returns
 *   the count removed (R1.4).
 */

/**
 * DoseLogRepository — stores {@link module:domain/models.createDoseLog}
 * records. At most one active log per dose event (design invariant). (R3.1)
 *
 * @typedef {object} DoseLogRepository
 * @property {(doseLog: object) => object} insert
 *   Persist a new dose log; assigns an id when absent.
 * @property {(id: *) => (object | null)} getById
 *   Fetch a dose log by id, or null.
 * @property {(doseEventId: *) => (object | null)} getByDoseEvent
 *   Return the (single) log for a dose event, or null when unlogged (R3.1).
 * @property {(doseEventIds: Array<*>) => object[]} listByDoseEvents
 *   All logs whose `doseEventId` is in the provided set (used by dose history
 *   and adherence) (R3.4, R8.x).
 * @property {(doseEventId: *, patch: object) => (object | null)} updateByDoseEvent
 *   Shallow-merge `patch` (e.g. status/loggedAt) into the log for an event;
 *   null if no log exists for that event (R3.5).
 * @property {(id: *) => boolean} remove
 *   Delete a dose log by id. Returns true if removed.
 */

/**
 * CaregiverContactRepository — stores
 * {@link module:domain/models.createCaregiverContact} records. (R9.1)
 *
 * @typedef {object} CaregiverContactRepository
 * @property {(contact: object) => object} insert
 *   Persist a new caregiver contact; assigns an id when absent (R9.1).
 * @property {(id: *) => (object | null)} getById
 *   Fetch a contact by id, or null.
 * @property {(patientId: *) => object[]} listByPatient
 *   All of the patient's caregiver contacts (R9.5).
 * @property {(patientId: *) => object[]} listActiveByPatient
 *   Only the patient's contacts where `active === true` — the set eligible to
 *   receive alerts (R9.4, R4.1).
 * @property {(id: *, patch: object) => (object | null)} update
 *   Shallow-merge `patch` into the contact; null if absent (R9.3).
 * @property {(id: *) => boolean} remove
 *   Delete a caregiver contact by id, stopping future alerts (R9.4).
 */

/**
 * MemoryNoteRepository — stores
 * {@link module:domain/models.createMemoryNote} records. (R10.1)
 *
 * @typedef {object} MemoryNoteRepository
 * @property {(note: object) => object} insert
 *   Persist a new memory note; assigns an id when absent (R10.1).
 * @property {(id: *) => (object | null)} getById
 *   Fetch a note by id, or null.
 * @property {(medicationId: *) => object[]} listByMedication
 *   All notes attached to a medication (surfaced on medication view) (R10.2).
 * @property {(id: *, patch: object) => (object | null)} update
 *   Shallow-merge `patch` into the note; null if absent (R10.3).
 * @property {(id: *) => boolean} remove
 *   Delete a memory note by id (R10.4).
 */

/**
 * InteractionWarningRepository — stores per-patient
 * {@link module:domain/models.createInteractionWarning} records (PHI). (R7.1)
 *
 * @typedef {object} InteractionWarningRepository
 * @property {(warning: object) => object} insert
 *   Persist a new interaction warning; assigns an id when absent (R7.1).
 * @property {(id: *) => (object | null)} getById
 *   Fetch a warning by id, or null.
 * @property {(patientId: *) => object[]} listByPatient
 *   All warnings recorded for the patient.
 * @property {(patientId: *) => object[]} listActiveByPatient
 *   Only the patient's warnings where `status === 'active'` (surfaced in
 *   listings / display) (R7.3, R6.4).
 * @property {(id: *, patch: object) => (object | null)} update
 *   Shallow-merge `patch` (e.g. status -> resolved) into the warning; null if
 *   absent (R7.4).
 * @property {(id: *) => boolean} remove
 *   Delete a warning by id. Returns true if removed.
 */

/**
 * InteractionRuleRepository — stores
 * {@link module:domain/models.createInteractionRule} records. This is the
 * shared rule set, NOT per-patient PHI, so entries are keyed by the unordered
 * drug pair rather than by an assigned id.
 *
 * @typedef {object} InteractionRuleRepository
 * @property {(rule: object) => object} insert
 *   Persist an interaction rule keyed by its normalized (drugA, drugB) pair;
 *   inserting a rule for an existing pair replaces it.
 * @property {() => object[]} list
 *   Return all interaction rules (the full rule set passed to
 *   `InteractionService.evaluateInteractions`) (R7.1).
 * @property {(drugA: *, drugB: *) => (object | null)} getByPair
 *   Return the rule for an unordered drug pair, or null if none.
 * @property {(drugA: *, drugB: *) => boolean} remove
 *   Delete the rule for an unordered drug pair. Returns true if removed.
 */

/**
 * NotificationRepository — stores
 * {@link module:domain/models.createNotification} records tracked through
 * delivery/retry. (R13.2)
 *
 * @typedef {object} NotificationRepository
 * @property {(notification: object) => object} insert
 *   Persist a new notification; assigns an id when absent.
 * @property {(id: *) => (object | null)} getById
 *   Fetch a notification by id, or null.
 * @property {(status: string) => object[]} listByStatus
 *   All notifications in a given delivery status (e.g. `undelivered` for
 *   later review) (R13.3).
 * @property {(id: *, patch: object) => (object | null)} update
 *   Shallow-merge `patch` (status/attemptCount) into the notification; null if
 *   absent. Implementations MUST NOT let `attemptCount` exceed `maxAttempts`
 *   at the domain layer, but the repository itself only persists what it is
 *   given (R13.2).
 * @property {(id: *) => boolean} remove
 *   Delete a notification by id. Returns true if removed.
 */

/**
 * ProviderAssignmentRepository — stores
 * {@link module:domain/models.createProviderAssignment} records that link a
 * provider to a patient and can be revoked. Backs the authorization policy
 * layer's "provider is assigned to this patient" check. (R11.4, R12.4)
 *
 * @typedef {object} ProviderAssignmentRepository
 * @property {(assignment: object) => object} insert
 *   Persist a new provider assignment; assigns an id when absent.
 * @property {(id: *) => (object | null)} getById
 *   Fetch an assignment by id, or null.
 * @property {(providerId: *) => object[]} listByProvider
 *   All assignments for a provider.
 * @property {(patientId: *) => object[]} listByPatient
 *   All assignments covering a patient.
 * @property {(providerId: *, patientId: *) => boolean} isActivelyAssigned
 *   True iff an assignment exists for (providerId, patientId) with
 *   `active === true` (R11.4). Denies access after revocation (R12.4).
 * @property {(id: *, patch: object) => (object | null)} update
 *   Shallow-merge `patch` (e.g. active -> false to revoke) into the
 *   assignment; null if absent (R12.4).
 * @property {(id: *) => boolean} remove
 *   Delete an assignment by id. Returns true if removed.
 */

/**
 * UserRepository — stores {@link module:domain/models.createUser} records that
 * back the Auth & Session layer. Users authenticate by a login `identifier`
 * (username/email) which is distinct from the surrogate `id`, so lookups by
 * identifier must be supported without exposing whether an identifier exists
 * to callers other than the auth service. (R11.1, R11.2)
 *
 * @typedef {object} UserRepository
 * @property {(user: object) => object} insert
 *   Persist a new user; assigns an id when absent. The stored record carries
 *   `credentialHash` (never a plaintext credential) and an `identifier`.
 * @property {(id: *) => (object | null)} getById
 *   Fetch a user by surrogate id, or null.
 * @property {(identifier: string) => (object | null)} findByIdentifier
 *   Resolve a login identifier to its user record, or null when unknown. Used
 *   by `authenticate` (R11.1); the auth service returns a generic error rather
 *   than surfacing null to prevent user enumeration (R11.2).
 */

/**
 * AuditEntryRepository — append-only store of
 * {@link module:domain/models.createAuditEntry} records, one per PHI access.
 * (R12.3)
 *
 * @typedef {object} AuditEntryRepository
 * @property {(entry: object) => object} insert
 *   Append a new audit entry; assigns an id when absent (R12.3).
 * @property {(id: *) => (object | null)} getById
 *   Fetch an audit entry by id, or null.
 * @property {(userId: *) => object[]} listByUser
 *   All audit entries recorded for a user.
 * @property {(recordRef: *) => object[]} listByRecord
 *   All audit entries referencing a particular record.
 * @property {() => object[]} list
 *   All audit entries (insertion order).
 */

// This module is documentation-only (JSDoc typedefs). It intentionally exports
// nothing at runtime; import the concrete fakes from `./memory.js` for tests.
export {};
