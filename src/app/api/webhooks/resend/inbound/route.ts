import { rateLimit } from "@/lib/rate-limit";
import { isDatabaseConfigured } from "@/lib/server/database";
import { reportServerError } from "@/lib/server/monitoring";
import { getReceiptInboxConfiguration } from "@/lib/server/recovery-inbound-store";
import {
  createResendInboundHandler,
  ResendInboundRetryableError,
} from "@/lib/server/recovery-inbound-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) return unavailable();
  const readiness = getReceiptInboxConfiguration();
  if (readiness.status !== "ready") return unavailable();

  const handler = createResendInboundHandler({
    signingSecret: readiness.configuration.webhookSecret,
    reportProcessingFailure: (error, context) => reportServerError(error, {
      path: "/api/webhooks/resend/inbound",
      method: "POST",
      headers: {},
    }, context),
    processReceived: async (event) => {
      const rate = await rateLimit(request, {
        namespace: "resend-inbound-webhook",
        limit: 300,
        windowMs: 60_000,
        requireShared: true,
        identity: "provider:resend",
      });
      if (!rate.allowed) throw new ResendInboundRetryableError("Verified provider rate limit unavailable or exceeded.");
      const { processResendReceivedEvent } = await import("@/lib/server/recovery-inbound-processor");
      return processResendReceivedEvent(event);
    },
  });
  return handler(request);
}

function unavailable() {
  return Response.json({ status: "not-available" }, {
    status: 501,
    headers: { "cache-control": "no-store" },
  });
}
