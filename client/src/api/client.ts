/**
 * JSON API client (task 19.1) typed with TypeScript.
 *
 * The SPA talks to the backend EXCLUSIVELY over the JSON API described in
 * src/http/routes.js. This module is the single place that knows how to reach
 * that API: it owns the base URL, attaches the session token as an
 * `Authorization: Bearer <token>` header, parses JSON responses, and turns
 * non-2xx responses into a typed {@link ApiError} the views can render.
 */

import type {
  Medication,
  InteractionWarning,
  DoseEvent,
  AdherenceReport,
  Caregiver,
  MemoryNote,
  UserIdentity,
  ProviderDashboardData,
} from '../types.ts';

export function resolveApiBaseUrl(): string {
  const configured =
    typeof import.meta !== 'undefined' && (import.meta as any).env
      ? (import.meta as any).env.VITE_API_BASE_URL
      : undefined;
  const base = (configured ?? '/api').trim();
  return base.replace(/\/+$/, '');
}

export interface ApiErrorBody {
  error?: string;
  message?: string;
  fields?: Record<string, string | string[]>;
  [key: string]: unknown;
}

export class ApiError extends Error {
  status: number;
  body: ApiErrorBody | null;
  fields: Record<string, string | string[]> | null;

  constructor(status: number, body: ApiErrorBody | null) {
    const message =
      (body && (body.error || body.message)) || `Request failed (${status})`;
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body ?? null;
    this.fields = (body && body.fields) || null;
  }
}

export interface CreateApiClientOptions {
  getToken?: () => string | null;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  onUnauthorized?: () => void;
}

export type RequestOptions = Omit<RequestInit, 'body'> & { body?: any };

export interface ApiClient {
  request<T = any>(path: string, init?: RequestOptions): Promise<T>;
  baseUrl: string;
  login(credentials: { identifier: string; password: string }): Promise<{ token: string; identity: UserIdentity; expiresAt?: string | null }>;
  listMedications(): Promise<{ medications: Medication[]; interactionWarnings: InteractionWarning[] }>;
  createMedication(med: Partial<Medication>): Promise<Medication>;
  updateMedication(id: string, patch: Partial<Medication>): Promise<Medication>;
  deleteMedication(id: string): Promise<void>;
  listNotes(medicationId: string): Promise<{ notes: MemoryNote[] }>;
  addNote(medicationId: string, text: string): Promise<MemoryNote>;
  editNote(medicationId: string, noteId: string, text: string): Promise<MemoryNote>;
  deleteNote(medicationId: string, noteId: string): Promise<void>;
  logDose(doseEventId: string, status: string): Promise<DoseEvent>;
  changeDoseLog(doseEventId: string, status: string): Promise<DoseEvent>;
  getDoseHistory(range?: { from?: string; to?: string }): Promise<{ history: DoseEvent[] }>;
  getAdherence(params?: { patientId?: string; from?: string; to?: string }): Promise<AdherenceReport>;
  listCaregivers(): Promise<{ caregivers: Caregiver[] }>;
  createCaregiver(contact: { name: string; deliveryAddresses?: string[] }): Promise<Caregiver>;
  updateCaregiver(id: string, patch: Partial<Caregiver>): Promise<Caregiver>;
  deleteCaregiver(id: string): Promise<void>;
  listInteractionWarnings(): Promise<{ interactionWarnings: InteractionWarning[] }>;
  getProviderDashboard(patientId: string, period?: { from?: string; to?: string }): Promise<ProviderDashboardData>;
}

export function createApiClient({
  getToken = () => null,
  baseUrl,
  fetchImpl,
  onUnauthorized,
}: CreateApiClientOptions = {}): ApiClient {
  const base = baseUrl ?? resolveApiBaseUrl();
  const doFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);

  async function request<T = any>(path: string, init: RequestOptions = {}): Promise<T> {
    const headers = new Headers(init.headers || {});
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);

    let { body } = init;
    if (body !== undefined && body !== null && typeof body === 'object') {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(body);
    }

    const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
    const res = await doFetch(url, { ...init, headers, body });

    if (res.status === 204) return null as unknown as T;

    let parsed: any = null;
    const text = await res.text();
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { error: text };
      }
    }

    if (!res.ok) {
      if (res.status === 401 && !path.endsWith('/auth/login')) {
        onUnauthorized?.();
      }
      throw new ApiError(res.status, parsed);
    }
    return parsed;
  }

  const query = (params: Record<string, string | number | undefined | null> = {}) => {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') usp.set(k, String(v));
    }
    const s = usp.toString();
    return s ? `?${s}` : '';
  };

  return {
    request,
    baseUrl: base,
    login: (credentials) => request('/auth/login', { method: 'POST', body: credentials }),
    listMedications: () => request('/medications'),
    createMedication: (med) => request('/medications', { method: 'POST', body: med }),
    updateMedication: (id, patch) =>
      request(`/medications/${encodeURIComponent(id)}`, { method: 'PUT', body: patch }),
    deleteMedication: (id) =>
      request(`/medications/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    listNotes: (medicationId) =>
      request(`/medications/${encodeURIComponent(medicationId)}/notes`),
    addNote: (medicationId, text) =>
      request(`/medications/${encodeURIComponent(medicationId)}/notes`, {
        method: 'POST',
        body: { text },
      }),
    editNote: (medicationId, noteId, text) =>
      request(
        `/medications/${encodeURIComponent(medicationId)}/notes/${encodeURIComponent(noteId)}`,
        { method: 'PUT', body: { text } },
      ),
    deleteNote: (medicationId, noteId) =>
      request(
        `/medications/${encodeURIComponent(medicationId)}/notes/${encodeURIComponent(noteId)}`,
        { method: 'DELETE' },
      ),
    logDose: (doseEventId, status) =>
      request(`/doses/${encodeURIComponent(doseEventId)}/log`, {
        method: 'POST',
        body: { status },
      }),
    changeDoseLog: (doseEventId, status) =>
      request(`/doses/${encodeURIComponent(doseEventId)}/log`, {
        method: 'PUT',
        body: { status },
      }),
    getDoseHistory: (range = {}) => request(`/doses/history${query(range)}`),
    getAdherence: (params = {}) => request(`/adherence${query(params)}`),
    listCaregivers: () => request('/caregivers'),
    createCaregiver: (contact) =>
      request('/caregivers', { method: 'POST', body: contact }),
    updateCaregiver: (id, patch) =>
      request(`/caregivers/${encodeURIComponent(id)}`, { method: 'PUT', body: patch }),
    deleteCaregiver: (id) =>
      request(`/caregivers/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    listInteractionWarnings: () => request('/interaction-warnings'),
    getProviderDashboard: (patientId, period = {}) =>
      request(
        `/provider/patients/${encodeURIComponent(patientId)}/dashboard${query(period)}`,
      ),
  };
}
