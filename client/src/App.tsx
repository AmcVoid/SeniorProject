import React from 'react';
import { NavLink, Route, Routes, Link } from 'react-router-dom';
import { useApi } from './api/ApiContext.tsx';
import Home from './views/Home.tsx';
import Login from './views/Login.tsx';
import MedicationList from './views/MedicationList.tsx';
import MemoryNotes from './views/MemoryNotes.tsx';
import DoseHistory from './views/DoseHistory.tsx';
import AdherenceReport from './views/AdherenceReport.tsx';
import CaregiverManagement from './views/CaregiverManagement.tsx';
import ProviderDashboard from './views/ProviderDashboard.tsx';

const navigation = [
  ['/', 'fa-house', 'Home'], ['/medications', 'fa-pills', 'Medications'],
  ['/doses', 'fa-clock-rotate-left', 'Dose history'], ['/adherence', 'fa-chart-line', 'Adherence'],
  ['/caregivers', 'fa-user-nurse', 'Caregivers'], ['/provider', 'fa-user-doctor', 'Provider'],
] as const;

export default function App() {
  const { isAuthenticated } = useApi();
  if (!isAuthenticated) return <Login />;
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <aside className="app-sidebar" aria-label="Primary navigation">
      <Link to="/" className="sidebar-brand" aria-label="MediSync home">
        <span className="sidebar-brand-mark" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <rect x="9.5" y="1" width="5" height="22" rx="2.5" fill="#38efbe" />
            <rect x="1" y="9.5" width="22" height="5" rx="2.5" fill="#38efbe" />
            <circle cx="12" cy="12" r="3" fill="#14b8a6" />
          </svg>
        </span>
        <span>
          <strong>MediSync</strong>
          <small>Medication Management<br />for a Brighter Tomorrow</small>
        </span>
      </Link>
      <nav>
        <ul className="sidebar-nav">
          {navigation.map(([to, icon, label]) => (
            <li key={to}>
              <NavLink to={to} end={to === '/'} className="sidebar-nav-item">
                <i className={`fa-solid ${icon}`} aria-hidden="true" />
                <span>{label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <SidebarAccount />
    </aside>
    <div className="app-stage">
      <header className="app-topbar">
        <div className="topbar-date">
          <i className="fa-regular fa-calendar" aria-hidden="true" /> <TodayDate />
        </div>
        <SessionControl />
      </header>
      <main id="main-content" className="app-content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/medications" element={<MedicationList />} />
          <Route path="/medications/:medicationId/notes" element={<MemoryNotes />} />
          <Route path="/doses" element={<DoseHistory />} />
          <Route path="/adherence" element={<AdherenceReport />} />
          <Route path="/caregivers" element={<CaregiverManagement />} />
          <Route path="/provider" element={<ProviderDashboard />} />
          <Route path="/provider/patients/:patientId" element={<ProviderDashboard />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  </div>;
}

function SidebarAccount() {
  const { identity, logout } = useApi();
  const name = identity?.userId ?? 'patient-1';
  const role = identity?.role ?? 'Patient';
  const initial = name.toLowerCase().includes('patient') ? 'P1' : (name.slice(0, 2).toUpperCase() || 'P1');

  return (
    <button
      type="button"
      className="sidebar-account"
      onClick={logout}
      title="Click to sign out"
      aria-label={`Signed in as ${name}. Click to sign out.`}
    >
      <span className="account-initial">{initial}</span>
      <span className="sidebar-account-meta">
        <strong>{name}</strong>
        <small>{role}</small>
      </span>
      <i className="fa-solid fa-chevron-right" aria-hidden="true" />
    </button>
  );
}

function SessionControl() {
  const { identity, logout } = useApi();
  const name = identity?.userId ?? 'patient-1';
  const role = identity?.role ?? 'Patient';
  const initial = name.toLowerCase().includes('patient') ? 'P1' : (name.slice(0, 2).toUpperCase() || 'P1');
  const [menuOpen, setMenuOpen] = React.useState(false);

  return (
    <div className="session-control">
      {/* In-app notifications are not wired to the API yet, so the bell shows
          no unread count rather than a made-up one. */}
      <button
        type="button"
        className="topbar-bell-btn"
        title="Notifications are not available yet"
        aria-label="Notifications (not available yet)"
        disabled
      >
        <i className="fa-solid fa-bell notification-icon" aria-hidden="true" />
      </button>

      <span className="topbar-divider" aria-hidden="true" />

      <div className="session-menu-wrapper">
        <button
          type="button"
          className="session-user-badge"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-expanded={menuOpen}
          aria-haspopup="true"
          title={`Signed in as ${name} (${role}) - Click to sign out`}
        >
          <span className="session-initial">{initial}</span>
          <span className="session-meta">
            <strong>{name}</strong>
            <small>{role}</small>
          </span>
          <i className="fa-solid fa-chevron-down session-dropdown-arrow" aria-hidden="true" />
        </button>

        {menuOpen && (
          <div className="session-dropdown-menu" role="menu">
            <button
              type="button"
              className="dropdown-menu-item"
              onClick={() => {
                setMenuOpen(false);
                logout();
              }}
              role="menuitem"
            >
              <i className="fa-solid fa-arrow-right-from-bracket" aria-hidden="true" />
              <span>Sign out</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Today's date in the viewer's locale; re-renders after midnight. */
function TodayDate() {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const next = new Date(now);
    next.setHours(24, 0, 5, 0);
    const timer = window.setTimeout(() => setNow(new Date()), next.getTime() - now.getTime());
    return () => window.clearTimeout(timer);
  }, [now]);
  return (
    <time dateTime={now.toISOString().slice(0, 10)}>
      {now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
    </time>
  );
}

function NotFound() {
  return <section className="not-found-view"><div className="not-found-content"><i className="fa-solid fa-compass not-found-icon" aria-hidden="true" /><h1 tabIndex={-1}>Page not found</h1><p>The page you requested does not exist or has been moved.</p><Link to="/" className="btn-primary">Return home</Link></div></section>;
}
