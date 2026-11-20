/**
 * Shared domain and application types for the Medication Management System client.
 */

export type UserRole = 'patient' | 'provider' | string;

export interface UserIdentity {
  userId: string;
  role: UserRole;
  [key: string]: unknown;
}

export interface Schedule {
  recurrence?: string;
  times?: string[];
  [key: string]: unknown;
}

export interface Medication {
  id: string;
  name: string;
  dosage?: string;
  schedule?: Schedule | null;
  remainingSupply?: number;
  patientId?: string;
  [key: string]: unknown;
}

export interface InteractionWarning {
  id?: string;
  medicationIdA?: string;
  medicationIdB?: string;
  description?: string;
  severity?: string;
  [key: string]: unknown;
}

export interface DoseEvent {
  id?: string;
  doseEventId?: string;
  medicationId?: string;
  scheduledTime: string;
  status?: 'taken' | 'missed' | 'pending' | null;
  loggedAt?: string | null;
  [key: string]: unknown;
}

export interface AdherenceReport {
  patientId?: string;
  rate: number;
  scheduledDoses: number;
  takenDoses: number;
  missedDoses: number;
  from?: string;
  to?: string;
  [key: string]: unknown;
}

export interface Caregiver {
  id: string;
  name: string;
  deliveryAddresses?: string[];
  [key: string]: unknown;
}

export interface MemoryNote {
  id: string;
  medicationId: string;
  text: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface DateRange {
  from: string;
  to: string;
}

export interface ProviderDashboardData {
  medications: Medication[];
  interactionWarnings: InteractionWarning[];
  adherence?: AdherenceReport | null;
  [key: string]: unknown;
}

export interface ApiClientInterface {
  getIdentity(): Promise<UserIdentity | null>;
  login(credentials: { identifier: string; password: string }): Promise<UserIdentity>;
  logout(): Promise<void>;
  listMedications(): Promise<{ medications: Medication[]; interactionWarnings: InteractionWarning[] }>;
  getDoseHistory(range?: { from?: string; to?: string }): Promise<{ history: DoseEvent[] }>;
  logDose(eventId: string, status: string): Promise<DoseEvent>;
  changeDoseLog(eventId: string, status: string): Promise<DoseEvent>;
  getAdherenceReport(range?: { from?: string; to?: string }): Promise<{ report: AdherenceReport }>;
  listCaregivers(): Promise<{ caregivers: Caregiver[] }>;
  createCaregiver(data: { name: string; deliveryAddresses?: string[] }): Promise<Caregiver>;
  deleteCaregiver(id: string): Promise<void>;
  getProviderDashboard(patientId: string): Promise<ProviderDashboardData>;
  listNotes(medicationId: string): Promise<{ notes: MemoryNote[] }>;
  addNote(medicationId: string, text: string): Promise<MemoryNote>;
}
