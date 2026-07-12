import { randomUUID } from "node:crypto";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { isDatabaseConfigured } from "@/lib/server/database";
import { requireCronSecret, requireInternalSecret } from "@/lib/server/internal-auth";
import { checkRenewalAlertEmailConfiguration, RenewalAlertDeliveryError, sendRenewalAlertEmail } from "@/lib/server/renewal-alert-mailer";
import {
  claimDueRenewalAlerts,
  isRenewalAlertStillDeliverable,
  markRenewalAlertCancelled,
  markRenewalAlertFailed,
  markRenewalAlertSent,
} from "@/lib/server/renewal-alert-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const noStoreHeaders = { "cache-control": "no-store", pragma: "no-cache" };

export async function GET(request: Request) {
  const authorization = requireCronSecret(request);
  if (authorization) return authorization;
  return deliverDueRenewalAlerts(request);
}

export async function POST(request: Request) {
  const authorization = requireInternalSecret(request);
  if (authorization) return authorization;
  return deliverDueRenewalAlerts(request);
}

async function deliverDueRenewalAlerts(request: Request) {
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
  const deliveries = await claimDueRenewalAlerts({ limit: batchSize, workerId });
  const outcomes = await mapWithConcurrency(deliveries, 3, async (delivery) => {
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

  const sent = outcomes.filter((outcome) => outcome === "sent").length;
  const failed = outcomes.filter((outcome) => outcome === "failed").length;
  const cancelled = outcomes.filter((outcome) => outcome === "cancelled").length;
  return Response.json({
    status: failed ? "completed-with-failures" : "completed",
    selected: deliveries.length,
    sent,
    failed,
    cancelled,
  }, { status: failed ? 207 : 200, headers: noStoreHeaders });
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
