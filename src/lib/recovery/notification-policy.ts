import type { ChangeMateriality, ChangeSignal } from "@/lib/recovery/change-intelligence";

/**
 * Notification policy and delivery.
 *
 * Two rules dominate this module. Silence is success: when nothing material
 * changed, nothing is planned and nothing is scheduled. And nothing may ever be
 * described as delivered until the provider says so — acceptance by a provider
 * is not delivery, and `DELIVERED` is reachable only from a provider callback.
 *
 * Sending is fail-closed. With no configured, enabled channel, every email plan
 * is suppressed with a stated reason rather than queued for a later surprise.
 */
export const notificationChannels = ["IN_APP", "EMAIL"] as const;
export type NotificationChannel = (typeof notificationChannels)[number];

export const notificationDeliveryStates = [
  "QUEUED",
  "SENDING",
  "PROVIDER_ACCEPTED",
  "DELIVERED",
  "FAILED",
  "RETRY_SCHEDULED",
  "DEAD_LETTER",
  "SUPPRESSED",
  "UNSUBSCRIBED",
] as const;
export type NotificationDeliveryState = (typeof notificationDeliveryStates)[number];

export const notificationSuppressionReasons = [
  "ALREADY_NOTIFIED",
  "BELOW_MATERIALITY",
  "NO_CONSENT",
  "UNSUBSCRIBED",
  "CHANNEL_NOT_READY",
] as const;
export type NotificationSuppressionReason = (typeof notificationSuppressionReasons)[number];

/** Backoff for transient send failures, in minutes. Length is the retry budget. */
export const notificationRetryDelayMinutes = [2, 8, 32] as const;

const materialityRank: Record<ChangeMateriality, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const immediateMateriality = new Set<ChangeMateriality>(["CRITICAL", "HIGH"]);

export type NotificationConsent = {
  productEmails: boolean;
  unsubscribedAt: string | null;
};

export type PlannedNotification = {
  dedupeKey: string;
  channel: NotificationChannel;
  materiality: ChangeMateriality;
  subject: string;
  body: string;
};

export type SuppressedNotification = {
  dedupeKey: string;
  channel: NotificationChannel;
  reason: NotificationSuppressionReason;
};

export type NotificationPlan = {
  immediate: readonly PlannedNotification[];
  digest: {
    scheduled: boolean;
    dueAt: string | null;
    items: readonly PlannedNotification[];
  };
  suppressed: readonly SuppressedNotification[];
};

function toPlanned(signal: ChangeSignal): PlannedNotification {
  return {
    dedupeKey: signal.dedupeKey,
    channel: "EMAIL",
    materiality: signal.materiality,
    subject: signal.title,
    body: signal.detail,
  };
}

export function planNotifications(input: {
  now: string;
  signals: readonly ChangeSignal[];
  consent: NotificationConsent;
  /** True only when a real provider is configured and enabled for this deployment. */
  channelReady: boolean;
  minimumMateriality: ChangeMateriality;
  alreadyPlanned: readonly { dedupeKey: string; channel: NotificationChannel }[];
  digest: { lastSentAt: string | null; intervalHours: number };
}): NotificationPlan {
  const empty: NotificationPlan = { immediate: [], digest: { scheduled: false, dueAt: null, items: [] }, suppressed: [] };
  if (!input.signals.length) return empty;

  const alreadyEmailed = new Set(
    input.alreadyPlanned.filter((entry) => entry.channel === "EMAIL").map((entry) => entry.dedupeKey),
  );
  const suppressed: SuppressedNotification[] = [];
  const eligible: ChangeSignal[] = [];

  const ordered = input.signals.slice().sort((left, right) =>
    materialityRank[left.materiality] - materialityRank[right.materiality]
    || left.dedupeKey.localeCompare(right.dedupeKey));

  for (const signal of ordered) {
    const suppress = (reason: NotificationSuppressionReason) =>
      suppressed.push({ dedupeKey: signal.dedupeKey, channel: "EMAIL", reason });

    if (alreadyEmailed.has(signal.dedupeKey)) { suppress("ALREADY_NOTIFIED"); continue; }
    if (input.consent.unsubscribedAt) { suppress("UNSUBSCRIBED"); continue; }
    if (!input.consent.productEmails) { suppress("NO_CONSENT"); continue; }
    if (!input.channelReady) { suppress("CHANNEL_NOT_READY"); continue; }
    if (materialityRank[signal.materiality] > materialityRank[input.minimumMateriality]) { suppress("BELOW_MATERIALITY"); continue; }
    eligible.push(signal);
  }

  const immediate = eligible.filter((signal) => immediateMateriality.has(signal.materiality)).map(toPlanned);
  const digestItems = eligible.filter((signal) => !immediateMateriality.has(signal.materiality)).map(toPlanned);
  const anchor = input.digest.lastSentAt ?? input.now;
  const dueAt = digestItems.length
    ? new Date(Date.parse(anchor) + input.digest.intervalHours * 60 * 60 * 1_000).toISOString()
    : null;

  return {
    immediate,
    digest: { scheduled: digestItems.length > 0, dueAt, items: digestItems },
    suppressed,
  };
}

export type NotificationDeliveryEvent =
  | { kind: "QUEUE" }
  | { kind: "SEND_STARTED" }
  | { kind: "PROVIDER_ACCEPTED" }
  | { kind: "PROVIDER_DELIVERED" }
  | { kind: "PROVIDER_BOUNCED"; errorCode: string }
  | { kind: "PROVIDER_COMPLAINED" }
  | { kind: "SEND_FAILED"; errorCode: string }
  | { kind: "RETRY_DUE" }
  | { kind: "UNSUBSCRIBE" };

export type NotificationDeliveryTransition = {
  accepted: boolean;
  previousState: NotificationDeliveryState;
  state: NotificationDeliveryState;
  nextAttemptAt: string | null;
  reasons: readonly string[];
};

const terminalStates = new Set<NotificationDeliveryState>(["DELIVERED", "FAILED", "DEAD_LETTER", "UNSUBSCRIBED", "SUPPRESSED"]);

function refuse(current: NotificationDeliveryState, reason: string): NotificationDeliveryTransition {
  return { accepted: false, previousState: current, state: current, nextAttemptAt: null, reasons: [reason] };
}

export function advanceNotificationDelivery(input: {
  current: NotificationDeliveryState;
  attempt: number;
  now: string;
  event: NotificationDeliveryEvent;
}): NotificationDeliveryTransition {
  const { current, event } = input;

  if (event.kind === "UNSUBSCRIBE" || event.kind === "PROVIDER_COMPLAINED") {
    return {
      accepted: true,
      previousState: current,
      state: "UNSUBSCRIBED",
      nextAttemptAt: null,
      reasons: ["This recipient will not receive further product email."],
    };
  }

  if (current === "DELIVERED" && event.kind === "PROVIDER_DELIVERED") {
    return { accepted: true, previousState: current, state: "DELIVERED", nextAttemptAt: null, reasons: ["The provider already confirmed delivery."] };
  }

  if (terminalStates.has(current)) {
    return refuse(current, "This notification has already reached a final state.");
  }

  switch (event.kind) {
    case "QUEUE":
      return { accepted: true, previousState: current, state: "QUEUED", nextAttemptAt: null, reasons: ["Waiting to be sent."] };

    case "SEND_STARTED":
      if (current !== "QUEUED" && current !== "RETRY_SCHEDULED") return refuse(current, "There is nothing queued to send.");
      return { accepted: true, previousState: current, state: "SENDING", nextAttemptAt: null, reasons: ["Being sent now."] };

    case "PROVIDER_ACCEPTED":
      if (current !== "SENDING") return refuse(current, "Nothing was being sent, so it cannot be accepted.");
      return {
        accepted: true,
        previousState: current,
        state: "PROVIDER_ACCEPTED",
        nextAttemptAt: null,
        reasons: ["The email provider took the message. That does not confirm it reached the inbox."],
      };

    case "PROVIDER_DELIVERED":
      if (current !== "PROVIDER_ACCEPTED") return refuse(current, "Delivery can only be recorded after the provider accepted the message.");
      return { accepted: true, previousState: current, state: "DELIVERED", nextAttemptAt: null, reasons: ["The provider confirmed delivery."] };

    case "PROVIDER_BOUNCED":
      return {
        accepted: true,
        previousState: current,
        state: "FAILED",
        nextAttemptAt: null,
        reasons: ["The address rejected the message, so retrying would not help."],
      };

    case "SEND_FAILED": {
      const delay = notificationRetryDelayMinutes[input.attempt - 1];
      if (delay === undefined) {
        return {
          accepted: true,
          previousState: current,
          state: "DEAD_LETTER",
          nextAttemptAt: null,
          reasons: ["Sending kept failing, so this needs a person to look at it."],
        };
      }
      return {
        accepted: true,
        previousState: current,
        state: "RETRY_SCHEDULED",
        nextAttemptAt: new Date(Date.parse(input.now) + delay * 60 * 1_000).toISOString(),
        reasons: ["Sending failed. We will try again shortly."],
      };
    }

    case "RETRY_DUE":
      if (current !== "RETRY_SCHEDULED") return refuse(current, "There is no scheduled retry.");
      return { accepted: true, previousState: current, state: "QUEUED", nextAttemptAt: null, reasons: ["Queued for another attempt."] };
  }
}
