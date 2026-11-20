import React, { useState } from 'react';
import { ErrorMessage } from './AsyncState.tsx';
import { FieldError, useFieldErrors } from './FieldError.tsx';
import type { Medication, Schedule } from '../types.ts';

export const WEEKDAYS = [
  ['sunday', 'Sun'], ['monday', 'Mon'], ['tuesday', 'Tue'], ['wednesday', 'Wed'],
  ['thursday', 'Thu'], ['friday', 'Fri'], ['saturday', 'Sat'],
] as const;

type Recurrence = 'daily' | 'weekdays' | 'interval';

export interface MedicationFormValues {
  name: string;
  dosage: string;
  schedule: Schedule;
  supply?: number;
}

interface Props {
  /** The medication being edited; omit to add a new one. */
  initial?: Medication;
  submitLabel: string;
  onSubmit: (values: MedicationFormValues) => Promise<void>;
  onCancel: () => void;
}

/**
 * Add/edit form for a medication. Field errors come from the API's
 * field-keyed 400 body (`name`, `dosage`, `schedule`), plus a few checks the
 * API cannot express (e.g. "pick at least one weekday").
 */
export default function MedicationForm({ initial, submitLabel, onSubmit, onCancel }: Props) {
  const isEdit = Boolean(initial);
  const formId = initial ? `med-edit-${initial.id}` : 'med-add';
  const errors = useFieldErrors(formId);
  const sched = initial?.schedule ?? null;

  const [name, setName] = useState(initial?.name ?? '');
  const [dosage, setDosage] = useState(initial?.dosage ?? '');
  const [times, setTimes] = useState<string[]>(
    Array.isArray(sched?.times) && sched!.times!.length ? [...sched!.times!] : ['08:00'],
  );
  const [recurrence, setRecurrence] = useState<Recurrence>(toRecurrence(sched));
  const [days, setDays] = useState<string[]>(
    Array.isArray(sched?.daysOfWeek) ? (sched!.daysOfWeek as string[]).map((d) => String(d).toLowerCase()) : [],
  );
  const [intervalDays, setIntervalDays] = useState(String(sched?.intervalDays ?? 2));
  const [supply, setSupply] = useState('30');
  const [submitting, setSubmitting] = useState(false);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});

  const errorFor = (field: string) => localErrors[field] ?? errors.errorFor(field);
  const describe = (field: string) =>
    errorFor(field) ? { 'aria-invalid': true as const, 'aria-describedby': `${formId}-${field}-error` } : {};

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    errors.clear();
    const local: Record<string, string> = {};
    const cleanTimes = Array.from(new Set(times.filter(Boolean))).sort();
    if (cleanTimes.length === 0) local.schedule = 'Add at least one time of day.';
    if (recurrence === 'weekdays' && days.length === 0) local.schedule = 'Pick at least one day of the week.';
    const n = Number(intervalDays);
    if (recurrence === 'interval' && !(Number.isInteger(n) && n >= 1)) local.schedule = 'Enter a whole number of days (1 or more).';
    const supplyNum = Number(supply);
    if (!isEdit && !(Number.isInteger(supplyNum) && supplyNum >= 0)) local.supply = 'Enter a whole number of units (0 or more).';
    setLocalErrors(local);
    if (Object.keys(local).length) return;

    const schedule: Schedule = {
      ...(sched ?? {}),
      times: cleanTimes,
      recurrence,
      daysOfWeek: recurrence === 'weekdays' ? days : undefined,
      intervalDays: recurrence === 'interval' ? n : undefined,
    };
    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        dosage: dosage.trim(),
        schedule,
        ...(isEdit ? {} : { supply: supplyNum }),
      });
    } catch (err) {
      errors.setFromError(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="medication-form" aria-label={isEdit ? `Edit ${initial!.name}` : 'Add a medication'}>
      {errors.generalError && <ErrorMessage error={errors.generalError} />}

      <div className="form-grid">
        <div className="form-group">
          <label htmlFor={`${formId}-name`}>Medication name</label>
          <input id={`${formId}-name`} type="text" value={name} placeholder="e.g. Lisinopril"
            onChange={(e) => { errors.clearField('name'); setName(e.target.value); }} {...describe('name')} />
          <FieldError id={`${formId}-name-error`} message={errorFor('name')} />
        </div>

        <div className="form-group">
          <label htmlFor={`${formId}-dosage`}>Dosage</label>
          <input id={`${formId}-dosage`} type="text" value={dosage} placeholder="e.g. 10 mg"
            onChange={(e) => { errors.clearField('dosage'); setDosage(e.target.value); }} {...describe('dosage')} />
          <FieldError id={`${formId}-dosage-error`} message={errorFor('dosage')} />
        </div>

        {!isEdit && (
          <div className="form-group">
            <label htmlFor={`${formId}-supply`}>Starting supply (units)</label>
            <input id={`${formId}-supply`} type="number" min={0} step={1} inputMode="numeric" value={supply}
              onChange={(e) => setSupply(e.target.value)} {...describe('supply')} />
            <FieldError id={`${formId}-supply-error`} message={errorFor('supply')} />
          </div>
        )}
      </div>

      <fieldset className="schedule-fieldset" aria-describedby={errorFor('schedule') ? `${formId}-schedule-error` : undefined}>
        <legend>Schedule</legend>

        <div className="form-group">
          <label htmlFor={`${formId}-recurrence`}>How often</label>
          <select id={`${formId}-recurrence`} value={recurrence}
            onChange={(e) => setRecurrence(e.target.value as Recurrence)}>
            <option value="daily">Every day</option>
            <option value="weekdays">On specific days of the week</option>
            <option value="interval">Every few days</option>
          </select>
        </div>

        {recurrence === 'weekdays' && (
          <div className="weekday-picker" role="group" aria-label="Days of the week">
            {WEEKDAYS.map(([value, label]) => (
              <label key={value} className="weekday-chip">
                <input type="checkbox" checked={days.includes(value)}
                  onChange={(e) => setDays((d) => (e.target.checked ? [...d, value] : d.filter((x) => x !== value)))} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        )}

        {recurrence === 'interval' && (
          <div className="form-group interval-group">
            <label htmlFor={`${formId}-interval`}>Every how many days</label>
            <input id={`${formId}-interval`} type="number" min={1} step={1} inputMode="numeric" value={intervalDays}
              onChange={(e) => setIntervalDays(e.target.value)} />
          </div>
        )}

        <div className="times-list" role="group" aria-label="Times of day">
          {times.map((t, i) => (
            <div key={i} className="time-row">
              <label htmlFor={`${formId}-time-${i}`} className="visually-hidden">Time {i + 1}</label>
              <input id={`${formId}-time-${i}`} type="time" value={t}
                onChange={(e) => setTimes((ts) => ts.map((x, j) => (j === i ? e.target.value : x)))} />
              {times.length > 1 && (
                <button type="button" className="btn-danger-icon" aria-label={`Remove time ${i + 1}`}
                  onClick={() => setTimes((ts) => ts.filter((_, j) => j !== i))}>
                  <i className="fa-solid fa-xmark" aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
          <button type="button" className="btn-clear" onClick={() => setTimes((ts) => [...ts, '20:00'])}>
            <i className="fa-solid fa-plus" aria-hidden="true" /> Add a time
          </button>
        </div>
        <FieldError id={`${formId}-schedule-error`} message={errorFor('schedule')} />
      </fieldset>

      <div className="form-actions">
        <button type="submit" className="btn-primary" disabled={submitting}>
          <i className="fa-solid fa-check" aria-hidden="true" />
          <span>{submitting ? 'Saving…' : submitLabel}</span>
        </button>
        <button type="button" className="btn-clear" onClick={onCancel} disabled={submitting}>Cancel</button>
      </div>
    </form>
  );
}

function toRecurrence(schedule: Schedule | null): Recurrence {
  const r = String(schedule?.recurrence ?? 'daily').toLowerCase();
  if (r === 'weekdays' || r === 'weekly') return 'weekdays';
  if (r === 'interval' || r === 'everyndays') return 'interval';
  return 'daily';
}

/** Human-readable schedule, e.g. "Mon, Wed at 08:00, 20:00". */
export function formatSchedule(schedule: Schedule | null | undefined): string {
  if (!schedule) return '—';
  const times = Array.isArray(schedule.times) ? schedule.times.join(', ') : '';
  const kind = toRecurrence(schedule);
  let when = 'Daily';
  if (kind === 'weekdays') {
    const picked = new Set((Array.isArray(schedule.daysOfWeek) ? schedule.daysOfWeek : []).map((d) => String(d).toLowerCase()));
    when = WEEKDAYS.filter(([v]) => picked.has(v)).map(([, l]) => l).join(', ') || 'No days';
  } else if (kind === 'interval') {
    const n = Number(schedule.intervalDays);
    when = n === 1 ? 'Daily' : `Every ${n} days`;
  }
  return times ? `${when} at ${times}` : when;
}
