/**
 * Unit tests for the notification dispatcher (task 12.1).
 *
 * Covers channel selection (R2.4), delivery over pluggable stub channels,
 * failure recording plus retry while attemptCount < max (R2.5, R4.5, R5.5,
 * R13.2), marking undelivered after exhaustion (R13.3), and the core invariant
 * that attemptCount never exceeds maxAttempts. Uses the in-memory notification
 * repository and configurable stub channels for deterministic outcomes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createNotificationDispatcher } from './dispatcher.js';
import { ChannelName, createStubChannels, createStubChannel } from './channels.js';
import { createInMemoryNotificationRepository } from '../data/memory.js';
import { createNotification } from '../domain/models.js';
import { NotificationType, NotificationStatus } from '../domain/types.js';

const RECIPIENT = 'patient-1';

function baseNotification(overrides = {}) {
  return createNotification({
    type: NotificationType.DOSE,
    recipientRef: RECIPIENT,
    payload: { medicationName: 'Aspirin' },
    maxAttempts: 3,
    ...overrides,
  });
}

test('delivers over the notification\'s configured channel (R2.4)', () => {
  const channels = createStubChannels();
  const dispatcher = createNotificationDispatcher({ channels });

  const result = dispatcher.dispatch(baseNotification({ channel: ChannelName.SMS }));

  assert.equal(result.channel, ChannelName.SMS);
  assert.equal(result.delivered, true);
  assert.equal(result.status, NotificationStatus.DELIVERED);
  assert.equal(channels[ChannelName.SMS].sent.length, 1);
  assert.equal(channels[ChannelName.EMAIL].sent.length, 0);
});

test('resolves the recipient\'s channel when the notification carries none (R2.4)', () => {
  const channels = createStubChannels();
  const dispatcher = createNotificationDispatcher({
    channels,
    resolveChannel: () => ChannelName.EMAIL,
  });

  const result = dispatcher.dispatch(baseNotification({ channel: null }));

  assert.equal(result.channel, ChannelName.EMAIL);
  assert.equal(channels[ChannelName.EMAIL].sent.length, 1);
});

test('falls back to the default channel when nothing else is configured', () => {
  const channels = createStubChannels();
  const dispatcher = createNotificationDispatcher({
    channels,
    defaultChannel: ChannelName.IN_APP,
  });

  const result = dispatcher.dispatch(baseNotification({ channel: null }));

  assert.equal(result.channel, ChannelName.IN_APP);
  assert.equal(result.delivered, true);
});

test('succeeds on first attempt with a single attempt count', () => {
  const channels = createStubChannels();
  const dispatcher = createNotificationDispatcher({ channels });

  const result = dispatcher.dispatch(baseNotification({ channel: ChannelName.EMAIL, maxAttempts: 3 }));

  assert.equal(result.attemptCount, 1);
  assert.equal(result.failures.length, 0);
});

test('records each failure and retries until a later attempt succeeds (R2.5, R13.2)', () => {
  // Fail, fail, then succeed.
  const channels = {
    [ChannelName.EMAIL]: createStubChannel(ChannelName.EMAIL, {
      outcomes: [false, false, true],
    }),
  };
  const dispatcher = createNotificationDispatcher({ channels });

  const result = dispatcher.dispatch(baseNotification({ channel: ChannelName.EMAIL, maxAttempts: 3 }));

  assert.equal(result.delivered, true);
  assert.equal(result.status, NotificationStatus.DELIVERED);
  assert.equal(result.attemptCount, 3);
  assert.equal(result.failures.length, 2, 'both prior failures are recorded');
  assert.deepEqual(
    result.failures.map((f) => f.attempt),
    [1, 2],
  );
});

test('marks undelivered after all attempts fail (R13.3) and attemptCount === maxAttempts', () => {
  const channels = {
    [ChannelName.SMS]: createStubChannel(ChannelName.SMS, { outcomes: false }),
  };
  const repo = createInMemoryNotificationRepository();
  const dispatcher = createNotificationDispatcher({
    channels,
    notificationRepository: repo,
  });

  const result = dispatcher.dispatch(baseNotification({ channel: ChannelName.SMS, maxAttempts: 4 }));

  assert.equal(result.delivered, false);
  assert.equal(result.status, NotificationStatus.UNDELIVERED);
  assert.equal(result.attemptCount, 4);
  assert.equal(result.failures.length, 4, 'every failed attempt is recorded');

  // Persisted for later review (R13.3).
  const undelivered = repo.listByStatus(NotificationStatus.UNDELIVERED);
  assert.equal(undelivered.length, 1);
  assert.equal(undelivered[0].attemptCount, 4);
});

test('attemptCount never exceeds maxAttempts even when every attempt fails', () => {
  for (const maxAttempts of [1, 2, 3, 5]) {
    const channels = {
      [ChannelName.IN_APP]: createStubChannel(ChannelName.IN_APP, { outcomes: false }),
    };
    const dispatcher = createNotificationDispatcher({ channels });
    const result = dispatcher.dispatch(
      baseNotification({ channel: ChannelName.IN_APP, maxAttempts }),
    );
    assert.ok(result.attemptCount <= maxAttempts, `attemptCount ${result.attemptCount} <= ${maxAttempts}`);
    assert.equal(result.attemptCount, maxAttempts);
  }
});

test('a thrown channel error is treated as a failed attempt and retried', () => {
  let calls = 0;
  const channels = {
    [ChannelName.EMAIL]: {
      name: ChannelName.EMAIL,
      sent: [],
      send() {
        calls += 1;
        if (calls < 2) throw new Error('boom');
        return { ok: true };
      },
    },
  };
  const dispatcher = createNotificationDispatcher({ channels });

  const result = dispatcher.dispatch(baseNotification({ channel: ChannelName.EMAIL, maxAttempts: 3 }));

  assert.equal(result.delivered, true);
  assert.equal(result.attemptCount, 2);
  assert.equal(result.failures.length, 1);
});

test('an unknown channel exhausts retries and marks undelivered (R13.3)', () => {
  const channels = createStubChannels();
  const dispatcher = createNotificationDispatcher({ channels });

  const result = dispatcher.dispatch(baseNotification({ channel: 'carrier-pigeon', maxAttempts: 2 }));

  assert.equal(result.delivered, false);
  assert.equal(result.status, NotificationStatus.UNDELIVERED);
  assert.equal(result.attemptCount, 2);
});

test('applies to missed-dose and refill notifications too (R4.5, R5.5)', () => {
  for (const type of [NotificationType.MISSED, NotificationType.REFILL]) {
    const channels = {
      [ChannelName.EMAIL]: createStubChannel(ChannelName.EMAIL, { outcomes: [false, true] }),
    };
    const dispatcher = createNotificationDispatcher({ channels });
    const result = dispatcher.dispatch(
      baseNotification({ type, channel: ChannelName.EMAIL, maxAttempts: 2 }),
    );
    assert.equal(result.delivered, true);
    assert.equal(result.failures.length, 1);
  }
});

test('normalizes a malformed maxAttempts to at least one attempt', () => {
  const channels = {
    [ChannelName.IN_APP]: createStubChannel(ChannelName.IN_APP, { outcomes: false }),
  };
  const dispatcher = createNotificationDispatcher({ channels });

  const result = dispatcher.dispatch(baseNotification({ channel: ChannelName.IN_APP, maxAttempts: 0 }));

  assert.equal(result.attemptCount, 1);
  assert.equal(result.status, NotificationStatus.UNDELIVERED);
});
