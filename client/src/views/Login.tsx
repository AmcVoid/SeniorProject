import React, { useRef, useState } from 'react';
import { useApi } from '../api/ApiContext.tsx';
import { PageHeading } from '../a11y/RouteAnnouncer.tsx';
import { useFieldErrors, FieldError } from '../components/FieldError.tsx';

interface SampleLogin {
  label: string;
  identifier: string;
  password: string;
  icon: string;
  roleDescription: string;
  badge: string;
}

const SAMPLE_LOGINS: SampleLogin[] = [
  {
    label: 'Patient Portal',
    identifier: 'patient-1',
    password: 'patient-pass',
    icon: 'fa-user',
    roleDescription: 'Medication tracking & dose history',
    badge: 'Patient',
  },
  {
    label: 'Provider Portal',
    identifier: 'provider-1',
    password: 'provider-pass',
    icon: 'fa-user-doctor',
    roleDescription: 'Clinical dashboard & interaction alerts',
    badge: 'Provider',
  },
];

export default function Login() {
  const { login, sessionExpired, clearSessionExpired } = useApi();
  const errors = useFieldErrors('login');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const identifierRef = useRef<HTMLInputElement | null>(null);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    errors.clear();
    clearSessionExpired();
    setSubmitting(true);
    try {
      await login({ identifier, password });
    } catch (err) {
      errors.setFromError(err);
      if (identifierRef.current) identifierRef.current.focus();
    } finally {
      setSubmitting(false);
    }
  };

  const useSample = (sample: SampleLogin) => {
    errors.clear();
    clearSessionExpired();
    setIdentifier(sample.identifier);
    setPassword(sample.password);
    if (identifierRef.current) identifierRef.current.focus();
  };

  return (
    <div className="login-view">
      <div className="login-container">
        {/* Left Brand & Feature Column */}
        <aside className="login-banner-col" aria-label="MediSync overview">
          <div className="login-brand">
            <span className="login-logo-mark" aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                <rect x="9.5" y="1" width="5" height="22" rx="2.5" fill="#38efbe" />
                <rect x="1" y="9.5" width="22" height="5" rx="2.5" fill="#38efbe" />
                <circle cx="12" cy="12" r="3" fill="#14b8a6" />
              </svg>
            </span>
            <div className="brand-title-group">
              <span className="brand-name">MediSync</span>
              <span className="brand-tagline">Medication Management System</span>
            </div>
          </div>

          <div className="login-illustration-wrapper">
            <div className="login-illustration-disc">
              <img
                src="/images/login-illustration.svg"
                alt=""
                className="login-illustration"
                aria-hidden="true"
              />
            </div>
            <p className="banner-reassurance-text">
              Intelligent Medication Care
              <br />
              <small>Real-time safety checks & adherence tracking</small>
            </p>
          </div>

          <div className="login-features">
            <div className="feature-item">
              <i className="fa-solid fa-shield-halved" aria-hidden="true" />
              <span>HIPAA-compliant secure PHI access</span>
            </div>
            <div className="feature-item">
              <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
              <span>Real-time drug interaction alerts</span>
            </div>
            <div className="feature-item">
              <i className="fa-solid fa-chart-line" aria-hidden="true" />
              <span>Automated adherence analytics</span>
            </div>
          </div>
        </aside>

        {/* Right Form Column */}
        <main className="login-form-col">
          <div className="login-secure-badge">
            <i className="fa-solid fa-lock" aria-hidden="true" />
            <span>Secure Patient &amp; Provider Portal</span>
          </div>

          <PageHeading title="Sign in">
            <h1 className="form-header-title">Welcome back</h1>
          </PageHeading>
          <p id="login-help" className="form-subtitle">
            Sign in to access your medications, dose history, and health reports.
          </p>

          <form onSubmit={onSubmit} noValidate aria-describedby="login-help" className="login-form">
            {sessionExpired && (
              <div role="alert" className="form-error alert-banner session-expired-banner">
                <div className="alert-header">
                  <i className="fa-solid fa-clock-rotate-left alert-icon" aria-hidden="true" />
                  <p className="alert-text">Your session has expired. Please sign in again.</p>
                </div>
              </div>
            )}

            {errors.generalError && (
              <div role="alert" className="form-error alert-banner">
                <div className="alert-header">
                  <i className="fa-solid fa-circle-exclamation alert-icon" aria-hidden="true" />
                  <p className="alert-text">{errors.generalError.message}</p>
                </div>
              </div>
            )}

            <div className="form-group">
              <label htmlFor="login-identifier">
                <span>Username or Patient ID</span>
              </label>
              <div className="input-icon-wrapper">
                <i className="fa-solid fa-user input-field-icon" aria-hidden="true" />
                <input
                  id="login-identifier"
                  name="identifier"
                  type="text"
                  autoComplete="username"
                  ref={identifierRef}
                  placeholder="e.g. patient-1"
                  value={identifier}
                  onChange={(e) => {
                    setIdentifier(e.target.value);
                    errors.clearField('identifier');
                    if (sessionExpired) clearSessionExpired();
                  }}
                  {...errors.fieldProps('identifier')}
                />
              </div>
              <FieldError id={errors.errorId('identifier')} message={errors.errorFor('identifier')} />
            </div>

            <div className="form-group">
              <label htmlFor="login-password">
                <span>Password</span>
              </label>
              <div className="input-icon-wrapper password-wrapper">
                <i className="fa-solid fa-lock input-field-icon" aria-hidden="true" />
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    errors.clearField('password');
                    if (sessionExpired) clearSessionExpired();
                  }}
                  {...errors.fieldProps('password')}
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={0}
                >
                  <i className={`fa-solid ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`} aria-hidden="true" />
                </button>
              </div>
              <FieldError id={errors.errorId('password')} message={errors.errorFor('password')} />
            </div>

            <button type="submit" disabled={submitting} className="login-submit-btn">
              {submitting ? (
                <>
                  <i className="fa-solid fa-circle-notch fa-spin" aria-hidden="true" />
                  <span>Signing in…</span>
                </>
              ) : (
                <>
                  <i className="fa-solid fa-arrow-right-to-bracket" aria-hidden="true" />
                  <span>Sign in</span>
                </>
              )}
            </button>
          </form>

          <section aria-labelledby="sample-logins-heading" className="sample-logins-section">
            <div className="sample-logins-header">
              <h2 id="sample-logins-heading" className="sample-logins-title">
                <i className="fa-solid fa-bolt" aria-hidden="true" />
                <span>Quick Demo Accounts</span>
              </h2>
              <span className="sample-hint">Click to auto-fill:</span>
            </div>

            <div className="sample-cards-list">
              {SAMPLE_LOGINS.map((s) => {
                const isSelected = identifier === s.identifier;
                return (
                  <button
                    key={s.identifier}
                    type="button"
                    onClick={() => useSample(s)}
                    className={`sample-account-row ${isSelected ? 'selected' : ''}`}
                    aria-label={`Fill ${s.label} credentials: username ${s.identifier}, password ${s.password}`}
                  >
                    <div className={`sample-row-icon ${s.badge.toLowerCase()}`}>
                      <i className={`fa-solid ${s.icon}`} aria-hidden="true" />
                    </div>

                    <div className="sample-row-body">
                      <div className="sample-row-top">
                        <span className="sample-row-title">{s.label}</span>
                        <span className="sample-row-desc">{s.roleDescription}</span>
                      </div>
                      <div className="sample-row-creds">
                        <span className="cred-chip">
                          <span className="cred-label">User:</span>
                          <code>{s.identifier}</code>
                        </span>
                        <span className="cred-separator" aria-hidden="true">•</span>
                        <span className="cred-chip">
                          <span className="cred-label">Pass:</span>
                          <code>{s.password}</code>
                        </span>
                      </div>
                    </div>

                    <div className="sample-row-action">
                      <span className="sample-action-pill">
                        {isSelected ? 'Filled ✓' : 'Auto-fill →'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

