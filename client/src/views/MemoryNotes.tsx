import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApi } from '../api/ApiContext.tsx';
import { useAsync } from '../hooks/useAsync.ts';
import { PageHeading } from '../a11y/RouteAnnouncer.tsx';
import { Loading, ErrorMessage, Empty } from '../components/AsyncState.tsx';
import type { MemoryNote } from '../types.ts';

export default function MemoryNotes() {
  const { medicationId } = useParams<{ medicationId: string }>();
  const { client } = useApi();
  const { data, error, loading, reload } = useAsync(
    () => (medicationId ? client.listNotes(medicationId) : Promise.resolve({ notes: [] })),
    [medicationId],
  );
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  const [formError, setFormError] = useState<Error | null>(null);

  const notes: MemoryNote[] = data?.notes ?? [];
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editError, setEditError] = useState<Error | null>(null);

  const startEdit = (note: MemoryNote) => {
    setEditingId(note.id);
    setEditText(note.text);
    setEditError(null);
    setStatus('');
  };

  const onSaveEdit = async (e: React.FormEvent, note: MemoryNote) => {
    e.preventDefault();
    if (!medicationId || !editText.trim()) {
      setEditError(new Error('A note cannot be empty. Use Delete to remove it.'));
      return;
    }
    try {
      await client.editNote(medicationId, note.id, editText.trim());
      setEditingId(null);
      setStatus('Note updated.');
      reload();
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err : new Error(String(err)));
    }
  };

  const onDelete = async (note: MemoryNote) => {
    if (!medicationId || !window.confirm('Delete this note? This cannot be undone.')) return;
    try {
      await client.deleteNote(medicationId, note.id);
      if (editingId === note.id) setEditingId(null);
      setStatus('Note deleted.');
      reload();
    } catch (err: unknown) {
      setStatus(`Could not delete note: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const onAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!medicationId || !text.trim()) return;
    setFormError(null);
    try {
      await client.addNote(medicationId, text.trim());
      setStatus('Note added successfully.');
      setText('');
      reload();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err : new Error(String(err)));
    }
  };

  return (
    <section className="notes-view">
      <div className="view-header">
        <Link to="/medications" className="back-link">
          <i className="fa-solid fa-arrow-left" aria-hidden="true" />
          <span>Back to medications</span>
        </Link>
        <PageHeading title="Medication Notes" />
        <p className="view-subtitle">
          Personal reminders, administration instructions, food requirements, and special notes for medication{' '}
          <code>{medicationId}</code>.
        </p>
      </div>

      {status && (
        <div role="status" className="status-banner">
          <i className="fa-solid fa-circle-check" aria-hidden="true" />
          <span>{status}</span>
        </div>
      )}

      <div className="add-note-card">
        <div className="card-header-with-icon">
          <i className="fa-solid fa-note-sticky header-icon" aria-hidden="true" />
          <h2>Add a Memory Note</h2>
        </div>
        <form onSubmit={onAdd} className="note-form">
          <div className="form-group">
            <label htmlFor="note-text">
              Note Description
            </label>
            <textarea
              id="note-text"
              required
              rows={3}
              placeholder="e.g. Take with a full glass of water. Avoid taking on an empty stomach."
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          {formError && <ErrorMessage error={formError} />}
          <button type="submit" className="btn-primary">
            <i className="fa-solid fa-plus" aria-hidden="true" />
            <span>Save note</span>
          </button>
        </form>
      </div>

      <div className="notes-list-section">
        <h2>
          <i className="fa-solid fa-clipboard-list header-icon" aria-hidden="true" />
          Existing Notes ({notes.length})
        </h2>

        {loading && <Loading label="Loading notes…" />}
        {error && <ErrorMessage error={error} />}

        {!loading && !error && (
          notes.length === 0 ? (
            <Empty>No notes recorded for this medication yet.</Empty>
          ) : (
            <ul aria-label="Medication notes" className="notes-card-list">
              {notes.map((note) => (
                <li key={note.id} className="note-item-card">
                  <div className="note-card-icon">
                    <i className="fa-solid fa-quote-left" aria-hidden="true" />
                  </div>
                  <div className="note-card-content">
                    {editingId === note.id ? (
                      <form onSubmit={(e) => onSaveEdit(e, note)} className="note-form note-edit-form">
                        <label htmlFor={`note-edit-${note.id}`} className="visually-hidden">Edit note</label>
                        <textarea
                          id={`note-edit-${note.id}`}
                          rows={3}
                          value={editText}
                          autoFocus
                          onChange={(e) => setEditText(e.target.value)}
                        />
                        {editError && <ErrorMessage error={editError} />}
                        <div className="form-actions">
                          <button type="submit" className="btn-primary">
                            <i className="fa-solid fa-check" aria-hidden="true" />
                            <span>Save</span>
                          </button>
                          <button type="button" className="btn-clear" onClick={() => setEditingId(null)}>Cancel</button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <p className="note-text">{note.text}</p>
                        {note.updatedAt && (
                          <span className="note-timestamp">
                            <i className="fa-solid fa-clock" aria-hidden="true" />
                            <span>Updated {formatDateTime(note.updatedAt)}</span>
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  {editingId !== note.id && (
                    <div className="row-actions">
                      <button type="button" className="btn-table-action" onClick={() => startEdit(note)}>
                        <i className="fa-solid fa-pen" aria-hidden="true" />
                        <span>Edit</span>
                        <span className="visually-hidden"> note</span>
                      </button>
                      <button
                        type="button"
                        className="btn-danger-icon"
                        aria-label="Delete note"
                        title="Delete note"
                        onClick={() => onDelete(note)}
                      >
                        <i className="fa-solid fa-trash-can" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )
        )}
      </div>
    </section>
  );
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
}
