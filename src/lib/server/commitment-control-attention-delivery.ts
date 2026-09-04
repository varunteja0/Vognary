import "server-only";

import {
  claimDueControlAttentionNotifications,
  recordControlAttentionProviderAccepted,
  recordControlAttentionSendFailure,
  scheduleControlAttentionNotifications,
  type ClaimedControlAttentionNotification,
} from "@/lib/server/commitment-control-attention-store";
import {
  checkControlAttentionEmailConfiguration,
  ControlAttentionDeliveryError,
  sendControlAttentionEmail,
} from "@/lib/server/commitment-control-attention-mailer";

export type ControlAttentionDeliverySummary = {
  status: "completed" | "completed-with-failures" | "not-configured";
  scheduled: number;
  selected: number;
  providerAccepted: number;
  retryScheduled: number;
  failed: number;
  deadLettered: number;
  cancelled: number;
  suppressed: number;
  unsubscribed: number;
};

export async function deliverControlAttentionNotifications(input: {
  workspaceIds: readonly string[];
  now: Date;
  lockOwner: string;
  today?: string;
  limit?: number;
}): Promise<ControlAttentionDeliverySummary> {
  const scheduled = await scheduleControlAttentionNotifications({
    workspaceIds: input.workspaceIds,
    now: input.now,
    today: input.today,
  });
  const base = {
    scheduled: scheduled.enqueued,
    selected: 0,
    providerAccepted: 0,
    retryScheduled: 0,
    failed: 0,
    deadLettered: 0,
    cancelled: scheduled.cancelled,
    suppressed: 0,
    unsubscribed: 0,
  };
  if (checkControlAttentionEmailConfiguration().status !== "ready") {
    return { status: "not-configured", ...base };
  }

  const claimed = await claimDueControlAttentionNotifications({
    workspaceIds: input.workspaceIds,
    now: input.now,
    lockOwner: input.lockOwner,
    limit: input.limit,
    today: input.today,
  });
  const outcomes = await mapWithConcurrency(claimed.ready, 3, (notification) =>
    deliverClaimedControlAttentionNotification(notification, input.now));

  const providerAccepted = count(outcomes, "providerAccepted");
  const retryScheduled = count(outcomes, "retryScheduled");
  const failed = count(outcomes, "failed") + count(outcomes, "persistenceFailed");
  const deadLettered = claimed.deadLettered + count(outcomes, "deadLettered");
  return {
    status: retryScheduled || failed || deadLettered ? "completed-with-failures" : "completed",
    scheduled: scheduled.enqueued,
    selected: claimed.ready.length,
    providerAccepted,
    retryScheduled,
    failed,
    deadLettered,
    cancelled: scheduled.cancelled + claimed.cancelled,
    suppressed: claimed.suppressed,
    unsubscribed: claimed.unsubscribed,
  };
}

type ControlAttentionDeliveryOutcome =
  | "providerAccepted"
  | "retryScheduled"
  | "failed"
  | "deadLettered"
  | "persistenceFailed";

type ControlAttentionDeliveryDependencies = {
  send: typeof sendControlAttentionEmail;
  accept: typeof recordControlAttentionProviderAccepted;
  fail: typeof recordControlAttentionSendFailure;
};

const defaultDeliveryDependencies: ControlAttentionDeliveryDependencies = {
  send: sendControlAttentionEmail,
  accept: recordControlAttentionProviderAccepted,
  fail: recordControlAttentionSendFailure,
};

export async function deliverClaimedControlAttentionNotification(
  notification: ClaimedControlAttentionNotification,
  now: Date,
  dependencies: ControlAttentionDeliveryDependencies = defaultDeliveryDependencies,
): Promise<ControlAttentionDeliveryOutcome> {
  let accepted: { providerMessageId: string };
  try {
    accepted = await dependencies.send({
      notificationId: notification.id,
      email: notification.recipientEmail,
      item: notification.item,
    });
  } catch (error) {
    const deliveryError = error instanceof ControlAttentionDeliveryError
      ? error
      : new ControlAttentionDeliveryError("unknown", true);
    const transition = await dependencies.fail({
      notificationId: notification.id,
      errorCode: deliveryError.code,
      retryable: deliveryError.retryable,
      now,
    });
    if (transition.state === "RETRY_SCHEDULED") return "retryScheduled";
    if (transition.state === "DEAD_LETTER") return "deadLettered";
    return "failed";
  }

  try {
    await dependencies.accept({
      notificationId: notification.id,
      providerMessageId: accepted.providerMessageId,
      now,
    });
    return "providerAccepted";
  } catch {
    // The provider accepted the idempotent send. Leave the SENDING lease for
    // stale-lock recovery; treating this as a send failure would spend retries
    // on a message that may already be in the recipient's inbox.
    return "persistenceFailed";
  }
}

async function mapWithConcurrency<T, R>(items: readonly T[], concurrency: number, task: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await task(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function count<T>(items: readonly T[], value: T) {
  return items.filter((item) => item === value).length;
}