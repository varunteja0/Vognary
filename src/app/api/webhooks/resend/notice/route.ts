import { createHash } from "node:crypto";
import { Webhook } from "svix";
import { rateLimit } from "@/lib/rate-limit";
import { noticeProviderEventTypes } from "@/lib/recovery/notice-delivery";
import { hasAutopilotNoticeTag } from "@/lib/recovery/notice-payload";
import { isDatabaseConfigured } from "@/lib/server/database";
import { autopilotNoticeWebhookSecret } from "@/lib/server/autopilot-mailer";
import { applyAutopilotNoticeEvent } from "@/lib/server/recovery-autopilot-store";
import {
  assertContentType,
  readLimitedText,
  RequestBodyTooLargeError,
  UnsupportedContentTypeError,
} from "@/lib/server/request-body";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const maxBytes = 128 * 1024;

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) {
    return Response.json({ status: "not-available" }, { status: 501, headers: { "cache-control": "no-store" } });
  }
  const signingSecret = autopilotNoticeWebhookSecret();
  if (!signingSecret) {
    return Response.json({ status: "not-available" }, { status: 501, headers: { "cache-control": "no-store" } });
  }

  let raw: string;
  try {
    assertContentType(request, "application/json");
    raw = await readLimitedText(request, maxBytes);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return json("too-large", 413);
    if (error instanceof UnsupportedContentTypeError) return json("unsupported", 415);
    return json("invalid", 400);
  }

  const svixId = request.headers.get("svix-id")?.trim() ?? "";
  const svixTimestamp = request.headers.get("svix-timestamp")?.trim() ?? "";
  const svixSignature = request.headers.get("svix-signature")?.trim() ?? "";
  if (!svixId || !svixTimestamp || !svixSignature) return json("unauthorized", 401);

  let verified: unknown;
  try {
    verified = new Webhook(signingSecret).verify(raw, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    });
  } catch {
    return json("unauthorized", 401);
  }

  const record = asRecord(verified);
  const type = typeof record?.type === "string" ? record.type : "";
  if (!noticeProviderEventTypes.includes(type as (typeof noticeProviderEventTypes)[number])) {
    return json("ignored");
  }
  const data = asRecord(record?.data);
  const providerMessageId = typeof data?.email_id === "string" ? data.email_id.trim() : "";
  const occurredAt = typeof record?.created_at === "string" ? record.created_at : "";
  if (providerMessageId.length < 8 || !occurredAt) return json("ignored");
  if (!hasAutopilotNoticeTag(data?.tags)) return json("ignored");

  const rate = await rateLimit(request, {
    namespace: "resend-notice-webhook",
    limit: 300,
    windowMs: 60_000,
    requireShared: true,
    identity: "provider:resend-notice",
  });
  if (!rate.allowed) return json("retry", 503);

  const result = await applyAutopilotNoticeEvent({
    providerEventId: svixId,
    type: type as (typeof noticeProviderEventTypes)[number],
    providerMessageId,
    occurredAt,
    payloadHash: createHash("sha256").update(raw).digest("hex"),
    tagged: true,
  });
  if (result.status === "pending") return json("pending", 503);
  return json(result.status);
}

function json(status: string, httpStatus = 200) {
  return Response.json({ status }, { status: httpStatus, headers: { "cache-control": "no-store" } });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
