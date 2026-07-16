import { getConnectorById } from "@/lib/connectors";
import { connectorWebhookSecretEnvVar, verifyWebhookSignature } from "@/lib/webhook-signature";
import { persistConnectorWebhookEvent } from "@/lib/server/webhook-store";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ConnectorWebhookRouteContext = {
  params: Promise<{ id: string }>;
};

const maxWebhookBodyBytes = 1_000_000;

export async function POST(request: Request, context: ConnectorWebhookRouteContext) {
  const limit = await rateLimit(request, { namespace: "connector-webhook", limit: 120, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const { id } = await context.params;
  const connector = getConnectorById(id);
  if (!connector) return Response.json({ error: "Connector not found." }, { status: 404 });

  const contentLength = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
  if (contentLength > maxWebhookBodyBytes) {
    return Response.json({ error: "Webhook payload is too large." }, { status: 413 });
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > maxWebhookBodyBytes) {
    return Response.json({ error: "Webhook payload is too large." }, { status: 413 });
  }

  const signature = verifyWebhookSignature(id, rawBody, request.headers.get("x-vognary-signature"));

  if (signature.reason === "missing-secret") {
    return Response.json({
      status: "not-configured",
      requiredEnv: [signature.secretEnvVar ?? connectorWebhookSecretEnvVar(id), "CONNECTOR_WEBHOOK_SECRET"],
      message: "Configure a connector-specific or global webhook secret before accepting provider webhooks.",
    }, { status: 501 });
  }

  if (!signature.ok) {
    return Response.json({ error: "Invalid webhook signature.", reason: signature.reason }, { status: 401 });
  }

  const payload = parsePayload(rawBody);
  const providerEventId = request.headers.get("x-vognary-event-id") || readString(payload.id) || readString(payload.event_id);
  const eventType = request.headers.get("x-vognary-event-type") || readString(payload.type) || "connector.webhook";
  const persistence = await persistConnectorWebhookEvent({
    connectorId: id,
    providerEventId,
    eventType,
    signatureValid: true,
    rawBody,
    payload,
  });

  if (persistence.status === "not-persisted") {
    return Response.json({
      status: "not-configured",
      connectorId: id,
      requiredEnv: ["DATABASE_URL"],
      message: "Durable webhook storage is not configured. The event was not accepted.",
    }, { status: 501 });
  }

  return Response.json({
    status: "accepted",
    connectorId: id,
    eventType,
    providerEventId,
    persistence,
  }, { status: 202 });
}

function parsePayload(rawBody: string): Record<string, unknown> {
  try {
    const value = JSON.parse(rawBody) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : { value };
  } catch {
    return { raw: rawBody };
  }
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
