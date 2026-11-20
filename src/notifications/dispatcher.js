/**
 * NotificationService / Dispatcher — the single outbound delivery pipeline for
 * the Medication Management System.
 *
 * All outbound messages (dose reminders, missed-dose alerts, refill reminders)
 * flow through `dispatch` so channel selection, failure recording, and retry
 * are implemented exactly once (design.md "Separation of the notification
 * pipeline"). This module is framework-free: it contains NO Express, NO HTTP,
 * and NO direct I/O. Storage is delegated to an injected
 * {@link module:data/interfaces.NotificationRepository}, and delivery is
 * delegated to injected pluggable channels (see `./channels.js`), so the retry
 * decision logic can be unit- and property-tested directly.
 *
 * Design reference (design.md "NotificationService / Dispatcher"):
 * - `dispatch(notification) -> DeliveryResult` — selects the recipient's
 *   configured channel (R2.4), delivers, and on failure records the failure and
 *   retries up to a configured maximum (R2.5, R4.5, R5.5, R13.2). If all
 *   retries fail, marks the notification undelivered for later review (R13.3).
 *
 * Retry semantics (design "Key Invariants": `attemptCount <= maxAttempts`):
 * - Each delivery try increments `attemptCount` by one.
 * - Trying continues while the previous try failed AND `attemptCount < maxAttempts`.
 * - The loop makes at most `maxAttempts` tries, so `attemptCount` never exceeds
 *   `maxAttempts` (R13.2).
 * - A successful try marks the notification `delivered` and stops.
 * - If every try fails, the notification is marked `undelivered` (R13.3).
 *
 * Requirements supported: 2.4, 2.5, 4.5, 5.5, 13.2, 13.3.
 */

import { NotificationStatus } from '../domain/types.js';
import { ChannelName } from './channels.js';

/**
 * Choose the channel a notification should be delivered over (R2.4).
 *
 * Precedence:
 *   1. The notification's own `channel`, when set (the scheduler/builders stamp
 *      this from the recipient's configured preference).
 *   2. A `resolveChannel(notification)` callback, when provided (lets callers
 *      look up the recipient's preference at dispatch time).
 *   3. `defaultChannel`.
 *
 * @param {object} notification
 * @param {(notification: object) => (string | null | undefined)} [resolveChannel]
 * @param {string} defaultChannel
 * @returns {string} The selected channel name.
 */
function selectChannelName(notification, resolveChannel, defaultChannel) {
  if (notification && notification.channel != null && notification.channel !== '') {
    return notification.channel;
  }
  if (typeof resolveChannel === 'function') {
    const resolved = resolveChannel(notification);
    if (resolved != null && resolved !== '') return resolved;
  }
  return defaultChannel;
}

/**
 * Create a notification dispatcher bound to a set of channels and a repository.
 *
 * @param {object} deps
 * @param {Record<string, {name: string, send: (n: object) => ({ok: boolean, detail?: string})}>} deps.channels
 *   Map of channel name → channel. A channel's `send` returns
 *   `{ ok: boolean, detail?: string }`; a thrown error is treated as a failed
 *   attempt.
 * @param {import('../data/interfaces.js').NotificationRepository} [deps.notificationRepository]
 *   Optional storage. When provided, the notification is persisted and its
 *   status/attemptCount are updated as delivery progresses so undelivered
 *   notifications can be reviewed later (R13.3).
 * @param {(notification: object) => (string|null|undefined)} [deps.resolveChannel]
 *   Optional callback resolving the recipient's configured channel when the
 *   notification does not carry one (R2.4).
 * @param {string} [deps.defaultChannel] - Fallback channel name (default: in-app).
 * @returns {{
 *   dispatch: (notification: object) => object,
 * }}
 */
export function createNotificationDispatcher({
  channels,
  notificationRepository = null,
  resolveChannel = null,
  defaultChannel = ChannelName.IN_APP,
}) {
  if (!channels || typeof channels !== 'object') {
    throw new Error('createNotificationDispatcher requires a channels map');
  }

  /**
   * Deliver a notification, retrying failures up to `maxAttempts` and marking it
   * undelivered when every attempt fails.
   *
   * The passed `notification` is not mutated; the returned result carries the
   * final record. When a repository is configured the record is persisted and
   * its `status`/`attemptCount` reflect the delivery outcome.
   *
   * @param {object} notification - A {@link module:domain/models.createNotification} record.
   * @returns {{
   *   status: string,
   *   attemptCount: number,
   *   channel: string,
   *   delivered: boolean,
   *   failures: Array<{attempt: number, detail: string}>,
   *   notification: object,
   * }} The delivery result.
   */
  function dispatch(notification) {
    if (!notification) {
      throw new Error('dispatch requires a notification');
    }

    const channelName = selectChannelName(notification, resolveChannel, defaultChannel);
    const channel = channels[channelName];

    // Normalize the working record; never let attemptCount start above 0 or
    // maxAttempts drop below 1 (a malformed record would otherwise skip retry).
    const maxAttempts = Number.isInteger(notification.maxAttempts) && notification.maxAttempts >= 1
      ? notification.maxAttempts
      : 1;

    // Persist (or refresh) the record so its progress is reviewable.
    let record = { ...notification, channel: channelName, maxAttempts };
    if (notificationRepository) {
      if (record.id == null) {
        record = notificationRepository.insert({
          ...record,
          status: NotificationStatus.PENDING,
          attemptCount: 0,
        });
      } else {
        record =
          notificationRepository.update(record.id, {
            channel: channelName,
            maxAttempts,
          }) ?? record;
      }
    }

    const failures = [];
    let attemptCount = 0;
    let delivered = false;
    let lastStatus = NotificationStatus.PENDING;

    // A missing/unknown channel cannot deliver; treat every attempt as a
    // failure so the retry-then-undelivered path (R13.3) still applies.
    while (attemptCount < maxAttempts && !delivered) {
      attemptCount += 1; // one try == one attempt (attemptCount <= maxAttempts).

      let result;
      if (!channel || typeof channel.send !== 'function') {
        result = { ok: false, detail: `unknown channel "${channelName}"` };
      } else {
        try {
          result = channel.send({ ...record, attemptCount });
        } catch (err) {
          result = { ok: false, detail: String(err && err.message ? err.message : err) };
        }
      }

      if (result && result.ok) {
        delivered = true;
        lastStatus = NotificationStatus.DELIVERED;
      } else {
        // Record each delivery failure (R2.5, R4.5, R5.5).
        failures.push({ attempt: attemptCount, detail: (result && result.detail) || 'delivery failed' });
        lastStatus = NotificationStatus.FAILED;
      }
    }

    // If we exhausted every attempt without delivering, mark undelivered for
    // later review (R13.3).
    const finalStatus = delivered
      ? NotificationStatus.DELIVERED
      : NotificationStatus.UNDELIVERED;

    if (notificationRepository && record && record.id != null) {
      record =
        notificationRepository.update(record.id, {
          status: finalStatus,
          attemptCount,
          channel: channelName,
        }) ?? { ...record, status: finalStatus, attemptCount };
    } else {
      record = { ...record, status: finalStatus, attemptCount };
    }

    // Defensive: the loop guarantees this, but assert the core invariant.
    if (attemptCount > maxAttempts) {
      throw new Error('invariant violated: attemptCount exceeded maxAttempts');
    }

    return {
      status: finalStatus,
      attemptCount,
      channel: channelName,
      delivered,
      failures,
      notification: record,
    };
  }

  return { dispatch };
}
