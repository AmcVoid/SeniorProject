import React, { useMemo, useState } from 'react';
import { ApiError } from '../api/client.ts';

export interface FieldErrorsState {
  fields: Record<string, string>;
  generalError: Error | null;
  fieldProps: (name: string) => { 'aria-invalid'?: 'true'; 'aria-describedby'?: string };
  errorFor: (name: string) => string | null;
  errorId: (name: string) => string;
  setFromError: (err: unknown) => void;
  clear: () => void;
  clearField: (name: string) => void;
}

export function useFieldErrors(formId: string): FieldErrorsState {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<Error | null>(null);

  return useMemo(() => {
    const errorId = (name: string) => `${formId}-${name}-error`;

    const errorFor = (name: string): string | null =>
      Object.prototype.hasOwnProperty.call(fields, name) ? String(fields[name]) : null;

    const setFromError = (err: unknown) => {
      if (err instanceof ApiError && err.fields && typeof err.fields === 'object') {
        const fieldMap: Record<string, string> = {};
        for (const [k, v] of Object.entries(err.fields)) {
          fieldMap[k] = Array.isArray(v) ? v.join(', ') : String(v);
        }
        setFields(fieldMap);
        setGeneralError(Object.keys(fieldMap).length === 0 ? err : null);
        return;
      }
      setFields({});
      setGeneralError(err instanceof Error ? err : new Error(String(err)));
    };

    const clear = () => {
      setFields({});
      setGeneralError(null);
    };

    const clearField = (name: string) => {
      setFields((prev) => {
        if (!Object.prototype.hasOwnProperty.call(prev, name)) return prev;
        const next = { ...prev };
        delete next[name];
        return next;
      });
    };

    const fieldProps = (name: string) => {
      const msg = errorFor(name);
      if (msg == null) return {};
      return {
        'aria-invalid': 'true' as const,
        'aria-describedby': errorId(name),
      };
    };

    return {
      fields,
      generalError,
      fieldProps,
      errorFor,
      errorId,
      setFromError,
      clear,
      clearField,
    };
  }, [fields, generalError, formId]);
}

export interface FieldErrorProps {
  id: string;
  message?: string | null;
}

export function FieldError({ id, message }: FieldErrorProps) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="field-error">
      <i className="fa-solid fa-circle-exclamation" aria-hidden="true" style={{ marginRight: '0.4rem' }} />
      {message}
    </p>
  );
}
