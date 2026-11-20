import React from 'react';

export interface LoadingProps {
  label?: string;
}

export function Loading({ label = 'Loading…' }: LoadingProps) {
  return (
    <div role="status" className="state-loading">
      <i className="fa-solid fa-circle-notch fa-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export interface ErrorMessageProps {
  error: (Error & { fields?: Record<string, string | string[]> | null }) | null;
}

export function ErrorMessage({ error }: ErrorMessageProps) {
  if (!error) return null;
  const fields = error.fields && typeof error.fields === 'object' ? error.fields : null;
  return (
    <div role="alert" className="form-error alert-banner">
      <div className="alert-header">
        <i className="fa-solid fa-circle-exclamation alert-icon" aria-hidden="true" />
        <p className="alert-text">{error.message}</p>
      </div>
      {fields && Object.keys(fields).length > 0 && (
        <ul className="alert-list">
          {Object.entries(fields).map(([field, msg]) => (
            <li key={field}>
              <strong>{field}:</strong> {Array.isArray(msg) ? msg.join(', ') : String(msg)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface EmptyProps {
  children: React.ReactNode;
}

export function Empty({ children }: EmptyProps) {
  return (
    <div className="empty-state">
      <img
        src="/images/empty-clipboard.svg"
        alt=""
        className="empty-state-img"
        aria-hidden="true"
      />
      <p className="empty-state-text">{children}</p>
    </div>
  );
}
