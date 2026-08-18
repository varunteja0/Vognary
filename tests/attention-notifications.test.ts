import assert from "node:assert/strict";
import test from "node:test";

import { buildAttentionFeed, otherCommitmentIdFromDuplicateKey } from "../src/lib/recovery/attention-feed";
import type { ChangeSignal } from "../src/lib/recovery/change-intelligence";
import {
  advanceNotificationDelivery,
  notificationDeliveryStates,
  notificationRetryDelayMinutes,
  planNotifications,
  type NotificationConsent,
} from "../src/lib/recovery/notification-policy";

const now = "2026-08-17T09:00:00.000Z";
const evaluatedOn = "2026-08-17";

function signal(overrides: Partial<ChangeSignal> = {}): ChangeSignal {
  return {
    dedupeKey: "PRICE_INCREASE:c-1:64900:74900",
    kind: "PRICE_INCREASE",
    commitmentId: "c-1",
    merchant: "Netflix",
    title: "Netflix costs more than it did",
    detail: "The charge on 2026-08-05 was higher than the one before it.",
    confidence: 100,
    materiality: "HIGH",
    currency: "INR",
    amountMinor: BigInt(74900),
    deltaMinor: BigInt(10000),
    dueDate: null,
    citation: { kind: "EVIDENCE", evidenceIds: ["ev-aug"] },
    ...overrides,
  };
}

const consent = (overrides: Partial<NotificationConsent> = {}): NotificationConsent =>
  ({ productEmails: true, unsubscribedAt: null, ...overrides });

function plan(overrides: Partial<Parameters<typeof planNotifications>[0]> = {}) {
  return planNotifications({
    now,
    signals: [signal()],
    consent: consent(),
    channelReady: true,
    minimumMateriality: "MEDIUM",
    alreadyPlanned: [],
    digest: { lastSentAt: null, intervalHours: 24 },
    ...overrides,
  });
}

test("attention is ordered by what actually matters, then by what is due first", () => {
  const feed = buildAttentionFeed([
    signal({ dedupeKey: "a", materiality: "LOW", kind: "NEW_RECURRING_COMMITMENT" }),
    signal({ dedupeKey: "b", materiality: "CRITICAL", kind: "CANCELLATION_NOT_EFFECTIVE" }),
    signal({ dedupeKey: "c", materiality: "HIGH", kind: "TRIAL_CONVERTING", dueDate: "2026-09-01" }),
    signal({ dedupeKey: "d", materiality: "HIGH", kind: "ANNUAL_RENEWAL_APPROACHING", dueDate: "2026-08-20" }),
  ], { evaluatedOn });
  assert.deepEqual(feed.map((card) => card.id), ["b", "d", "c", "a"]);
});

test("attention urgency reflects both importance and how soon it lands", () => {
  const [critical, soon, whenever] = buildAttentionFeed([
    signal({ dedupeKey: "a", materiality: "CRITICAL" }),
    signal({ dedupeKey: "b", materiality: "HIGH", dueDate: "2026-08-19" }),
    signal({ dedupeKey: "c", materiality: "LOW" }),
  ], { evaluatedOn });
  assert.equal(critical!.urgency, "NOW");
  assert.equal(soon!.urgency, "NOW");
  assert.equal(whenever!.urgency, "WHENEVER");
});

test("attention offers the right next step for each kind", () => {
  const feed = buildAttentionFeed([
    signal({ dedupeKey: "a", kind: "COVERAGE_BROKEN", commitmentId: null, merchant: null }),
    signal({ dedupeKey: "DUPLICATE_SUSPECTED:c-1:c-2", kind: "DUPLICATE_SUSPECTED", commitmentId: "c-1" }),
    signal({ dedupeKey: "c", kind: "PRICE_INCREASE" }),
  ], { evaluatedOn });
  assert.deepEqual(feed.map((card) => card.nextStep).sort(), ["CONFIRM_SAME_SUBSCRIPTION", "RECONNECT_SOURCE", "REVIEW_SUBSCRIPTION"]);
  const duplicate = feed.find((card) => card.nextStep === "CONFIRM_SAME_SUBSCRIPTION");
  assert.equal(duplicate?.otherCommitmentId, "c-2");
});

test("duplicate attention keys expose the other commitment without leaking extra fields", () => {
  assert.equal(otherCommitmentIdFromDuplicateKey("DUPLICATE_SUSPECTED:aaa:bbb", "aaa"), "bbb");
  assert.equal(otherCommitmentIdFromDuplicateKey("DUPLICATE_SUSPECTED:aaa:bbb", "bbb"), "aaa");
  assert.equal(otherCommitmentIdFromDuplicateKey("PRICE_INCREASE:c-1", "c-1"), null);
});

test("attention never shows internal vocabulary or raw scores", () => {
  const feed = buildAttentionFeed(
    [signal(), signal({ dedupeKey: "x", kind: "COVERAGE_BROKEN", commitmentId: null, merchant: null })],
    { evaluatedOn },
  );
  for (const card of feed) {
    for (const line of [card.headline, card.body]) {
      assert.doesNotMatch(line, /[A-Z]{3,}_[A-Z]/, `leaked an internal name: ${line}`);
      assert.doesNotMatch(line, /\b0\.\d+\b/, `leaked a confidence decimal: ${line}`);
      assert.doesNotMatch(line, /\bcommitment\b|\bgraph\b|\bmigration\b|\bdetector\b/i, `leaked internal terminology: ${line}`);
    }
  }
});

test("nothing material means no notification at all", () => {
  const result = plan({ signals: [] });
  assert.deepEqual(result.immediate, []);
  assert.deepEqual(result.digest.items, []);
  assert.equal(result.digest.scheduled, false);
  assert.deepEqual(result.suppressed, []);
});

test("important changes go out immediately and quiet ones wait for the digest", () => {
  const result = plan({
    signals: [
      signal({ dedupeKey: "a", materiality: "CRITICAL" }),
      signal({ dedupeKey: "b", materiality: "MEDIUM" }),
    ],
  });
  assert.deepEqual(result.immediate.map((entry) => entry.dedupeKey), ["a"]);
  assert.deepEqual(result.digest.items.map((entry) => entry.dedupeKey), ["b"]);
  assert.equal(result.digest.scheduled, true);
  assert.equal(result.digest.dueAt, "2026-08-18T09:00:00.000Z");
});

test("changes below the chosen threshold are suppressed, not quietly dropped", () => {
  const result = plan({ signals: [signal({ materiality: "LOW" })], minimumMateriality: "MEDIUM" });
  assert.deepEqual(result.suppressed, [{ dedupeKey: signal().dedupeKey, channel: "EMAIL", reason: "BELOW_MATERIALITY" }]);
  assert.deepEqual(result.immediate, []);
});

test("without consent nothing is emailed", () => {
  const result = plan({ consent: consent({ productEmails: false }) });
  assert.deepEqual(result.suppressed.map((entry) => entry.reason), ["NO_CONSENT"]);
  assert.deepEqual(result.immediate, []);
});

test("an unsubscribe outranks consent", () => {
  const result = plan({ consent: consent({ unsubscribedAt: "2026-08-01T00:00:00.000Z" }) });
  assert.deepEqual(result.suppressed.map((entry) => entry.reason), ["UNSUBSCRIBED"]);
});

test("an unconfigured email provider suppresses email and never queues it", () => {
  const result = plan({ channelReady: false });
  assert.deepEqual(result.suppressed.map((entry) => entry.reason), ["CHANNEL_NOT_READY"]);
  assert.deepEqual(result.immediate, []);
  assert.equal(result.digest.scheduled, false);
});

test("something already notified is not notified again", () => {
  const result = plan({ alreadyPlanned: [{ dedupeKey: signal().dedupeKey, channel: "EMAIL" }] });
  assert.deepEqual(result.suppressed.map((entry) => entry.reason), ["ALREADY_NOTIFIED"]);
});

test("the digest waits for its interval before sending again", () => {
  const result = plan({
    signals: [signal({ materiality: "MEDIUM" })],
    digest: { lastSentAt: "2026-08-17T06:00:00.000Z", intervalHours: 24 },
  });
  assert.equal(result.digest.scheduled, true);
  assert.equal(result.digest.dueAt, "2026-08-18T06:00:00.000Z");
});

test("planning is idempotent for the same facts", () => {
  assert.deepEqual(plan(), plan());
});

test("the delivery vocabulary is exactly the declared states", () => {
  assert.deepEqual([...notificationDeliveryStates], [
    "QUEUED", "SENDING", "PROVIDER_ACCEPTED", "DELIVERED", "FAILED",
    "RETRY_SCHEDULED", "DEAD_LETTER", "SUPPRESSED", "UNSUBSCRIBED",
  ]);
});

test("only a provider callback may report delivery", () => {
  const accepted = advanceNotificationDelivery({ current: "SENDING", attempt: 1, now, event: { kind: "PROVIDER_ACCEPTED" } });
  assert.equal(accepted.state, "PROVIDER_ACCEPTED");
  const delivered = advanceNotificationDelivery({ current: "PROVIDER_ACCEPTED", attempt: 1, now, event: { kind: "PROVIDER_DELIVERED" } });
  assert.equal(delivered.state, "DELIVERED");
  for (const current of ["QUEUED", "SENDING"] as const) {
    const forced = advanceNotificationDelivery({ current, attempt: 1, now, event: { kind: "PROVIDER_DELIVERED" } });
    assert.equal(forced.accepted, false, current);
    assert.notEqual(forced.state, "DELIVERED");
  }
});

test("acceptance by the provider is not delivery", () => {
  const accepted = advanceNotificationDelivery({ current: "SENDING", attempt: 1, now, event: { kind: "PROVIDER_ACCEPTED" } });
  assert.notEqual(accepted.state, "DELIVERED");
  assert.ok(accepted.reasons.some((reason) => reason.toLowerCase().includes("not confirm")));
});

test("failures retry with growing backoff and then dead-letter", () => {
  let attempt = 1;
  let state = advanceNotificationDelivery({ current: "SENDING", attempt, now, event: { kind: "SEND_FAILED", errorCode: "TIMEOUT" } });
  assert.equal(state.state, "RETRY_SCHEDULED");
  assert.equal(state.nextAttemptAt, "2026-08-17T09:02:00.000Z");
  attempt = 2;
  state = advanceNotificationDelivery({ current: "SENDING", attempt, now, event: { kind: "SEND_FAILED", errorCode: "TIMEOUT" } });
  assert.equal(state.nextAttemptAt, "2026-08-17T09:08:00.000Z");
  attempt = notificationRetryDelayMinutes.length + 1;
  state = advanceNotificationDelivery({ current: "SENDING", attempt, now, event: { kind: "SEND_FAILED", errorCode: "TIMEOUT" } });
  assert.equal(state.state, "DEAD_LETTER");
  assert.equal(state.nextAttemptAt, null);
});

test("a bounce is terminal and never retried", () => {
  const bounced = advanceNotificationDelivery({ current: "PROVIDER_ACCEPTED", attempt: 1, now, event: { kind: "PROVIDER_BOUNCED", errorCode: "HARD_BOUNCE" } });
  assert.equal(bounced.state, "FAILED");
  assert.equal(bounced.nextAttemptAt, null);
});

test("a complaint unsubscribes the recipient", () => {
  const complained = advanceNotificationDelivery({ current: "DELIVERED", attempt: 1, now, event: { kind: "PROVIDER_COMPLAINED" } });
  assert.equal(complained.state, "UNSUBSCRIBED");
});

test("a delivered notification is never reopened by a late failure", () => {
  const late = advanceNotificationDelivery({ current: "DELIVERED", attempt: 1, now, event: { kind: "SEND_FAILED", errorCode: "TIMEOUT" } });
  assert.equal(late.accepted, false);
  assert.equal(late.state, "DELIVERED");
});

test("replaying the same provider callback is idempotent", () => {
  const first = advanceNotificationDelivery({ current: "PROVIDER_ACCEPTED", attempt: 1, now, event: { kind: "PROVIDER_DELIVERED" } });
  const second = advanceNotificationDelivery({ current: first.state, attempt: 1, now, event: { kind: "PROVIDER_DELIVERED" } });
  assert.equal(second.state, "DELIVERED");
});

test("a dead-lettered notification stays dead until someone acts", () => {
  const retried = advanceNotificationDelivery({ current: "DEAD_LETTER", attempt: 9, now, event: { kind: "RETRY_DUE" } });
  assert.equal(retried.accepted, false);
  assert.equal(retried.state, "DEAD_LETTER");
});
