/**
 * JSON API route wiring for the Medication Management System (task 18.1).
 *
 * These controllers are intentionally THIN: each one resolves the target
 * patient, runs the request through the authorization policy layer and the
 * audit wrapper via `guardPhi`, delegates the actual work to an injected domain
 * service, and shapes the JSON response. No business logic lives here (design.md
 * "HTTP / Controller layer").
 *
 * Every route mounted here is a PHI route, so every route:
 *   - requires a valid session (attaches `req.identity`), enforced by the
 *     `requireSession` middleware mounted by the app factory;
 *   - passes through `guardPhi`, which authorizes the identity for the resolved
 *     target patient (deny -> 403 with no PHI) and records exactly one audit
 *     entry per access (R12.3).
 *
 * Target-patient resolution:
 *   - Patient-scoped routes (`/api/medications`, `/api/doses`, `/api/caregivers`,
 *     `/api/medications/:id/notes`, `/api/interaction-warnings`) act on the
 *     authenticated caller's own patient id. A provider calling these is denied
 *     by the policy layer (not the owner, not self-assigned).
 *   - Provider dashboard routes (`/api/provider/patients/:patientId/...`) and
 *     the adherence report route resolve the target patient from the route/query
 *     so an assigned provider can read an assigned patient's PHI (R6.1–R6.4,
 *     R8.3); the policy layer denies unassigned providers (R6.3, R11.4).
 */

import { Router } from 'express';
import { asyncHandler, HttpError } from './middleware.js';

/**
 * Build the fully-wired PHI router.
 *
 * @param {object} deps
 * @param {import('express').RequestHandler} deps.requireSession
 *   Session-validation middleware (attaches `req.identity`).
 * @param {Function} deps.guardPhi
 *   The `guardPhi(req, ctx, operation)` helper from createGuardPhi.
 * @param {object} deps.services - Already-constructed domain services.
 * @param {object} deps.services.medications - MedicationService.
 * @param {object} deps.services.doseLogs - DoseLogService.
 * @param {object} deps.services.adherence - AdherenceService.
 * @param {object} deps.services.contacts - ContactService.
 * @param {object} deps.services.notes - NoteService.
 * @param {object} deps.services.interactions - InteractionService.
 * @returns {import('express').Router}
 */
export function createApiRouter({ requireSession, guardPhi, services }) {
  const {
    medications,
    doseLogs,
    adherence,
    contacts,
    notes,
    interactions,
  } = services;

  const router = Router();

  // Every route below is a PHI route: require a valid session first (R11.5).
  router.use(requireSession);

  /** The caller's own patient id (patient-scoped routes act on own records). */
  const selfPatient = (req) => req.identity.userId;

  // ---- Medications (R1.5, R1.1–R1.4, R7.3 via interactions on list) --------

  router.get(
    '/medications',
    asyncHandler((req, res) => {
      const patientId = selfPatient(req);
      const list = guardPhi(req, { targetPatientId: patientId, action: 'read' }, () => {
        const meds = medications.listActiveMedications(patientId);
        const warnings = interactions.listActiveWarnings(patientId);
        return { medications: meds, interactionWarnings: warnings };
      });
      res.json(list);
    }),
  );

  router.post(
    '/medications',
    asyncHandler((req, res) => {
      const patientId = selfPatient(req);
      const created = guardPhi(
        req,
        { targetPatientId: patientId, action: 'write' },
        () => {
          const med = medications.createMedication(patientId, req.body ?? {});
          // Recompute interaction warnings against the new active set (R7.1).
          interactions.refreshForPatient(
            patientId,
            medications.listActiveMedications(patientId),
          );
          return med;
        },
      );
      res.status(201).json(created);
    }),
  );

  router.put(
    '/medications/:medicationId',
    asyncHandler((req, res) => {
      const patientId = selfPatient(req);
      const updated = guardPhi(
        req,
        { targetPatientId: patientId, recordRef: req.params.medicationId, action: 'write' },
        () => medications.updateMedication(patientId, req.params.medicationId, req.body ?? {}),
      );
      if (!updated) throw new HttpError(404, { error: 'Not found' });
      res.json(updated);
    }),
  );

  router.delete(
    '/medications/:medicationId',
    asyncHandler((req, res) => {
      const patientId = selfPatient(req);
      const deleted = guardPhi(
        req,
        { targetPatientId: patientId, recordRef: req.params.medicationId, action: 'write' },
        () => {
          const ok = medications.deleteMedication(patientId, req.params.medicationId);
          if (ok) {
            // Removing a medication may resolve interaction warnings (R7.4).
            interactions.refreshForPatient(
              patientId,
              medications.listActiveMedications(patientId),
            );
          }
          return ok;
        },
      );
      if (!deleted) throw new HttpError(404, { error: 'Not found' });
      res.status(204).end();
    }),
  );

  // ---- Memory notes for a medication (R10.1–R10.4) -------------------------

  router.get(
    '/medications/:medicationId/notes',
    asyncHandler((req, res) => {
      const patientId = selfPatient(req);
      const list = guardPhi(
        req,
        { targetPatientId: patientId, recordRef: req.params.medicationId, action: 'read' },
        () => notes.listNotes(req.params.medicationId),
      );
      res.json({ notes: list });
    }),
  );

  router.post(
    '/medications/:medicationId/notes',
    asyncHandler((req, res) => {
      const patientId = selfPatient(req);
      const note = guardPhi(
        req,
        { targetPatientId: patientId, recordRef: req.params.medicationId, action: 'write' },
        () => notes.attachNote(req.params.medicationId, (req.body ?? {}).text),
      );
      res.status(201).json(note);
    }),
  );

  router.put(
    '/medications/:medicationId/notes/:noteId',
    asyncHandler((req, res) => {
      const patientId = selfPatient(req);
      const note = guardPhi(
        req,
        { targetPatientId: patientId, recordRef: req.params.noteId, action: 'write' },
        () => notes.editNote(req.params.noteId, (req.body ?? {}).text),
      );
      if (!note) throw new HttpError(404, { error: 'Not found' });
      res.json(note);
    }),
  );

  router.delete(
    '/medications/:medicationId/notes/:noteId',
    asyncHandler((req, res) => {
      const patientId = selfPatient(req);
      const removed = guardPhi(
        req,
        { targetPatientId: patientId, recordRef: req.params.noteId, action: 'write' },
        () => notes.deleteNote(req.params.noteId),
      );
      if (!removed) throw new HttpError(404, { error: 'Not found' });
      res.status(204).end();
    }),
  );

  // ---- Dose logging + history (R3.1, R3.2, R3.4, R3.5) ---------------------

  router.post(
    '/doses/:doseEventId/log',
    asyncHandler((req, res) => {
      const patientId = selfPatient(req);
      const log = guardPhi(
        req,
        { targetPatientId: patientId, recordRef: req.params.doseEventId, action: 'write' },
        () => doseLogs.logDose(patientId, req.params.doseEventId, (req.body ?? {}).status),
      );
      res.status(201).json(log);
    }),
  );

  router.put(
    '/doses/:doseEventId/log',
    asyncHandler((req, res) => {
      const patientId = selfPatient(req);
      const log = guardPhi(
        req,
        { targetPatientId: patientId, recordRef: req.params.doseEventId, action: 'write' },
        () => doseLogs.changeLog(patientId, req.params.doseEventId, (req.body ?? {}).status),
      );
      res.json(log);
    }),
  );

  router.get(
    '/doses/history',
    asyncHandler((req, res) => {
      const patientId = selfPatient(req);
      const range = { from: req.query.from, to: req.query.to };
      const history = guardPhi(
        req,
        { targetPatientId: patientId, action: 'read' },
        () => doseLogs.getDoseHistory(patientId, range),
      );
      res.json({ history });
    }),
  );

  // ---- Adherence report (R8.1, R8.2; provider path R8.3) -------------------
  // `patientId` query lets an assigned provider read an assigned patient's
  // report; it defaults to the caller's own id. The policy layer denies a
  // provider not assigned to the requested patient (R6.3, R11.4).

  router.get(
    '/adherence',
    asyncHandler((req, res) => {
      const targetPatientId = req.query.patientId ?? selfPatient(req);
      const period = { from: req.query.from, to: req.query.to };
      const report = guardPhi(
        req,
        { targetPatientId, action: 'read' },
        () => adherence.computeAdherence(targetPatientId, period),
      );
      res.json(report);
    }),
  );

  // ---- Caregiver contacts CRUD (R9.1–R9.5) ---------------------------------

  router.get(
    '/caregivers',
    asyncHandler((req, res) => {
      const patientId = selfPatient(req);
      const list = guardPhi(
        req,
        { targetPatientId: patientId, action: 'read' },
        () => contacts.listContacts(patientId),
      );
      res.json({ caregivers: list });
    }),
  );

  router.post(
    '/caregivers',
    asyncHandler((req, res) => {
      const patientId = selfPatient(req);
      const created = guardPhi(
        req,
        { targetPatientId: patientId, action: 'write' },
        () => contacts.createContact(patientId, req.body ?? {}),
      );
      res.status(201).json(created);
    }),
  );

  router.put(
    '/caregivers/:contactId',
    asyncHandler((req, res) => {
      const patientId = selfPatient(req);
      const updated = guardPhi(
        req,
        { targetPatientId: patientId, recordRef: req.params.contactId, action: 'write' },
        () => contacts.updateContact(patientId, req.params.contactId, req.body ?? {}),
      );
      res.json(updated);
    }),
  );

  router.delete(
    '/caregivers/:contactId',
    asyncHandler((req, res) => {
      const patientId = selfPatient(req);
      guardPhi(
        req,
        { targetPatientId: patientId, recordRef: req.params.contactId, action: 'write' },
        () => contacts.deleteContact(patientId, req.params.contactId),
      );
      res.status(204).end();
    }),
  );

  // ---- Interaction warnings (R7.3) -----------------------------------------

  router.get(
    '/interaction-warnings',
    asyncHandler((req, res) => {
      const patientId = selfPatient(req);
      const list = guardPhi(
        req,
        { targetPatientId: patientId, action: 'read' },
        () => interactions.listActiveWarnings(patientId),
      );
      res.json({ interactionWarnings: list });
    }),
  );

  // ---- Provider dashboard (R6.1, R6.2, R6.3, R6.4) -------------------------
  // A single call returns an assigned patient's active medications, active
  // interaction warnings, and adherence report. The policy layer denies a
  // provider not assigned to `:patientId` (R6.3) — the denial carries no PHI.

  router.get(
    '/provider/patients/:patientId/dashboard',
    asyncHandler((req, res) => {
      const targetPatientId = req.params.patientId;
      const period = { from: req.query.from, to: req.query.to };
      const dashboard = guardPhi(
        req,
        { targetPatientId, action: 'read' },
        () => ({
          patientId: targetPatientId,
          medications: medications.listActiveMedications(targetPatientId),
          interactionWarnings: interactions.listActiveWarnings(targetPatientId),
          adherence: adherence.computeAdherence(targetPatientId, period),
        }),
      );
      res.json(dashboard);
    }),
  );

  return router;
}
