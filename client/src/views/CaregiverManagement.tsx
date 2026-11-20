import React, { useState } from 'react';
import { useApi } from '../api/ApiContext.tsx';
import { useAsync } from '../hooks/useAsync.ts';
import { PageHeading } from '../a11y/RouteAnnouncer.tsx';
import { Loading, ErrorMessage, Empty } from '../components/AsyncState.tsx';
import { FieldError, useFieldErrors } from '../components/FieldError.tsx';
import type { Caregiver } from '../types.ts';

export default function CaregiverManagement() {
  const { client } = useApi();
  const { data, error, loading, reload } = useAsync(() => client.listCaregivers(), []);
  const [form, setForm] = useState({ name: '', deliveryAddress: '' });
  const [status, setStatus] = useState('');
  const errors = useFieldErrors('caregiver');

  const caregivers: Caregiver[] = data?.caregivers ?? [];

  const onAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    errors.clear();
    try {
      await client.createCaregiver({
        name: form.name,
        deliveryAddresses: form.deliveryAddress ? [form.deliveryAddress] : [],
      });
      setStatus(`Added caregiver ${form.name}.`);
      setForm({ name: '', deliveryAddress: '' });
      reload();
    } catch (err: unknown) {
      errors.setFromError(err);
    }
  };

  const onRemove = async (id: string, name: string) => {
    if (!window.confirm(`Remove ${name} from your caregivers? They will stop receiving alerts.`)) return;
    try {
      await client.deleteCaregiver(id);
      setStatus(`Removed caregiver ${name}.`);
      reload();
    } catch (err: unknown) {
      setStatus(`Could not remove caregiver: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const addressError = errors.errorFor('deliveryAddresses') ?? errors.errorFor('deliveryAddress');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', addresses: '' });
  const editErrors = useFieldErrors('caregiver-edit');
  const editAddressError = editErrors.errorFor('deliveryAddresses') ?? editErrors.errorFor('deliveryAddress');

  const startEdit = (c: Caregiver) => {
    editErrors.clear();
    setEditingId(c.id);
    setEditForm({ name: c.name, addresses: (c.deliveryAddresses ?? []).join(', ') });
    setStatus('');
  };

  const onSaveEdit = async (e: React.FormEvent, c: Caregiver) => {
    e.preventDefault();
    editErrors.clear();
    try {
      await client.updateCaregiver(c.id, {
        name: editForm.name,
        deliveryAddresses: editForm.addresses.split(/[,;\n]/).map((a) => a.trim()).filter(Boolean),
      });
      setEditingId(null);
      setStatus(`Saved changes to ${editForm.name.trim()}.`);
      reload();
    } catch (err: unknown) {
      editErrors.setFromError(err);
    }
  };

  return (
    <section className="caregiver-view">
      <div className="view-header-banner">
        <div className="view-title-group">
          <PageHeading title="Caregivers" />
          <p className="view-subtitle">
            Designate trusted family members, nurses, or caregivers to receive notifications and monitor care.
          </p>
          <div className="badge-count-pill">
            <i className="fa-solid fa-user-nurse" aria-hidden="true" />
            <span>{caregivers.length} active {caregivers.length === 1 ? 'caregiver' : 'caregivers'}</span>
          </div>
        </div>
        <div className="view-banner-graphic">
          <img
            src="/images/caregivers-banner.png"
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

      <div className="add-caregiver-card">
        <div className="card-header-with-icon">
          <i className="fa-solid fa-user-plus header-icon" aria-hidden="true" />
          <h2>Add a New Caregiver</h2>
        </div>

        <form onSubmit={onAdd} noValidate className="caregiver-form">
          {errors.generalError && <ErrorMessage error={errors.generalError} />}

          <div className="form-group">
            <label htmlFor="caregiver-name">
              <i className="fa-solid fa-user input-label-icon" aria-hidden="true" />
              Full Name
            </label>
            <input
              id="caregiver-name"
              type="text"
              placeholder="e.g. Sarah Connor"
              value={form.name}
              onChange={(e) => {
                errors.clearField('name');
                setForm((f) => ({ ...f, name: e.target.value }));
              }}
              {...errors.fieldProps('name')}
            />
            <FieldError id={errors.errorId('name')} message={errors.errorFor('name')} />
          </div>

          <div className="form-group">
            <label htmlFor="caregiver-address">
              <i className="fa-solid fa-envelope input-label-icon" aria-hidden="true" />
              Delivery Address (Email or Phone number)
            </label>
            <input
              id="caregiver-address"
              type="text"
              placeholder="e.g. sarah@example.com or +15551234567"
              value={form.deliveryAddress}
              onChange={(e) => {
                errors.clearField('deliveryAddresses');
                errors.clearField('deliveryAddress');
                setForm((f) => ({ ...f, deliveryAddress: e.target.value }));
              }}
              aria-invalid={addressError ? 'true' : undefined}
              aria-describedby={addressError ? 'caregiver-deliveryAddresses-error' : undefined}
            />
            <FieldError id="caregiver-deliveryAddresses-error" message={addressError} />
          </div>

          <button type="submit" className="btn-primary">
            <i className="fa-solid fa-plus" aria-hidden="true" />
            <span>Add caregiver</span>
          </button>
        </form>
      </div>

      <div className="caregiver-list-section">
        <h2>
          <i className="fa-solid fa-users header-icon" aria-hidden="true" />
          Active Caregivers ({caregivers.length})
        </h2>

        {loading && <Loading label="Loading caregivers…" />}
        {error && <ErrorMessage error={error} />}

        {!loading && !error && (
          caregivers.length === 0 ? (
            <Empty>No caregivers have been registered yet.</Empty>
          ) : (
            <div className="caregiver-cards-grid">
              {caregivers.map((c) => {
                const addresses = c.deliveryAddresses ?? [];
                if (editingId === c.id) {
                  return (
                    <form key={c.id} className="caregiver-card caregiver-edit-card" noValidate
                      onSubmit={(e) => onSaveEdit(e, c)} aria-label={`Edit caregiver ${c.name}`}>
                      {editErrors.generalError && <ErrorMessage error={editErrors.generalError} />}
                      <div className="form-group">
                        <label htmlFor={`cg-edit-name-${c.id}`}>Full Name</label>
                        <input id={`cg-edit-name-${c.id}`} type="text" value={editForm.name} autoFocus
                          onChange={(e) => { editErrors.clearField('name'); setEditForm((f) => ({ ...f, name: e.target.value })); }}
                          {...editErrors.fieldProps('name')} />
                        <FieldError id={editErrors.errorId('name')} message={editErrors.errorFor('name')} />
                      </div>
                      <div className="form-group">
                        <label htmlFor={`cg-edit-addr-${c.id}`}>Delivery Addresses</label>
                        <input id={`cg-edit-addr-${c.id}`} type="text" value={editForm.addresses}
                          onChange={(e) => {
                            editErrors.clearField('deliveryAddress');
                            editErrors.clearField('deliveryAddresses');
                            setEditForm((f) => ({ ...f, addresses: e.target.value }));
                          }}
                          aria-invalid={editAddressError ? 'true' : undefined}
                          aria-describedby={`cg-edit-addr-hint-${c.id}${editAddressError ? ' caregiver-edit-deliveryAddresses-error' : ''}`} />
                        <small id={`cg-edit-addr-hint-${c.id}`} className="field-hint">Separate several addresses with commas.</small>
                        <FieldError id="caregiver-edit-deliveryAddresses-error" message={editAddressError} />
                      </div>
                      <div className="form-actions">
                        <button type="submit" className="btn-primary">
                          <i className="fa-solid fa-check" aria-hidden="true" />
                          <span>Save</span>
                        </button>
                        <button type="button" className="btn-clear" onClick={() => setEditingId(null)}>Cancel</button>
                      </div>
                    </form>
                  );
                }
                return (
                  <div key={c.id} className="caregiver-card">
                    <div className="caregiver-avatar">
                      <i className="fa-solid fa-user-nurse" aria-hidden="true" />
                    </div>
                    <div className="caregiver-info">
                      <span className="caregiver-name">{c.name}</span>
                      <div className="caregiver-addresses">
                        {addresses.length === 0 ? (
                          <span className="address-muted">No delivery address specified</span>
                        ) : (
                          addresses.map((addr) => {
                            const isEmail = addr.includes('@');
                            return (
                              <span key={addr} className="address-pill">
                                <i
                                  className={`fa-solid ${isEmail ? 'fa-envelope' : 'fa-phone'}`}
                                  aria-hidden="true"
                                />
                                {addr}
                              </span>
                            );
                          })
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => startEdit(c)}
                      className="btn-danger-icon btn-edit-icon"
                      title={`Edit caregiver ${c.name}`}
                      aria-label={`Edit caregiver ${c.name}`}
                    >
                      <i className="fa-solid fa-pen" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemove(c.id, c.name)}
                      className="btn-danger-icon"
                      title={`Remove caregiver ${c.name}`}
                      aria-label={`Remove caregiver ${c.name}`}
                    >
                      <i className="fa-solid fa-trash-can" aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>
    </section>
  );
}
