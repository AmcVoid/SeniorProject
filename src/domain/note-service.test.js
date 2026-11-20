/**
 * Unit tests for NoteService (task 11.1).
 *
 * Verifies memory-note CRUD and view surfacing against the in-memory
 * MemoryNoteRepository fake:
 * - attaching saves a note associated with the medication (R10.1)
 * - viewing displays exactly the notes currently attached (R10.2)
 * - editing persists the updated text and refreshes updatedAt (R10.3)
 * - deleting removes the note from the medication (R10.4)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createInMemoryMemoryNoteRepository } from '../data/memory.js';
import { createNoteService } from './note-service.js';

/** Build a service with a fresh repository and a controllable clock. */
function setup(nowValue = '2024-01-01T00:00:00.000Z') {
  const noteRepository = createInMemoryMemoryNoteRepository();
  let clock = nowValue;
  const service = createNoteService({
    noteRepository,
    now: () => clock,
  });
  return { service, noteRepository, setNow: (v) => (clock = v) };
}

test('createNoteService throws without a noteRepository', () => {
  assert.throws(() => createNoteService({}), /noteRepository/);
});

test('attachNote saves a note associated with the medication (R10.1)', () => {
  const { service } = setup('2024-03-04T08:00:00.000Z');
  const note = service.attachNote('med-1', 'take with food');

  assert.ok(note.id, 'note should be assigned an id');
  assert.equal(note.medicationId, 'med-1');
  assert.equal(note.text, 'take with food');
  assert.equal(note.createdAt, '2024-03-04T08:00:00.000Z');
  assert.equal(note.updatedAt, '2024-03-04T08:00:00.000Z');
});

test('listNotes shows exactly the notes attached to a medication (R10.2)', () => {
  const { service } = setup();
  service.attachNote('med-1', 'first');
  service.attachNote('med-1', 'second');
  service.attachNote('med-2', 'other medication');

  const notes = service.listNotes('med-1');
  assert.equal(notes.length, 2);
  assert.deepEqual(
    notes.map((n) => n.text),
    ['first', 'second'],
  );
  assert.ok(notes.every((n) => n.medicationId === 'med-1'));

  // A medication with no notes surfaces an empty list.
  assert.deepEqual(service.listNotes('med-3'), []);
});

test('editNote persists updated text and refreshes updatedAt (R10.3)', () => {
  const { service, setNow } = setup('2024-03-04T08:00:00.000Z');
  const note = service.attachNote('med-1', 'take with food');

  setNow('2024-03-05T09:30:00.000Z');
  const updated = service.editNote(note.id, 'take with water instead');

  assert.equal(updated.id, note.id);
  assert.equal(updated.medicationId, 'med-1');
  assert.equal(updated.text, 'take with water instead');
  assert.equal(updated.createdAt, '2024-03-04T08:00:00.000Z', 'createdAt preserved');
  assert.equal(updated.updatedAt, '2024-03-05T09:30:00.000Z', 'updatedAt refreshed');

  // The change is reflected on subsequent views.
  assert.equal(service.listNotes('med-1')[0].text, 'take with water instead');
});

test('editNote returns null for an unknown note', () => {
  const { service } = setup();
  assert.equal(service.editNote('missing', 'nope'), null);
});

test('deleteNote removes the note from the medication (R10.4)', () => {
  const { service } = setup();
  const keep = service.attachNote('med-1', 'keep me');
  const drop = service.attachNote('med-1', 'delete me');

  assert.equal(service.deleteNote(drop.id), true);

  const remaining = service.listNotes('med-1');
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, keep.id);
});

test('deleteNote returns false when the note does not exist', () => {
  const { service } = setup();
  assert.equal(service.deleteNote('missing'), false);
});
