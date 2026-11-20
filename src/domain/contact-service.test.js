/**
 * Unit tests for ContactService (task 10.1).
 *
 * Covers caregiver CRUD behavior against the in-memory fake repository:
 * creation with validation (R9.1, R9.2), edit persistence (R9.3), deletion
 * that stops future alerts (R9.4), and listing the patient's contacts (R9.5).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createContactService,
  CaregiverValidationError,
} from './contact-service.js';
import { createInMemoryCaregiverContactRepository } from '../data/memory.js';

/** Build a fresh service + repo pair for each test. */
function setup() {
  const caregivers = createInMemoryCaregiverContactRepository();
  const service = createContactService({ caregivers });
  return { service, caregivers };
}

test('createContact persists a contact associated with the patient (R9.1)', () => {
  const { service } = setup();
  const contact = service.createContact('patient-1', {
    name: 'Dana Doe',
    deliveryAddresses: ['dana@example.com'],
  });
  assert.ok(contact.id, 'assigns an id');
  assert.equal(contact.patientId, 'patient-1');
  assert.equal(contact.name, 'Dana Doe');
  assert.deepEqual(contact.deliveryAddresses, ['dana@example.com']);
  assert.equal(contact.active, true);
});

test('createContact trims name and drops blank addresses (R9.1)', () => {
  const { service } = setup();
  const contact = service.createContact('p1', {
    name: '  Sam  ',
    deliveryAddresses: ['   ', 'sam@example.com', ''],
  });
  assert.equal(contact.name, 'Sam');
  assert.deepEqual(contact.deliveryAddresses, ['sam@example.com']);
});

test('createContact rejects a missing name (R9.2)', () => {
  const { service, caregivers } = setup();
  assert.throws(
    () => service.createContact('p1', { deliveryAddresses: ['a@example.com'] }),
    (err) => {
      assert.ok(err instanceof CaregiverValidationError);
      assert.deepEqual(err.missingFields, ['name']);
      return true;
    },
  );
  assert.equal(caregivers.listByPatient('p1').length, 0, 'nothing persisted');
});

test('createContact rejects when no delivery address is provided (R9.2)', () => {
  const { service } = setup();
  assert.throws(
    () => service.createContact('p1', { name: 'Sam', deliveryAddresses: [] }),
    (err) => {
      assert.deepEqual(err.missingFields, ['deliveryAddress']);
      return true;
    },
  );
});

test('createContact reports both missing fields together (R9.2)', () => {
  const { service } = setup();
  assert.throws(
    () => service.createContact('p1', {}),
    (err) => {
      assert.deepEqual(err.missingFields, ['name', 'deliveryAddress']);
      return true;
    },
  );
});

test('updateContact saves edited contact information (R9.3)', () => {
  const { service, caregivers } = setup();
  const created = service.createContact('p1', {
    name: 'Old Name',
    deliveryAddresses: ['old@example.com'],
  });

  const updated = service.updateContact('p1', created.id, {
    name: 'New Name',
    deliveryAddresses: ['new@example.com', '555-1234'],
    channelPreference: 'sms',
  });

  assert.equal(updated.name, 'New Name');
  assert.deepEqual(updated.deliveryAddresses, ['new@example.com', '555-1234']);
  assert.equal(updated.channelPreference, 'sms');

  const persisted = caregivers.getById(created.id);
  assert.equal(persisted.name, 'New Name');
  assert.equal(persisted.patientId, 'p1', 'ownership unchanged');
});

test('updateContact re-validates patched fields (R9.2, R9.3)', () => {
  const { service } = setup();
  const created = service.createContact('p1', {
    name: 'Sam',
    deliveryAddresses: ['sam@example.com'],
  });
  assert.throws(
    () => service.updateContact('p1', created.id, { deliveryAddresses: [] }),
    (err) => {
      assert.deepEqual(err.missingFields, ['deliveryAddress']);
      return true;
    },
  );
});

test('updateContact rejects contacts not owned by the patient', () => {
  const { service } = setup();
  const created = service.createContact('p1', {
    name: 'Sam',
    deliveryAddresses: ['sam@example.com'],
  });
  assert.throws(() =>
    service.updateContact('other-patient', created.id, { name: 'X' }),
  );
});

test('deleteContact removes the contact so it no longer receives alerts (R9.4)', () => {
  const { service, caregivers } = setup();
  const created = service.createContact('p1', {
    name: 'Sam',
    deliveryAddresses: ['sam@example.com'],
  });

  service.deleteContact('p1', created.id);

  assert.equal(caregivers.getById(created.id), null);
  assert.equal(
    caregivers.listActiveByPatient('p1').length,
    0,
    'excluded from the alert-eligible set',
  );
});

test('deleteContact rejects contacts not owned by the patient', () => {
  const { service, caregivers } = setup();
  const created = service.createContact('p1', {
    name: 'Sam',
    deliveryAddresses: ['sam@example.com'],
  });
  assert.throws(() => service.deleteContact('other', created.id));
  assert.ok(caregivers.getById(created.id), 'still present');
});

test('listContacts returns exactly the patient\'s contacts (R9.5)', () => {
  const { service } = setup();
  service.createContact('p1', { name: 'A', deliveryAddresses: ['a@example.com'] });
  service.createContact('p1', { name: 'B', deliveryAddresses: ['b@example.com'] });
  service.createContact('p2', { name: 'C', deliveryAddresses: ['c@example.com'] });

  const p1 = service.listContacts('p1');
  assert.equal(p1.length, 2);
  assert.deepEqual(
    p1.map((c) => c.name).sort(),
    ['A', 'B'],
  );
  assert.ok(p1.every((c) => c.patientId === 'p1'));

  assert.equal(service.listContacts('nobody').length, 0);
});

test('createContact accepts email addresses and phone numbers in common formats', () => {
  const { service } = setup();
  const contact = service.createContact('p1', {
    name: 'Pat',
    deliveryAddresses: [' pat@example.com ', '+15551234567', '+1 (555) 123-4567'],
  });
  assert.deepEqual(contact.deliveryAddresses, [
    'pat@example.com',
    '+15551234567',
    '+1 (555) 123-4567',
  ]);
});

test('createContact rejects a malformed delivery address with an explanation', () => {
  const { service, caregivers } = setup();
  for (const bad of ['not-an-address', 'pat@example', '12345', 'call me maybe']) {
    assert.throws(
      () => service.createContact('p1', { name: 'Pat', deliveryAddresses: [bad] }),
      (err) => {
        assert.ok(err instanceof CaregiverValidationError);
        assert.deepEqual(err.missingFields, ['deliveryAddress']);
        assert.match(err.fieldMessages.deliveryAddress, /valid email address or phone number/);
        return true;
      },
      `expected "${bad}" to be rejected`,
    );
  }
  assert.equal(caregivers.listByPatient('p1').length, 0);
});

test('updateContact rejects a malformed delivery address', () => {
  const { service } = setup();
  const contact = service.createContact('p1', {
    name: 'Pat',
    deliveryAddresses: ['pat@example.com'],
  });
  assert.throws(
    () => service.updateContact('p1', contact.id, { deliveryAddresses: ['nope'] }),
    CaregiverValidationError,
  );
});
