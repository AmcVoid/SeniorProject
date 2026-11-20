import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api/ApiContext.tsx';
import { useAsync } from '../hooks/useAsync.ts';
import { PageHeading } from '../a11y/RouteAnnouncer.tsx';
import { Loading, ErrorMessage, Empty } from '../components/AsyncState.tsx';
import MedicationForm, { formatSchedule } from '../components/MedicationForm.tsx';
import type { Medication, InteractionWarning } from '../types.ts';

export default function MedicationList() {
  const { client } = useApi();
  const { data, error, loading, reload } = useAsync(() => client.listMedications(), []);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  const onDelete = async (med: Medication) => {
    if (!window.confirm(`Remove ${med.name} from your active medications? Its dose history is kept.`)) return;
    try {
      await client.deleteMedication(med.id);
      setStatus(`Removed ${med.name}.`);
      if (editingId === med.id) setEditingId(null);
      reload();
    } catch (err: unknown) {
      setStatus(`Could not remove ${med.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const medications: Medication[] = data?.medications ?? [];
  const warnings: InteractionWarning[] = data?.interactionWarnings ?? [];

  return (
    <section className="medication-list-view">
      <div className="view-header-banner">
        <div className="view-title-group">
          <PageHeading title="My Medications" />
          <p className="view-subtitle">
            Current active prescriptions, dosage amounts, scheduled intake times, and notes.
          </p>
          <div className="badge-count-pill">
            <i className="fa-solid fa-pills" aria-hidden="true" />
            <span>{medications.length} active {medications.length === 1 ? 'medication' : 'medications'}</span>
          </div>
        </div>
        <div className="view-banner-graphic">
          <img
            src="/images/medications-banner.png"
            alt=""
            className="view-banner-img"
            aria-hidden="true"
          />
        </div>
      </div>

      {status && (
        <div role="status" className="status-banner">
          <i className="fa-solid fa-circle-check" aria-hidden="true" />
          <span>{status}</span>
        </div>
      )}

      <div className="add-medication-card">
        {adding ? (
          <>
            <div className="card-header-with-icon">
              <i className="fa-solid fa-prescription-bottle-medical header-icon" aria-hidden="true" />
              <h2>Add a Medication</h2>
            </div>
            <MedicationForm
              submitLabel="Add medication"
              onCancel={() => setAdding(false)}
              onSubmit={async (values) => {
                const created = await client.createMedication({ ...values });
                setAdding(false);
                setStatus(`Added ${created?.name ?? values.name}.`);
                reload();
              }}
            />
          </>
        ) : (
          <button type="button" className="btn-primary" onClick={() => { setAdding(true); setStatus(''); }}>
            <i className="fa-solid fa-plus" aria-hidden="true" />
            <span>Add medication</span>
          </button>
        )}
      </div>

      {loading && <Loading label="Loading medications…" />}
      {error && <ErrorMessage error={error} />}

      {!loading && !error && (
        <>
          <InteractionWarnings warnings={warnings} />

          {medications.length === 0 ? (
            <Empty>You have no active medications recorded.</Empty>
          ) : (
            <div className="table-responsive">
              <table className="data-table">
                <caption>Active medications</caption>
                <thead>
                  <tr>
                    <th scope="col">
                      <i className="fa-solid fa-capsules column-icon" aria-hidden="true" />
                      Medication
                    </th>
                    <th scope="col">
                      <i className="fa-solid fa-prescription-bottle column-icon" aria-hidden="true" />
                      Dosage
                    </th>
                    <th scope="col">
                      <i className="fa-solid fa-calendar-days column-icon" aria-hidden="true" />
                      Schedule
                    </th>
                    <th scope="col">
                      <i className="fa-solid fa-boxes-stacked column-icon" aria-hidden="true" />
                      Remaining Supply
                    </th>
                    <th scope="col">
                      <i className="fa-solid fa-note-sticky column-icon" aria-hidden="true" />
                      Notes
                    </th>
                    <th scope="col">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {medications.map((med) => {
                    const supply = med.remainingSupply ?? 0;
                    const isLowSupply = supply > 0 && supply <= 5;
                    const isOut = supply === 0;

                    return (
                      <React.Fragment key={med.id}>
                      <tr>
                        <th scope="row" className="med-name-cell">
                          <div className="med-name-wrapper">
                            <span className="med-icon-badge">
                              <i className="fa-solid fa-tablets" aria-hidden="true" />
                            </span>
                            <span className="med-name-text">{med.name}</span>
                          </div>
                        </th>
                        <td>{med.dosage || '—'}</td>
                        <td>
                          <span className="schedule-tag">
                            <i className="fa-solid fa-clock" aria-hidden="true" />
                            {formatSchedule(med.schedule)}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`supply-badge ${
                              isOut ? 'supply-out' : isLowSupply ? 'supply-low' : 'supply-ok'
                            }`}
                          >
                            <i
                              className={`fa-solid ${
                                isOut
                                  ? 'fa-circle-xmark'
                                  : isLowSupply
                                  ? 'fa-triangle-exclamation'
                                  : 'fa-circle-check'
                              }`}
                              aria-hidden="true"
                            />
                            {supply} {supply === 1 ? 'unit' : 'units'}
                            {isLowSupply && <small className="supply-warning-text"> (Low)</small>}
                            {isOut && <small className="supply-warning-text"> (Refill needed)</small>}
                          </span>
                        </td>
                        <td>
                          <Link
                            to={`/medications/${encodeURIComponent(med.id)}/notes`}
                            className="btn-table-action"
                          >
                            <i className="fa-solid fa-file-lines" aria-hidden="true" />
                            <span>Notes</span>
                            <span className="visually-hidden"> for {med.name}</span>
                          </Link>
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              type="button"
                              className="btn-table-action"
                              aria-expanded={editingId === med.id}
                              onClick={() => { setEditingId(editingId === med.id ? null : med.id); setStatus(''); }}
                            >
                              <i className="fa-solid fa-pen" aria-hidden="true" />
                              <span>Edit</span>
                              <span className="visually-hidden"> {med.name}</span>
                            </button>
                            <button
                              type="button"
                              className="btn-danger-icon"
                              aria-label={`Remove ${med.name}`}
                              title={`Remove ${med.name}`}
                              onClick={() => onDelete(med)}
                            >
                              <i className="fa-solid fa-trash-can" aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {editingId === med.id && (
                        <tr className="edit-row">
                          <td colSpan={6}>
                            <MedicationForm
                              initial={med}
                              submitLabel="Save changes"
                              onCancel={() => setEditingId(null)}
                              onSubmit={async (values) => {
                                await client.updateMedication(med.id, {
                                  name: values.name,
                                  dosage: values.dosage,
                                  schedule: values.schedule,
                                });
                                setEditingId(null);
                                setStatus(`Saved changes to ${values.name}.`);
                                reload();
                              }}
                            />
                          </td>
                        </tr>
                      )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function InteractionWarnings({ warnings }: { warnings: InteractionWarning[] }) {
  if (!warnings || warnings.length === 0) return null;
  return (
    <div role="alert" className="interaction-alert-box">
      <div className="interaction-alert-title">
        <i className="fa-solid fa-triangle-exclamation warning-icon" aria-hidden="true" />
        <h2>Active interaction warnings</h2>
      </div>
      <p className="interaction-alert-sub">
        The system detected potential interactions between your active medications. Consult your provider.
      </p>
      <ul className="interaction-alert-list">
        {warnings.map((w) => (
          <li key={w.id ?? `${w.medicationIdA}-${w.medicationIdB}`}>
            <i className="fa-solid fa-circle-dot alert-bullet" aria-hidden="true" />
            <span>{w.description || 'Potentially dangerous medication interaction.'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
