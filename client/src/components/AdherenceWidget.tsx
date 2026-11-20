import React from 'react';
import { useApi } from '../api/ApiContext.tsx';
import { useAsync } from '../hooks/useAsync.ts';
import { Loading, ErrorMessage, Empty } from './AsyncState.tsx';

export interface AdherenceWidgetProps {
  period?: { from?: string; to?: string };
  patientId?: string;
  refreshKey?: number;
  headingLevel?: 2 | 3;
  title?: string;
}

export default function AdherenceWidget({
  period = {},
  patientId,
  refreshKey = 0,
  headingLevel = 2,
  title = 'Adherence summary',
}: AdherenceWidgetProps) {
  const { client } = useApi();

  const params: { from?: string; to?: string; patientId?: string } = { ...period };
  if (patientId != null) params.patientId = patientId;

  const { data, error, loading } = useAsync(
    () => client.getAdherence(params),
    [period.from, period.to, patientId, refreshKey],
  );

  const Heading = `h${headingLevel}` as 'h2' | 'h3';

  return (
    <section aria-label={title} className="adherence-section">
      <div aria-live="polite" aria-busy={loading ? 'true' : 'false'}>
        {loading && <Loading label="Updating adherence summary…" />}
        {error && <ErrorMessage error={error} />}
        {!loading && !error && data && (
          <AdherenceSummary report={data} Heading={Heading} />
        )}
      </div>
    </section>
  );
}

export interface AdherenceSummaryProps {
  report: {
    adherenceRate?: number;
    rate?: number;
    scheduledCount?: number;
    scheduledDoses?: number;
    takenCount?: number;
    takenDoses?: number;
    missedCount?: number;
    missedDoses?: number;
    noDosesScheduled?: boolean;
    [key: string]: unknown;
  } | null;
  headingLevel?: 2 | 3;
  Heading?: 'h2' | 'h3';
}

export function AdherenceSummary({ report, headingLevel = 2, Heading }: AdherenceSummaryProps) {
  const scheduledCount = report?.scheduledCount ?? report?.scheduledDoses ?? 0;
  const takenCount = report?.takenCount ?? report?.takenDoses ?? 0;
  const rawMissed = report?.missedCount ?? report?.missedDoses;

  if (!report || report.noDosesScheduled || scheduledCount === 0) {
    return <Empty>No doses were scheduled in this period.</Empty>;
  }

  const HeadingTag = Heading ?? (`h${headingLevel}` as 'h2' | 'h3');
  const rawRate = report.adherenceRate ?? report.rate ?? 0;
  const rate = Math.round(rawRate * 100);
  const missed = rawMissed ?? (scheduledCount - takenCount);

  // Rate tier for styling accent
  const rateClass = rate >= 80 ? 'rate-good' : rate >= 50 ? 'rate-warning' : 'rate-danger';

  return (
    <div className="adherence-card">
      <div className="adherence-header">
        <HeadingTag className="adherence-title">
          <i className="fa-solid fa-chart-pie adherence-icon" aria-hidden="true" />
          <span>Adherence rate: {rate}%</span>
        </HeadingTag>
        <span className={`adherence-badge ${rateClass}`}>
          {rate >= 80 ? 'Optimal' : rate >= 50 ? 'Needs Attention' : 'Low Compliance'}
        </span>
      </div>

      <div className="progress-track" aria-hidden="true">
        <div
          className={`progress-fill ${rateClass}`}
          style={{ width: `${Math.min(Math.max(rate, 0), 100)}%` }}
        />
      </div>

      <dl className="stat-grid">
        <div className="stat-card stat-scheduled">
          <dt>
            <i className="fa-solid fa-calendar-check" aria-hidden="true" /> Doses scheduled
          </dt>
          <dd>{scheduledCount}</dd>
        </div>
        <div className="stat-card stat-taken">
          <dt>
            <i className="fa-solid fa-circle-check" aria-hidden="true" /> Doses taken
          </dt>
          <dd>{takenCount}</dd>
        </div>
        <div className="stat-card stat-missed">
          <dt>
            <i className="fa-solid fa-circle-xmark" aria-hidden="true" /> Doses missed
          </dt>
          <dd>{missed}</dd>
        </div>
      </dl>
    </div>
  );
}
