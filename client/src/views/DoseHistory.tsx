import React, { useCallback, useState } from 'react';
import { useApi } from '../api/ApiContext.tsx';
import { ApiError } from '../api/client.ts';
import { useAsync } from '../hooks/useAsync.ts';
import { PageHeading } from '../a11y/RouteAnnouncer.tsx';
import { Loading, ErrorMessage, Empty } from '../components/AsyncState.tsx';
import AdherenceWidget from '../components/AdherenceWidget.tsx';
import type { DoseEvent, DateRange } from '../types.ts';

export default function DoseHistory() {
  const { client } = useApi();
  const [draft, setDraft] = useState<DateRange>({ from: '', to: '' });
  const [range, setRange] = useState<DateRange>({ from: '', to: '' });
  const [status, setStatus] = useState('');
  const [adherenceKey, setAdherenceKey] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const { data, error, loading, reload } = useAsync(
    () => client.getDoseHistory(range),
    [range.from, range.to],
  );

  const history: DoseEvent[] = data?.history ?? [];

  const clearRowError = useCallback((eventId: string) => {
    setRowErrors((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, eventId)) return prev;
      const next = { ...prev };
      delete next[eventId];
      return next;
    });
  }, []);

  const onLog = async (entry: DoseEvent, doseStatus: 'taken' | 'missed') => {
    const eventId = String(entry.doseEventId ?? entry.id);
    const alreadyLogged = Boolean(entry.status);
    setPending(eventId);
    clearRowError(eventId);
    try {
      if (alreadyLogged) {
        await client.changeDoseLog(eventId, doseStatus);
        setStatus(`Dose status changed to ${doseStatus}.`);
      } else {
        await client.logDose(eventId, doseStatus);
        setStatus(`Dose recorded as ${doseStatus}.`);
      }
      setAdherenceKey((k) => k + 1);
      reload();
    } catch (err: unknown) {
      if (err instanceof ApiError && err.fields && err.fields.status) {
        setRowErrors((prev) => ({ ...prev, [eventId]: String(err.fields!.status) }));
        setStatus('');
      } else {
        setStatus(`Could not record dose: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      setPending((cur) => (cur === eventId ? null : cur));
    }
  };

  return (
    <section className="dose-history-view">
      <div className="view-header-banner">
        <div className="view-title-group">
          <PageHeading title="Dose History" />
          <p className="view-subtitle">
            Record your scheduled medication intakes, update recent doses, and monitor adherence.
          </p>
          <div className="badge-count-pill">
            <i className="fa-solid fa-clock-rotate-left" aria-hidden="true" />
            <span>Daily Intake &amp; Adherence Log</span>
          </div>
        </div>
        <div className="view-banner-graphic">
          <img
            src="/images/dose-history-banner.png"
            alt=""
            className="view-banner-img"
            aria-hidden="true"
          />
        </div>
      </div>

      <div className="filter-toolbar">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setRange(draft);
          }}
          aria-label="Filter dose history by date range"
          className="filter-form"
        >
          <div className="filter-field">
            <label htmlFor="from">
              <i className="fa-solid fa-calendar-day" aria-hidden="true" />
              From Date
            </label>
            <input
              id="from"
              type="date"
              value={draft.from}
              onChange={(e) => setDraft((r) => ({ ...r, from: e.target.value }))}
            />
          </div>
          <div className="filter-field">
            <label htmlFor="to">
              <i className="fa-solid fa-calendar-day" aria-hidden="true" />
              To Date
            </label>
            <input
              id="to"
              type="date"
              value={draft.to}
              onChange={(e) => setDraft((r) => ({ ...r, to: e.target.value }))}
            />
          </div>
          <div className="filter-actions">
            <button type="submit" className="btn-filter">
              <i className="fa-solid fa-filter" aria-hidden="true" />
              Apply filter
            </button>
            {(range.from || range.to) && (
              <button
                type="button"
                className="btn-clear"
                onClick={() => {
                  setDraft({ from: '', to: '' });
                  setRange({ from: '', to: '' });
                }}
              >
                Clear
              </button>
            )}
          </div>
        </form>
      </div>

      {status && (
        <div role="status" className="status-banner">
          <i className="fa-solid fa-circle-check" aria-hidden="true" />
          <span>{status}</span>
        </div>
      )}

      <AdherenceWidget
        period={range}
        refreshKey={adherenceKey}
        title="Adherence summary for the selected period"
      />

      {loading && <Loading label="Loading dose history…" />}
      {error && <ErrorMessage error={error} />}

      {!loading && !error && (
        history.length === 0 ? (
          <Empty>No dose events found in this period.</Empty>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <caption>Dose history</caption>
              <thead>
                <tr>
                  <th scope="col">
                    <i className="fa-solid fa-clock column-icon" aria-hidden="true" />
                    Scheduled Time
                  </th>
                  <th scope="col">
                    <i className="fa-solid fa-circle-question column-icon" aria-hidden="true" />
                    Status
                  </th>
                  <th scope="col">
                    <i className="fa-solid fa-calendar-check column-icon" aria-hidden="true" />
                    Logged At
                  </th>
                  <th scope="col">
                    <i className="fa-solid fa-sliders column-icon" aria-hidden="true" />
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry) => {
                  const eventId = String(entry.doseEventId ?? entry.id);
                  const when = formatDateTime(entry.scheduledTime);
                  const busy = pending === eventId;
                  const rowError = rowErrors[eventId] ?? null;
                  const errorId = rowError ? `dose-${eventId}-error` : undefined;
                  const alreadyLogged = Boolean(entry.status);
                  const doseStatus = entry.status ?? 'pending';

                  const takenLabel = alreadyLogged ? 'Change to taken' : 'Mark taken';
                  const missedLabel = alreadyLogged ? 'Change to missed' : 'Mark missed';

                  return (
                    <tr key={eventId}>
                      <th scope="row" className="time-cell">
                        <span className="time-text">{when}</span>
                      </th>
                      <td>
                        <span className={`dose-badge badge-${doseStatus}`}>
                          <i
                            className={`fa-solid ${
                              doseStatus === 'taken'
                                ? 'fa-circle-check'
                                : doseStatus === 'missed'
                                ? 'fa-circle-xmark'
                                : 'fa-clock'
                            }`}
                            aria-hidden="true"
                          />
                          <span>{doseStatus}</span>
                        </span>
                      </td>
                      <td>
                        <span className="logged-at-text">
                          {entry.loggedAt ? formatDateTime(entry.loggedAt) : '—'}
                        </span>
                      </td>
                      <td>
                        <div className="dose-action-buttons">
                          <button
                            type="button"
                            onClick={() => onLog(entry, 'taken')}
                            disabled={busy}
                            aria-describedby={errorId}
                            className="btn-action-taken"
                          >
                            <i className="fa-solid fa-check" aria-hidden="true" />
                            <span>{takenLabel}</span>
                            <span className="visually-hidden"> for dose at {when}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onLog(entry, 'missed')}
                            disabled={busy}
                            aria-describedby={errorId}
                            className="btn-action-missed"
                          >
                            <i className="fa-solid fa-xmark" aria-hidden="true" />
                            <span>{missedLabel}</span>
                            <span className="visually-hidden"> for dose at {when}</span>
                          </button>
                        </div>
                        {rowError && (
                          <p id={errorId} role="alert" className="field-error row-error">
                            <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
                            {rowError}
                          </p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </section>
  );
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
}
