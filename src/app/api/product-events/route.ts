import { type ProductEventInput, productEventNames } from "@/lib/product-events";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { hasActiveConsentGrant } from "@/lib/server/consent-store";
import { isDatabaseConfigured } from "@/lib/server/database";
import { recordProductEvent } from "@/lib/server/product-event-store";
import { readLimitedJson, RequestBodyTooLargeError, UnsupportedContentTypeError } from "@/lib/server/request-body";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import { requireSession } from "@/lib/server/workspace-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const clientEventNames = new Set([
  "workspace.activated",
  "ledger.viewed",
  "review.action_recorded",
  "review.completed",
  "export.created",
]);

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;

  const limit = await rateLimit(request, { namespace: "product-events-write", limit: 120, windowMs: 60 * 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const session = await requireSession(request);
  if (session instanceof Response) return session;
  if (!session.workspaceId) return Response.json({ error: "Session has no workspace." }, { status: 400 });
  if (!isDatabaseConfigured()) return Response.json({ status: "not-configured" }, { status: 501 });

  const body = await readEventBody(request);
  if (body instanceof Response) return body;
  if (typeof body.eventName !== "string" || !clientEventNames.has(body.eventName)) {
    return Response.json({ error: "Product event is not allowlisted." }, { status: 400 });
  }

  const consented = await hasActiveConsentGrant({
    userId: session.userId,
    email: session.email,
    workspaceId: session.workspaceId,
    purpose: "product-analytics-opt-in",
  });
  if (!consented) return new Response(null, { status: 202 });

  try {
    const input: ProductEventInput = {
      workspaceId: session.workspaceId,
      userId: session.userId,
      eventName: body.eventName as (typeof productEventNames)[number],
      source: "product-ui",
      status: "succeeded",
      metrics: readMetrics(body.metrics),
    };
    const event = await recordProductEvent(input);
    return Response.json({ status: "recorded", id: event.id }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Product event was rejected." }, { status: 400 });
  }
}

async function readEventBody(request: Request): Promise<Record<string, unknown> | Response> {
  try {
    return await readLimitedJson<Record<string, unknown>>(request, 4 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return Response.json({ error: "Product event is too large." }, { status: 413 });
    if (error instanceof UnsupportedContentTypeError) return Response.json({ error: "Content-Type must be application/json." }, { status: 415 });
    return Response.json({ error: "Product event must be valid JSON." }, { status: 400 });
  }
}

function readMetrics(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const metrics: Record<string, number> = {};
  for (const key of ["recordsSeen", "evidenceWritten", "transactionsWritten", "commitmentsTouched", "usageObservationsWritten"]) {
    const metric = input[key];
    if (typeof metric === "number") metrics[key] = metric;
  }
  return metrics;
}
