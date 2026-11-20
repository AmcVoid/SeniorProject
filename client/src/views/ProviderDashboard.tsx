import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApi } from '../api/ApiContext.tsx';
import { useAsync } from '../hooks/useAsync.ts';
import { PageHeading } from '../a11y/RouteAnnouncer.tsx';
import { Loading, ErrorMessage, Empty } from '../components/AsyncState.tsx';
import { AdherenceSummary } from './AdherenceReport.tsx';
import type { Medication, InteractionWarning } from '../types.ts';

export default function ProviderDashboard() {
  const { patientId } = useParams<{ patientId?: string }>();
  const navigate = useNavigate();
  const { client } = useApi();
  const [pendingId, setPendingId] = useState(patientId ?? '');

  const { data, error, loading } = useAsync(
    () => (patientId ? client.getProviderDashboard(patientId) : Promise.resolve(null)),
    [patientId],
  );

  const onSelectPatient = (e: React.FormEvent) => {
    e.preventDefault();
    if (pendingId.trim()) {
      navigate(`/provider/patients/${encodeURIComponent(pendingId.trim())}`);
    }
  };

  const medications: Medication[] = data?.medications ?? [];
  const warnings: InteractionWarning[] = data?.interactionWarnings ?? [];

  return (
    <section className="provider-dashboard-view">
      <div className="view-header-banner provider-header-banner">
        <div className="view-title-group">
          <div className="provider-badge">
            <i className="fa-solid fa-user-doctor" aria-hidden="true" />
            <span>Clinical Provider Portal</span>
          </div>
          <PageHeading title="Provider Dashboard" />
          <p className="view-subtitle">
            Query assigned patients to inspect active drug regimens, review safety interaction alerts, and evaluate adherence metrics.
          </p>
        </div>
        <div className="view-banner-graphic">
          <img
            src="/images/provider-banner.png"
            alt=""
            className="view-banner-img"
            aria-hidden="true"
          />
        </div>
      </div>

      <div className="patient-search-card">
        <form onSubmit={onSelectPatient} aria-label="Open a patient's dashboard" className="patient-search-form">
          <div className="search-input-group">
            <label htmlFor="patient-id" className="visually-hidden">Patient ID</label>
            <div className="search-input-wrapper">
              <i className="fa-solid fa-magnifying-glass search-icon" aria-hidden="true" />
              <input
                id="patient-id"
                type="text"
                placeholder="Enter Patient ID (e.g. patient-1)"
                value={pendingId}
                onChange={(e) => setPendingId(e.target.value)}
              />
            </div>
            <button type="submit" className="btn-primary">
              <i className="fa-solid fa-arrow-right" aria-hidden="true" />
              <span>Open Dashboard</span>
            </button>
          </div>
        </form>
      </div>

      {!patientId && (
        <div className="provider-prompt">
          <Empty>Enter a Patient ID above to view their clinical dashboard.</Empty>
        </div>
      )}

      {patientId && (
        <>
          {loading && <Loading label="Loading patient dashboard…" />}
          {error && <ErrorMessage error={error} />}

          {!loading && !error && data && (
            <div className="patient-record-content">
              <div className="patient-profile-banner">
                <div className="patient-avatar">
                  <i className="fa-solid fa-hospital-user" aria-hidden="true" />
                </div>
                <div className="patient-info">
                  <h2>Patient: <code>{patientId}</code></h2>
                  <span className="patient-status-tag">
                    <i className="fa-solid fa-circle-check" aria-hidden="true" /> Active Assignment
                  </span>
                </div>
              </div>

              {warnings.length > 0 && (
                <div role="alert" className="interaction-alert-box provider-alert">
                  <div className="interaction-alert-title">
                    <i className="fa-solid fa-triangle-exclamation warning-icon" aria-hidden="true" />
                    <h2>Active Drug Interaction Warnings ({warnings.length})</h2>
                  </div>
                  <ul className="interaction-alert-list">
                    {warnings.map((w) => (
                      <li key={w.id ?? `${w.medicationIdA}-${w.medicationIdB}`}>
                        <i className="fa-solid fa-circle-dot alert-bullet" aria-hidden="true" />
                        <span>{w.description || 'Potentially dangerous medication interaction.'}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="section-block">
                <h2>
                  <i className="fa-solid fa-pills section-icon" aria-hidden="true" />
                  Active Medications ({medications.length})
                </h2>
                {medications.length === 0 ? (
                  <Empty>This patient has no active medications.</Empty>
                ) : (
                  <div className="table-responsive">
                    <table className="data-table">
                      <caption>Assigned patient&apos;s active medications</caption>
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
                            <i className="fa-solid fa-boxes-stacked column-icon" aria-hidden="true" />
                            Remaining Supply
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {medications.map((med) => {
                          const supply = med.remainingSupply ?? 0;
                          const isLowSupply = supply > 0 && supply <= 5;
                          const isOut = supply === 0;

                          return (
                            <tr key={med.id}>
                              <th scope="row" className="med-name-cell">
                                <span className="med-name-text">{med.name}</span>
                              </th>
                              <td>{med.dosage || '—'}</td>
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
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="section-block">
                <h2>
                  <i className="fa-solid fa-chart-line section-icon" aria-hidden="true" />
                  Patient Adherence Summary
                </h2>
                {data.adherence ? (
                  <AdherenceSummary report={data.adherence} headingLevel={3} />
                ) : (
                  <Empty>No adherence data recorded for this patient.</Empty>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
