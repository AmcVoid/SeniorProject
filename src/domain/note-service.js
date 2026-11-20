/**
 * NoteService — memory-note CRUD for the Medication Management System.
 *
 * Memory notes are free-text context a patient attaches to a medication (for
 * example, "take with food"). This service provides attach / edit / delete
 * operations and surfaces the notes currently attached to a medication. It is
 * pure application logic in the sense that it contains NO Express, NO HTTP, and
 * NO direct I/O: storage is delegated to an injected
 * {@link module:data/interfaces.MemoryNoteRepository}, and the "current time"
 * is supplied via an injectable clock so behavior is deterministic in tests.
 *
 * Design references (design.md "NoteService"):
 * - CRUD for memory notes attached to a medication (R10.1–R10.4).
 * - Notes are surfaced on medication view (R10.2) and included in dose
 *   reminders (R10.5, handled by the notification payload builders, task 12.2).
 *
 * Requirements supported:
 * - 10.1: attaching a Memory_Note saves it associated with the medication.
 * - 10.2: viewing a Medication displays the Memory_Notes associated with it.
 * - 10.3: editing a Memory_Note saves the updated text.
 * - 10.4: deleting a Memory_Note removes it from the associated medication.
 */

import { createMemoryNote } from './models.js';

/**
 * Create a NoteService bound to a memory-note repository.
 *
 * @param {object} deps
 * @param {import('../data/interfaces.js').MemoryNoteRepository} deps.noteRepository
 *   Storage for memory-note records.
 * @param {() => string} [deps.now]
 *   Clock returning an ISO-8601 timestamp; injectable for deterministic tests.
 *   Defaults to the current wall-clock time.
 * @returns {{
 *   attachNote: (medicationId: *, text: string) => object,
 *   editNote: (noteId: *, text: string) => (object | null),
 *   deleteNote: (noteId: *) => boolean,
 *   listNotes: (medicationId: *) => object[],
 * }}
 */
export function createNoteService({ noteRepository, now = () => new Date().toISOString() }) {
  if (!noteRepository) {
    throw new Error('createNoteService requires a noteRepository');
  }

  /**
   * Attach a new memory note to a medication (R10.1). The note's `createdAt`
   * and `updatedAt` are stamped from the injected clock and initially equal.
   *
   * @param {*} medicationId - The medication the note is attached to.
   * @param {string} text - Free-text note content.
   * @returns {object} The persisted note (with an assigned id).
   */
  function attachNote(medicationId, text) {
    const timestamp = now();
    const note = createMemoryNote({
      medicationId,
      text,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return noteRepository.insert(note);
  }

  /**
   * Edit an existing memory note's text (R10.3). Refreshes `updatedAt` from the
   * injected clock while preserving `createdAt` and the medication association.
   *
   * @param {*} noteId - Id of the note to edit.
   * @param {string} text - New note text.
   * @returns {object | null} The updated note, or null if no such note exists.
   */
  function editNote(noteId, text) {
    return noteRepository.update(noteId, { text, updatedAt: now() });
  }

  /**
   * Delete a memory note, removing it from its medication (R10.4).
   *
   * @param {*} noteId - Id of the note to delete.
   * @returns {boolean} True when a note was removed; false when none existed.
   */
  function deleteNote(noteId) {
    return noteRepository.remove(noteId);
  }

  /**
   * List the memory notes currently attached to a medication, surfaced on the
   * medication view (R10.2). Returns exactly the notes presently stored for the
   * medication (deletions are reflected immediately).
   *
   * @param {*} medicationId - The medication whose notes to fetch.
   * @returns {object[]} The medication's memory notes (insertion order).
   */
  function listNotes(medicationId) {
    return noteRepository.listByMedication(medicationId);
  }

  return { attachNote, editNote, deleteNote, listNotes };
}
