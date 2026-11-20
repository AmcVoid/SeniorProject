import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApi } from '../api/ApiContext.tsx';
import { useAsync } from '../hooks/useAsync.ts';
import { PageHeading } from '../a11y/RouteAnnouncer.tsx';
import type { Medication, InteractionWarning, AdherenceReport, Caregiver } from '../types.ts';

export default function Home() {
  const { identity, client } = useApi();
  const navigate = useNavigate();
  const isProvider = identity?.role === 'provider';
  const userName = identity?.userId ?? 'patient-1';
  // Capitalize name for display, e.g. "Patient-1"
  const displayName = userName.charAt(0).toUpperCase() + userName.slice(1);

  const { data: medData, loading: loadingMeds } = useAsync(
    () => (!isProvider ? client.listMedications() : Promise.resolve(null)),
    [isProvider],
  );
  const { data: adherenceData } = useAsync(
    () => (!isProvider ? client.getAdherence() : Promise.resolve(null)),
    [isProvider],
  );
  const { data: caregiverData } = useAsync(
    () => (!isProvider ? client.listCaregivers() : Promise.resolve(null)),
    [isProvider],
  );

  const medications: Medication[] = medData?.medications ?? [];
  const warnings: InteractionWarning[] = medData?.interactionWarnings ?? [];
  const caregivers: Caregiver[] = caregiverData?.caregivers ?? [];
  const report: AdherenceReport | null = adherenceData ?? null;
  // The API reports `scheduledCount`/`adherenceRate`; older shapes used
  // `scheduledDoses`/`rate`. With nothing scheduled there is no rate to show.
  const scheduled = Number(report?.scheduledCount ?? report?.scheduledDoses ?? 0);
  const hasAdherence = scheduled > 0 && !report?.noDosesScheduled;
  const adherenceRate = hasAdherence
    ? Math.round(Number(report?.adherenceRate ?? report?.rate ?? 0) * 100)
    : 0;
  const medCount = medications.length;
  const caregiverCount = caregivers.length;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  if (isProvider) return <ProviderWelcome onOpen={() => navigate('/provider')} />;

  return (
    <section className="home-view redesign-home">
      {/* Top-Right Decorative Cursive Banner: Better Days Ahead */}
      <div className="better-days-banner" aria-hidden="true">
        <span>Better Days Ahead</span>
        <svg width="84" height="14" viewBox="0 0 84 14" fill="none">
          <path d="M3 8C24 3 60 4 81 10" stroke="#fa9b4d" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.8" />
          <path d="M14 11C30 7 56 8 72 12" stroke="#fa9b4d" strokeWidth="1.3" strokeLinecap="round" strokeOpacity="0.55" />
        </svg>
      </div>

      {/* Greeting Header */}
      <div className="home-intro">
        <span className="eyebrow">{greeting} <i aria-hidden="true" /></span>
        <PageHeading title="Medication Management System">
          A little routine. <em>A healthier you.</em>
        </PageHeading>
        <p>Welcome back, {displayName}. Let&apos;s take care of today.</p>
      </div>

      {/* Hero Banner + Adherence Card */}
      <div className="dashboard-hero-row">
        <section className="sync-hero" aria-label="Medication overview">
          <div className="sync-hero-content">
            <h2>Your health, <span>in sync.</span></h2>
            <p>Your daily medication overview,<br />all in one place.</p>
            <Link to="/medications" className="hero-action">
              View medications <i className="fa-solid fa-arrow-right" aria-hidden="true" />
            </Link>
          </div>

          <div className="hero-art" aria-hidden="true">
            <img
              src="/images/sync-capsule-orbit.png"
              alt=""
              className="sync-capsule-img"
            />
            <div className="hero-routine-quote">
              <span>SIMPLE</span>
              <span>ROUTINES</span>
              <span>BRIGHTER</span>
              <span>TOMORROWS</span>
              <span className="quote-accent-bar" />
            </div>
          </div>
        </section>

        <section className="adherence-spotlight" aria-label="Adherence rate">
          <h2>
            <span className="spotlight-icon"><i className="fa-solid fa-chart-simple" aria-hidden="true" /></span>
            Adherence rate
          </h2>
          <div className="spotlight-body">
            <div className="donut" style={{ '--rate': `${adherenceRate}%` } as React.CSSProperties}>
              <strong>{hasAdherence ? `${adherenceRate}%` : '—'}</strong>
            </div>
            <div className="adherence-copy">
              <strong>{!hasAdherence ? 'No doses recorded yet.' : adherenceRate >= 80 ? 'Great consistency.' : 'You\u2019re on your way.'}</strong>
              <p>{hasAdherence ? 'Keep building your routine for better health outcomes.' : 'Your rate appears once you have scheduled doses.'}</p>
              <Link to="/doses" className="view-doses-link">
                View dose history <i className="fa-solid fa-arrow-right" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>
      </div>

      {/* 3 Metric Cards Row (Fixes Img3!) */}
      <div className="overview-row">
        <MetricCard
          icon="fa-pills"
          tone="mint"
          count={loadingMeds ? '…' : String(medCount)}
          title={medCount === 1 ? 'Active medication' : 'Active medications'}
          caption={loadingMeds ? 'Loading prescriptions' : `${plural(medCount, 'active prescription')}`}
          to="/medications"
        />
        <MetricCard
          icon="fa-shield-halved"
          tone="sage"
          title={warnings.length ? `${warnings.length} alert${warnings.length === 1 ? '' : 's'}` : 'No interactions detected'}
          caption={warnings.length ? 'Review clinical warnings' : 'Based on current records'}
          to="/medications"
        />
        <MetricCard
          icon="fa-users"
          tone="lavender"
          count={String(caregiverCount)}
          title={caregiverCount === 1 ? 'Caregiver connected' : 'Caregivers connected'}
          caption={caregiverCount === 0 ? 'Add someone to your care circle' : `${plural(caregiverCount, 'contact')} connected`}
          to="/caregivers"
        />
      </div>

      {/* Your Daily Essentials Section */}
      <SectionHeader title="Your daily essentials" note="Everyday care, made easier" />
      <div className="essentials-grid">
        <section className="essentials-card">
          <div className="essentials-content">
            <div className="card-title">
              <span className="spotlight-icon mint"><i className="fa-solid fa-pills" aria-hidden="true" /></span>
              <div>
                <h2>{loadingMeds ? 'Loading prescriptions' : plural(medCount, 'active prescription')}</h2>
                <p>Manage, track, and stay on top of your medications.</p>
              </div>
            </div>
            <ActionLink
              to="/medications"
              icon="fa-list-check"
              title="Manage your medications"
              text="Review your prescription list"
            />
            <ActionLink
              to="/doses"
              icon="fa-calendar-check"
              title="Track your doses"
              text="See your medication history"
            />
          </div>

          <div className="essentials-art" aria-hidden="true">
            <img src="/images/consistent-care.png" alt="" className="daily-capsule-img" />
          </div>
        </section>

        {/* Your Care Circle (Matches img1) */}
        <section className="care-circle">
          <div className="care-circle-left">
            <div>
              <div className="care-circle-header">
                <span className="spotlight-icon mint"><i className="fa-solid fa-users" aria-hidden="true" /></span>
                <div>
                  <h2>Your care circle</h2>
                  <p className="care-count"><strong>{caregiverCount}</strong> connected {caregiverCount === 1 ? 'caregiver' : 'caregivers'}</p>
                </div>
              </div>
              <p className="care-sub">Share care, stay supported.</p>

              <div className="avatar-pair">
                {caregivers.slice(0, 3).map((c) => (
                  <span key={c.id} className="avatar-initials" title={c.name}>{initials(c.name)}</span>
                ))}
                <span className="avatar-add"><i className="fa-solid fa-plus" aria-hidden="true" /></span>
              </div>
            </div>

            <Link to="/caregivers" className="care-action">
              <span>Manage caregivers</span>
              <i className="fa-solid fa-arrow-right" aria-hidden="true" />
            </Link>
          </div>

          <div className="care-circle-right" aria-hidden="true">
            <img
              className="care-circle-heart"
              src="/images/care-circle-heart.png"
              alt=""
            />
          </div>
        </section>
      </div>

      {/* Small Habits, Better Days Section */}
      <SectionHeader title="Small habits, better days" note="Wellness tips for everyday life" />
      <div className="wellness-row">
        <Wellness
          icon="fa-droplet"
          tone="icon-blue"
          title="Hydration"
          text="Take your medications with a full glass of water unless advised otherwise."
        />
        <Wellness
          icon="fa-sun"
          tone="icon-amber"
          title="Daily consistency"
          text="Try to take your medications at the same time each day."
        />
        <Wellness
          icon="fa-note-sticky"
          tone="icon-purple"
          title="Memory notes"
          text="Keep helpful reminders close."
        />
      </div>

    </section>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

function MetricCard({
  icon,
  tone,
  count,
  title,
  caption,
  to,
}: {
  icon: string;
  tone: 'mint' | 'sage' | 'lavender';
  count?: string | number;
  title: string;
  caption: string;
  to?: string;
}) {
  const content = (
    <>
      <span className={`metric-icon ${tone}`}>
        <i className={`fa-solid ${icon}`} aria-hidden="true" />
      </span>
      <div className="metric-details">
        <div className="metric-heading">
          {count !== undefined && <strong className="metric-num">{count}</strong>}
          <span className={`metric-title ${count === undefined ? 'is-headline' : ''}`}>
            {title}
          </span>
        </div>
        <small className="metric-caption">{caption}</small>
      </div>
      <span className="metric-arrow" aria-hidden="true">
        <i className="fa-solid fa-chevron-right" />
      </span>
    </>
  );

  if (to) {
    return (
      <Link to={to} className="overview-card">
        {content}
      </Link>
    );
  }
  return <section className="overview-card">{content}</section>;
}

function SectionHeader({ title, note }: { title: string; note: string }) {
  return (
    <div className="redesign-section-header">
      <h2>{title}</h2>
      <span>{note}</span>
    </div>
  );
}

function ActionLink({ to, icon, title, text }: { to: string; icon: string; title: string; text: string }) {
  return (
    <Link to={to} className="essential-action">
      <span className="action-icon"><i className={`fa-solid ${icon}`} aria-hidden="true" /></span>
      <span>
        <strong>{title}</strong>
        <small>{text}</small>
      </span>
      <i className="fa-solid fa-chevron-right" aria-hidden="true" />
    </Link>
  );
}

function Wellness({ icon, tone, title, text }: { icon: string; tone: string; title: string; text: string }) {
  return (
    <section className="wellness-card">
      <span className={tone}><i className={`fa-solid ${icon}`} aria-hidden="true" /></span>
      <div>
        <h3>{title}</h3>
        <p>{text}</p>
      </div>
    </section>
  );
}

function ProviderWelcome({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="provider-welcome">
      <span className="eyebrow">Provider workspace</span>
      <h1>Care insights, <em>in one place.</em></h1>
      <p>Review patient medication records, interaction alerts, and adherence trends.</p>
      <button className="hero-action" onClick={onOpen}>
        Open patient dashboard <i className="fa-solid fa-arrow-right" aria-hidden="true" />
      </button>
    </section>
  );
}
