/**
 * Pluggable notification channels for the Medication Management System.
 *
 * The dispatcher (see `./dispatcher.js`) is channel-agnostic: it selects a
 * channel by name and calls `channel.send(notification)`. A channel is any
 * object exposing:
 *   - `name: string` — the identifier used for channel selection.
 *   - `send(notification) -> { ok: boolean, detail?: string }` — attempt a
 *     single delivery. `ok === true` means the attempt succeeded; `ok === false`
 *     (or a thrown error) means the attempt failed and should be retried by the
 *     dispatcher per the retry policy.
 *
 * For the project scope these are stub channels (email / SMS / in-app): they do
 * not perform real network I/O. Each records the payloads it was asked to send
 * so tests can assert on delivery, and each accepts an optional `outcomes`
 * strategy so tests can drive a deterministic sequence of success/failure
 * results (used to exercise retry-then-undelivered behavior, R13.2/R13.3).
 *
 * Design reference (design.md "Implementation choices"):
 * - "A pluggable dispatcher with email, SMS, and in-app stub channels for the
 *   project scope, so channel selection, retry, and failure recording are
 *   implemented once."
 *
 * Requirements supported: 2.4 (channel selection targets), 2.5/4.5/5.5/13.2
 * (failure surface the dispatcher retries on).
 */

/** Canonical channel identifiers understood by the dispatcher. */
export const ChannelName = Object.freeze({
  EMAIL: 'email',
  SMS: 'sms',
  IN_APP: 'in-app',
});

/**
 * Build a stub channel with a given name.
 *
 * The channel records every notification it is asked to deliver on `sent`
 * (regardless of outcome) so tests can inspect what was attempted. Delivery
 * success is decided by the optional `outcomes` option:
 *   - omitted / true  → every attempt succeeds.
 *   - false           → every attempt fails.
 *   - boolean[]       → the outcome for the Nth attempt (index by call count);
 *                       attempts past the end of the array reuse the last value.
 *   - function        → `(notification, attemptIndex) => boolean` deciding each
 *                       attempt; a thrown error is treated as a failed attempt.
 *
 * @param {string} name - Channel identifier (see {@link ChannelName}).
 * @param {object} [options]
 * @param {boolean|boolean[]|((notification: object, attemptIndex: number) => boolean)} [options.outcomes]
 *   Strategy deciding whether each `send` attempt succeeds (default: always).
 * @returns {{
 *   name: string,
 *   sent: object[],
 *   send: (notification: object) => { ok: boolean, detail?: string },
 * }}
 */
export function createStubChannel(name, { outcomes = true } = {}) {
  const sent = [];
  let calls = 0;

  const decide = (notification, attemptIndex) => {
    if (typeof outcomes === 'function') return Boolean(outcomes(notification, attemptIndex));
    if (Array.isArray(outcomes)) {
      if (outcomes.length === 0) return true;
      const idx = Math.min(attemptIndex, outcomes.length - 1);
      return Boolean(outcomes[idx]);
    }
    return Boolean(outcomes);
  };

  return {
    name,
    sent,
    send(notification) {
      const attemptIndex = calls;
      calls += 1;
      sent.push(notification);
      let ok;
      try {
        ok = decide(notification, attemptIndex);
      } catch (err) {
        return { ok: false, detail: String(err && err.message ? err.message : err) };
      }
      return ok ? { ok: true } : { ok: false, detail: `stub ${name} delivery failed` };
    },
  };
}

/**
 * Convenience factory returning the three stub channels keyed by name, ready to
 * register with the dispatcher.
 *
 * @param {object} [perChannelOptions]
 * @param {object} [perChannelOptions.email]
 * @param {object} [perChannelOptions.sms]
 * @param {object} [perChannelOptions.inApp]
 * @returns {Record<string, ReturnType<typeof createStubChannel>>}
 *   A map of channel name → channel, suitable to pass as the dispatcher's
 *   `channels` option.
 */
export function createStubChannels({ email, sms, inApp } = {}) {
  return {
    [ChannelName.EMAIL]: createStubChannel(ChannelName.EMAIL, email),
    [ChannelName.SMS]: createStubChannel(ChannelName.SMS, sms),
    [ChannelName.IN_APP]: createStubChannel(ChannelName.IN_APP, inApp),
  };
}
