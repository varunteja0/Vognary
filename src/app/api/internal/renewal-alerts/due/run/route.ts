import { randomUUID } from "node:crypto";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { explicitCommitmentControlWorkspaceIds } from "@/lib/commitment-control/enrollment";
import { deliverControlAttentionNotifications, type ControlAttentionDeliverySummary } from "@/lib/server/commitment-control-attention-delivery";
import { isDatabaseConfigured } from "@/lib/server/database";
import { requireCronSecret, requireInternalSecret } from "@/lib/server/internal-auth";
import { checkRenewalAlertEmailConfiguration, RenewalAlertDeliveryError, sendRenewalAlertEmail, sendWeeklyDigestEmail } from "@/lib/server/renewal-alert-mailer";
import {
  claimDueRenewalAlerts,
  claimDueWeeklyDigests,
  isRenewalAlertStillDeliverable,
  isWeeklyDigestStillDeliverable,
  markRenewalAlertCancelled,
  markRenewalAlertFailed,
  markRenewalAlertSent,
  markWeeklyDigestCancelled,
  markWeeklyDigestFailed,
  markWeeklyDigestSent,
  scheduleDueWeeklyDigests,
} from "@/lib/server/renewal-alert-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const noStoreHeaders = { "cache-control": "no-store", pragma: "no-cache" };

export async function GET(request: Request) {
  const authorization = requireCronSecret(request);
  if (authorization) return authorization;
  return deliverDueRenewalAlerts(request, "cron");
}

export async function POST(request: Request) {
  const authorization = requireInternalSecret(request);
  if (authorization) return authorization;
  return deliverDueRenewalAlerts(request, "internal-api");
}

async function deliverDueRenewalAlerts(request: Request, invocation: "internal-api" | "cron") {
  const limit = await rateLimit(request, { namespace: "internal-renewal-alert-delivery", limit: 20, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);
  if (!isDatabaseConfigured()) {
    return Response.json({ status: "not-configured", requiredEnv: ["DATABASE_URL"] }, { status: 501, headers: noStoreHeaders });
  }

  const emailConfiguration = checkRenewalAlertEmailConfiguration();
  if (emailConfiguration.status !== "ready") {
    return Response.json({
      status: "not-configured",
      requiredEnv: emailConfiguration.missing,
      message: "Renewal alert delivery remains inactive until its email configuration is complete.",
    }, { status: 501, headers: noStoreHeaders });
  }

  const url = new URL(request.url);
  const batchSize = clampNumber(Number.parseInt(url.searchParams.get("limit") ?? "10", 10), 1, 25);
  const workerId = `renewal-alert-${randomUUID()}`;
  const controlWorkspaceIds = explicitCommitmentControlWorkspaceIds();
  const controlAttentionPromise: Promise<ControlAttentionDeliverySummary | null> = controlWorkspaceIds.length
    ? deliverControlAttentionNotifications({
      workspaceIds: controlWorkspaceIds,
      now: new Date(),
      lockOwner: `${workerId}-control`,
      limit: batchSize,
    }).catch(() => failedControlAttentionSummary())
    : Promise.resolve(null);
  await scheduleDueWeeklyDigests();
  const deliveries = await claimDueRenewalAlerts({ limit: batchSize, workerId, invocation });
  const weeklyDigests = await claimDueWeeklyDigests({ limit: batchSize, workerId, invocation });
  const reminderOutcomes = await mapWithConcurrency(deliveries, 3, async (delivery) => {
    if (!await isRenewalAlertStillDeliverable(delivery.deliveryId, workerId)) {
      await markRenewalAlertCancelled(delivery.deliveryId, workerId);
      return "cancelled" as const;
    }

    try {
      await sendRenewalAlertEmail({
        deliveryId: delivery.deliveryId,
        email: delivery.email,
        merchant: delivery.merchant,
        renewalDate: delivery.renewalDate,
        alertWindow: delivery.alertWindow,
      });
      await markRenewalAlertSent(delivery.deliveryId, workerId);
      return "sent" as const;
    } catch (error) {
      const deliveryError = error instanceof RenewalAlertDeliveryError
        ? error
        : new RenewalAlertDeliveryError("unknown", true);
      await markRenewalAlertFailed({
        deliveryId: delivery.deliveryId,
        workerId,
        errorCode: deliveryError.code,
        retryable: deliveryError.retryable,
      });
      return "failed" as const;
    }
  });
  const digestOutcomes = await mapWithConcurrency(weeklyDigests, 3, async (delivery) => {
    if (!await isWeeklyDigestStillDeliverable(delivery.deliveryId, workerId)) {
      await markWeeklyDigestCancelled(delivery.deliveryId, workerId);
      return "cancelled" as const;
    }

    try {
      await sendWeeklyDigestEmail(delivery);
      await markWeeklyDigestSent(delivery.deliveryId, workerId);
      return "sent" as const;
    } catch (error) {
      const deliveryError = error instanceof RenewalAlertDeliveryError
        ? error
        : new RenewalAlertDeliveryError("unknown", true);
      await markWeeklyDigestFailed({
        deliveryId: delivery.deliveryId,
        workerId,
        errorCode: deliveryError.code,
        retryable: deliveryError.retryable,
      });
      return "failed" as const;
    }
  });

  const outcomes = [...reminderOutcomes, ...digestOutcomes];
  const sent = outcomes.filter((outcome) => outcome === "sent").length;
  const failed = outcomes.filter((outcome) => outcome === "failed").length;
  const cancelled = outcomes.filter((outcome) => outcome === "cancelled").length;
  const controlAttention = await controlAttentionPromise;
  const controlFailed = controlAttention !== null && controlAttention.status !== "completed";
  return Response.json({
    status: failed || controlFailed ? "completed-with-failures" : "completed",
    selected: outcomes.length,
    remindersSelected: deliveries.length,
    weeklyDigestsSelected: weeklyDigests.length,
    sent,
    failed,
    cancelled,
    controlAttention,
    invocation,
  }, { status: failed || controlFailed ? 207 : 200, headers: noStoreHeaders });
}

function failedControlAttentionSummary(): ControlAttentionDeliverySummary {
  return {
    status: "completed-with-failures",
    scheduled: 0,
    selected: 0,
    providerAccepted: 0,
    retryScheduled: 0,
    failed: 1,
    deadLettered: 0,
    cancelled: 0,
    suppressed: 0,
    unsubscribed: 0,
  };
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, task: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await task(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(value, max));
}
