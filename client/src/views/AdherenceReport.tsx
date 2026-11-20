import React, { useState } from 'react';
import { PageHeading } from '../a11y/RouteAnnouncer.tsx';
import AdherenceWidget, { AdherenceSummary } from '../components/AdherenceWidget.tsx';
import type { DateRange } from '../types.ts';

export default function AdherenceReport() {
  const [draft, setDraft] = useState<DateRange>({ from: '', to: '' });
  const [period, setPeriod] = useState<DateRange>({ from: '', to: '' });

  return (
    <section className="adherence-report-view">
      <div className="view-header-banner">
        <div className="view-title-group">
          <PageHeading title="Adherence Report" />
          <p className="view-subtitle">
            Monitor your overall medication adherence rate and dose compliance metrics.
          </p>
          <div className="badge-count-pill">
            <i className="fa-solid fa-chart-line" aria-hidden="true" />
            <span>Compliance Analytics &amp; Trends</span>
          </div>
        </div>
        <div className="view-banner-graphic">
          <img
            src="/images/adherence-banner.png"
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
            setPeriod(draft);
          }}
          aria-label="Choose adherence reporting period"
          className="filter-form"
        >
          <div className="filter-field">
            <label htmlFor="adherence-from">
              <i className="fa-solid fa-calendar-day" aria-hidden="true" />
              From Date
            </label>
            <input
              id="adherence-from"
              type="date"
              value={draft.from}
              onChange={(e) => setDraft((r) => ({ ...r, from: e.target.value }))}
            />
          </div>
          <div className="filter-field">
            <label htmlFor="adherence-to">
              <i className="fa-solid fa-calendar-day" aria-hidden="true" />
              To Date
            </label>
            <input
              id="adherence-to"
              type="date"
              value={draft.to}
              onChange={(e) => setDraft((r) => ({ ...r, to: e.target.value }))}
            />
          </div>
          <div className="filter-actions">
            <button type="submit" className="btn-filter">
              <i className="fa-solid fa-arrows-rotate" aria-hidden="true" />
              Update report
            </button>
            {(period.from || period.to) && (
              <button
                type="button"
                className="btn-clear"
                onClick={() => {
                  setDraft({ from: '', to: '' });
                  setPeriod({ from: '', to: '' });
                }}
              >
                Reset range
              </button>
            )}
          </div>
        </form>
      </div>

      <AdherenceWidget period={period} title="Adherence report" />
    </section>
  );
}

export { AdherenceSummary };
