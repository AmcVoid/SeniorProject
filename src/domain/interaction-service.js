/**
 * InteractionService — drug-interaction detection for a patient.
 *
 * Pure, framework-free interaction detection (no Express, no I/O). The core is
 * `evaluateInteractions(activeMedications, ruleSet)`, a deterministic function
 * of the current active medication set and the interaction rule set: it emits
 * exactly one Interaction_Warning per matched unordered active-medication pair,
 * identifying both interacting medications and the nature of the interaction
 * taken from the matching rule (design.md "InteractionService"; R7.1, R7.2).
 *
 * Behavior (design.md "InteractionService"):
 * - `evaluateInteractions` produces the *desired* active warning set for the
 *   current active medications. Warnings are recomputed on add/remove, so this
 *   function is called again after the medication set changes (R7.1).
 * - `reconcileWarnings` diffs the freshly evaluated set against the warnings
 *   already recorded for the patient: it creates warnings for newly matched
 *   pairs and marks previously-active warnings resolved when their match breaks
 *   (e.g. a medication was removed) (R7.4).
 *
 * A rule matches a medication pair when the (unordered) pair of medication
 * *names* equals the rule's (unordered) drug pair. Medications are matched by
 * name because the rule set is keyed by drug name, not per-patient id.
 *
 * Requirements: 7.1, 7.2, 7.4.
 */

import { createInteractionWarning, normalizePair } from './models.js';
import { InteractionWarningStatus } from './types.js';

/**
 * Canonical key for an unordered pair of medication ids. Used to dedupe and to
 * diff evaluated warnings against recorded ones.
 *
 * @param {*} idA
 * @param {*} idB
 * @returns {string}
 */
function pairKey(idA, idB) {
  const [a, b] = normalizePair(idA, idB);
  return `${a}::${b}`;
}

/**
 * Canonical key for an unordered pair of drug names, used to look up a matching
 * interaction rule. Comparison is case-insensitive and trims surrounding
 * whitespace so "Aspirin" and " aspirin " match the same rule.
 *
 * @param {*} nameA
 * @param {*} nameB
 * @returns {string}
 */
function ruleKey(nameA, nameB) {
  const norm = (value) => String(value ?? '').trim().toLowerCase();
  const [a, b] = normalizePair(norm(nameA), norm(nameB));
  return `${a}::${b}`;
}

/**
 * Build a lookup from a normalized drug-name pair to its interaction rule.
 *
 * @param {object[]} ruleSet - InteractionRule records ({drugA, drugB, ...}).
 * @returns {Map<string, object>}
 */
function indexRules(ruleSet) {
  const index = new Map();
  for (const rule of ruleSet ?? []) {
    index.set(ruleKey(rule.drugA, rule.drugB), rule);
  }
  return index;
}

/**
 * Evaluate the interaction warnings implied by a set of active medications and
 * an interaction rule set (R7.1, R7.2).
 *
 * Pure and deterministic: for every unordered pair of distinct active
 * medications whose names match a rule, one active {@link createInteractionWarning}
 * record is produced. The warning identifies both medications
 * (`medicationIdA`/`medicationIdB`, normalized to canonical order) and the
 * nature of the interaction (`description`, from the matching rule).
 *
 * The result is de-duplicated by unordered medication-id pair, so at most one
 * warning is emitted per pair even if the medication list contains duplicates
 * or multiple rules could match.
 *
 * @param {object[]} activeMedications - Active Medication records for one patient.
 * @param {object[]} ruleSet - The interaction rule set.
 * @returns {object[]} Active Interaction_Warning records (no ids assigned).
 */
export function evaluateInteractions(activeMedications, ruleSet) {
  const meds = activeMedications ?? [];
  const rules = indexRules(ruleSet);
  const warnings = [];
  const seen = new Set();

  for (let i = 0; i < meds.length; i += 1) {
    for (let j = i + 1; j < meds.length; j += 1) {
      const medA = meds[i];
      const medB = meds[j];
      // A pair must reference two distinct medications (design invariant).
      if (String(medA.id) === String(medB.id)) continue;

      const rule = rules.get(ruleKey(medA.name, medB.name));
      if (!rule) continue;

      const key = pairKey(medA.id, medB.id);
      if (seen.has(key)) continue;
      seen.add(key);

      warnings.push(
        createInteractionWarning({
          patientId: medA.patientId,
          medicationIdA: medA.id,
          medicationIdB: medB.id,
          description: rule.description,
          status: InteractionWarningStatus.ACTIVE,
        }),
      );
    }
  }

  return warnings;
}

/**
 * Diff the freshly evaluated warning set against the warnings already recorded
 * for the patient, returning the changes needed to reconcile them (R7.1, R7.4).
 *
 * - A newly matched pair with no recorded active warning yields a `toCreate`
 *   entry (an active warning to persist).
 * - A previously active warning whose pair is no longer matched (e.g. because a
 *   medication was removed) yields a `toResolve` entry — the recorded warning
 *   with its status flipped to `resolved`.
 *
 * Already-active warnings whose match still holds are left untouched (no
 * duplicate is created), and warnings already `resolved` are ignored.
 *
 * @param {object[]} evaluatedWarnings - Output of {@link evaluateInteractions}.
 * @param {object[]} existingWarnings - Warnings previously recorded for the patient.
 * @returns {{ toCreate: object[], toResolve: object[] }}
 */
export function reconcileWarnings(evaluatedWarnings, existingWarnings) {
  const evaluatedByPair = new Map();
  for (const w of evaluatedWarnings ?? []) {
    evaluatedByPair.set(pairKey(w.medicationIdA, w.medicationIdB), w);
  }

  const activeExistingPairs = new Set();
  const toResolve = [];
  for (const w of existingWarnings ?? []) {
    if (w.status !== InteractionWarningStatus.ACTIVE) continue;
    const key = pairKey(w.medicationIdA, w.medicationIdB);
    if (evaluatedByPair.has(key)) {
      // Match still holds — keep the existing active warning as-is.
      activeExistingPairs.add(key);
    } else {
      // Match broke — mark the recorded warning resolved (R7.4).
      toResolve.push({ ...w, status: InteractionWarningStatus.RESOLVED });
    }
  }

  const toCreate = [];
  for (const [key, warning] of evaluatedByPair) {
    if (!activeExistingPairs.has(key)) toCreate.push(warning);
  }

  return { toCreate, toResolve };
}

/**
 * Create an InteractionService bound to the patient's interaction warning
 * repository and the shared interaction rule set.
 *
 * The service ties the pure `evaluateInteractions`/`reconcileWarnings` logic to
 * persistence: `refreshForPatient` recomputes the warnings for a patient's
 * current active medications and applies the reconciliation (creating new
 * warnings, resolving broken ones), while `listActiveWarnings` surfaces the
 * patient's active warnings for display (R7.3, R6.4).
 *
 * @param {object} deps
 * @param {import('../data/interfaces.js').InteractionWarningRepository} deps.interactionWarnings
 * @param {import('../data/interfaces.js').InteractionRuleRepository} deps.interactionRules
 * @returns {{
 *   evaluate: (activeMedications: object[]) => object[],
 *   refreshForPatient: (patientId: *, activeMedications: object[]) => object[],
 *   listActiveWarnings: (patientId: *) => object[],
 * }}
 */
export function createInteractionService({ interactionWarnings, interactionRules } = {}) {
  if (!interactionWarnings) {
    throw new Error('InteractionService requires an interactionWarnings repository');
  }
  if (!interactionRules) {
    throw new Error('InteractionService requires an interactionRules repository');
  }

  return {
    /**
     * Evaluate the active warnings for a set of active medications against the
     * current rule set, without persisting (pure pass-through) (R7.1, R7.2).
     *
     * @param {object[]} activeMedications
     * @returns {object[]}
     */
    evaluate(activeMedications) {
      return evaluateInteractions(activeMedications, interactionRules.list());
    },

    /**
     * Recompute and reconcile the patient's interaction warnings against their
     * current active medications: persist warnings for newly matched pairs and
     * mark warnings resolved when a match breaks (R7.1, R7.4).
     *
     * @param {*} patientId
     * @param {object[]} activeMedications - The patient's active medications.
     * @returns {object[]} The patient's active warnings after reconciliation.
     */
    refreshForPatient(patientId, activeMedications) {
      const evaluated = evaluateInteractions(
        activeMedications,
        interactionRules.list(),
      );
      const existing = interactionWarnings.listByPatient(patientId);
      const { toCreate, toResolve } = reconcileWarnings(evaluated, existing);

      for (const warning of toCreate) {
        interactionWarnings.insert({ ...warning, patientId });
      }
      for (const warning of toResolve) {
        interactionWarnings.update(warning.id, {
          status: InteractionWarningStatus.RESOLVED,
        });
      }

      return interactionWarnings.listActiveByPatient(patientId);
    },

    /**
     * List the patient's active interaction warnings for display (R7.3, R6.4).
     *
     * @param {*} patientId
     * @returns {object[]}
     */
    listActiveWarnings(patientId) {
      return interactionWarnings.listActiveByPatient(patientId);
    },
  };
}
