/**
 * ContactService — caregiver contact management for a patient.
 *
 * Pure, framework-free CRUD over caregiver contacts (no Express, no I/O). All
 * persistence is delegated to an injected `CaregiverContactRepository`
 * conforming to the contract in `../data/interfaces.js`; the SQLite and
 * in-memory fakes are both shape-compatible.
 *
 * Behavior (design.md "ContactService"):
 * - `createContact` validates that a contact has a non-empty name and at least
 *   one delivery address, each of which must be a valid email address or phone
 *   number, associating a new record with the patient (R9.1).
 *   On missing information it returns a structured validation error naming the
 *   missing fields rather than persisting (R9.2).
 * - `updateContact` persists edits to an existing contact (R9.3), re-validating
 *   name/deliveryAddresses when they are part of the patch.
 * - `deleteContact` removes the contact so it no longer receives alerts — the
 *   scheduler's caregiver alert set is drawn from the repository, so a removed
 *   contact is excluded from future alerts (R9.4).
 * - `listContacts` returns exactly the caregiver contacts owned by the patient
 *   (R9.5).
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5.
 */

import { createCaregiverContact } from './models.js';

/**
 * Structured error thrown/returned when caregiver contact input is invalid.
 * `missingFields` enumerates each missing/invalid field so controllers can
 * translate to an HTTP 400 with a field-keyed body (design.md "Error
 * Handling"). (R9.2)
 */
export class CaregiverValidationError extends Error {
  /**
   * @param {string[]} missingFields - Field names that are missing/invalid.
   */
  constructor(missingFields, fieldMessages = {}) {
    const fields = [...missingFields];
    super(`Missing or invalid caregiver contact information: ${fields.join(', ')}`);
    this.name = 'CaregiverValidationError';
    /** @type {string[]} */
    this.missingFields = fields;
    /**
     * Optional human-readable message per field (e.g. why an address is
     * invalid). Fields without an entry are simply "required".
     * @type {Record<string, string>}
     */
    this.fieldMessages = { ...fieldMessages };
  }
}

/** @param {*} value @returns {boolean} True if a non-empty, non-whitespace string. */
const isNonEmptyString = (value) =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * Normalize a delivery-address list to the non-empty string entries it holds.
 * @param {*} addresses
 * @returns {string[]}
 */
const normalizeAddresses = (addresses) =>
  Array.isArray(addresses) ? addresses.filter(isNonEmptyString) : [];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** E.164-style phone number: optional "+", then 7–15 digits. */
const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;

/**
 * Whether a delivery address is a plausible email address or phone number.
 * Spaces, dashes, dots and parentheses are allowed in phone numbers
 * ("+1 (555) 123-4567") and ignored for the check.
 * @param {string} address
 * @returns {boolean}
 */
export function isValidDeliveryAddress(address) {
  const value = address.trim();
  if (value.includes('@')) return EMAIL_PATTERN.test(value);
  return PHONE_PATTERN.test(value.replace(/[\s().-]/g, ''));
}

/**
 * Validate the fields required for a caregiver contact.
 *
 * @param {{name: *, deliveryAddresses: *}} params
 * @returns {{ missing: string[], messages: Record<string, string> }}
 *   The missing/invalid field names (empty when valid) and, for invalid
 *   (present but malformed) fields, a message explaining the problem.
 */
function collectFieldErrors({ name, deliveryAddresses }) {
  const missing = [];
  const messages = {};
  if (!isNonEmptyString(name)) missing.push('name');
  const addresses = normalizeAddresses(deliveryAddresses);
  if (addresses.length === 0) {
    missing.push('deliveryAddress');
  } else {
    const invalid = addresses.filter((a) => !isValidDeliveryAddress(a));
    if (invalid.length > 0) {
      missing.push('deliveryAddress');
      messages.deliveryAddress =
        `Enter a valid email address or phone number (not "${invalid[0].trim()}").`;
    }
  }
  return { missing, messages };
}

/**
 * Create a ContactService bound to a caregiver-contact repository.
 *
 * @param {{ caregivers: import('../data/interfaces.js').CaregiverContactRepository }} deps
 * @returns {{
 *   createContact: (patientId: *, input: object) => object,
 *   updateContact: (patientId: *, contactId: *, patch: object) => object,
 *   deleteContact: (patientId: *, contactId: *) => void,
 *   listContacts: (patientId: *) => object[],
 * }}
 */
export function createContactService({ caregivers }) {
  if (!caregivers) {
    throw new Error('ContactService requires a caregivers repository');
  }

  /**
   * Fetch a contact and confirm it belongs to the patient.
   * @param {*} patientId
   * @param {*} contactId
   * @returns {object|null} The owned contact, or null if absent/not owned.
   */
  const findOwned = (patientId, contactId) => {
    const contact = caregivers.getById(contactId);
    if (!contact || String(contact.patientId) !== String(patientId)) return null;
    return contact;
  };

  return {
    /**
     * Create a caregiver contact for the patient after validation (R9.1, R9.2).
     * @param {*} patientId
     * @param {{name?: *, deliveryAddresses?: *, channelPreference?: *}} [input]
     * @returns {object} The persisted caregiver contact.
     * @throws {CaregiverValidationError} When name or delivery address missing.
     */
    createContact(patientId, input = {}) {
      const { name, deliveryAddresses, channelPreference = null } = input;
      const { missing, messages } = collectFieldErrors({ name, deliveryAddresses });
      if (missing.length > 0) throw new CaregiverValidationError(missing, messages);

      const contact = createCaregiverContact({
        patientId,
        name: name.trim(),
        deliveryAddresses: normalizeAddresses(deliveryAddresses).map((a) => a.trim()),
        channelPreference,
        active: true,
      });
      return caregivers.insert(contact);
    },

    /**
     * Persist edits to an existing caregiver contact owned by the patient
     * (R9.3). Fields included in the patch are re-validated; `patientId` and
     * `id` cannot be changed through the patch.
     *
     * @param {*} patientId
     * @param {*} contactId
     * @param {{name?: *, deliveryAddresses?: *, channelPreference?: *, active?: *}} patch
     * @returns {object} The updated caregiver contact.
     * @throws {Error} When the contact does not exist or is not owned.
     * @throws {CaregiverValidationError} When a patched field is invalid.
     */
    updateContact(patientId, contactId, patch = {}) {
      const existing = findOwned(patientId, contactId);
      if (!existing) throw new Error('Caregiver contact not found');

      const nextName = 'name' in patch ? patch.name : existing.name;
      const nextAddresses =
        'deliveryAddresses' in patch
          ? patch.deliveryAddresses
          : existing.deliveryAddresses;

      const { missing, messages } = collectFieldErrors({
        name: nextName,
        deliveryAddresses: nextAddresses,
      });
      if (missing.length > 0) throw new CaregiverValidationError(missing, messages);

      const cleanPatch = {};
      if ('name' in patch) cleanPatch.name = nextName.trim();
      if ('deliveryAddresses' in patch) {
        cleanPatch.deliveryAddresses = normalizeAddresses(nextAddresses).map((a) => a.trim());
      }
      if ('channelPreference' in patch) {
        cleanPatch.channelPreference = patch.channelPreference;
      }
      if ('active' in patch) cleanPatch.active = patch.active;

      return caregivers.update(existing.id, cleanPatch);
    },

    /**
     * Remove a caregiver contact owned by the patient, stopping future alerts
     * to it (R9.4).
     *
     * @param {*} patientId
     * @param {*} contactId
     * @returns {void}
     * @throws {Error} When the contact does not exist or is not owned.
     */
    deleteContact(patientId, contactId) {
      const existing = findOwned(patientId, contactId);
      if (!existing) throw new Error('Caregiver contact not found');
      caregivers.remove(existing.id);
    },

    /**
     * List exactly the caregiver contacts associated with the patient (R9.5).
     * @param {*} patientId
     * @returns {object[]}
     */
    listContacts(patientId) {
      return caregivers.listByPatient(patientId);
    },
  };
}
