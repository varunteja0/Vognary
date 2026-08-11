import "server-only";

import { createHash } from "node:crypto";
import { Webhook } from "svix";
import {
  assertContentType,
  readLimitedText,
  RequestBodyTooLargeError,
  UnsupportedContentTypeError,
} from "@/lib/server/request-body";

export const resendInboundWebhookMaxBytes = 128 * 1024;

export type ResendReceivedEvent = {
  svixId: string;
  emailId: string;
  recipient: string;
  createdAt: string;
  payloadHash: string;
};

export class ResendInboundRetryableError extends Error {
  constructor(internalMessage: string) {
    super(internalMessage);
    this.name = "ResendInboundRetryableError";
  }
}

type ResendInboundProcessor = (event: ResendReceivedEvent) => Promise<{
  status: "processed" | "duplicate" | "ignored";
}>;

export function createResendInboundHandler(input: {
  signingSecret: string;
  processReceived: ResendInboundProcessor;
}) {
  const webhook = new Webhook(input.signingSecret);

  return async function handleResendInbound(request: Request) {
    let raw: string;
    try {
      assertContentType(request, "application/json");
      raw = await readLimitedText(request, resendInboundWebhookMaxBytes);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) return genericResponse("too-large", 413);
      if (error instanceof UnsupportedContentTypeError) return genericResponse("unsupported", 415);
      return genericResponse("invalid", 400);
    }

    const svixId = request.headers.get("svix-id")?.trim() ?? "";
    const svixTimestamp = request.headers.get("svix-timestamp")?.trim() ?? "";
    const svixSignature = request.headers.get("svix-signature")?.trim() ?? "";
    if (!boundedHeader(svixId) || !boundedHeader(svixTimestamp) || !boundedHeader(svixSignature, 2_000)) {
      return genericResponse("unauthorized", 401);
    }

    let verified: unknown;
    try {
      verified = webhook.verify(raw, {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": svixSignature,
      });
    } catch {
      return genericResponse("unauthorized", 401);
    }

    const record = asRecord(verified);
    if (!record || typeof record.type !== "string") return genericResponse("ignored");
    if (record.type !== "email.received") return genericResponse("ignored");
    const data = asRecord(record.data);
    const recipients = Array.isArray(data?.to) ? data.to.filter((value): value is string => typeof value === "string") : [];
    const emailId = typeof data?.email_id === "string" ? data.email_id.trim() : "";
    const createdAt = typeof record.created_at === "string" ? normalizeTimestamp(record.created_at) : null;
    if (!boundedHeader(emailId) || recipients.length !== 1 || !boundedEmail(recipients[0]) || !createdAt) {
      return genericResponse("ignored");
    }

    try {
      const result = await input.processReceived({
        svixId,
        emailId,
        recipient: recipients[0].trim().toLowerCase(),
        createdAt,
        payloadHash: createHash("sha256").update(raw).digest("hex"),
      });
      return genericResponse(result.status);
    } catch (error) {
      if (error instanceof ResendInboundRetryableError) return genericResponse("retry", 503);
      return genericResponse("retry", 503);
    }
  };
}

function genericResponse(status: string, httpStatus = 200) {
  return Response.json({ status }, {
    status: httpStatus,
    headers: { "cache-control": "no-store" },
  });
}

function boundedHeader(value: string, maximum = 240) {
  return value.length >= 1 && value.length <= maximum && !/[\r\n]/.test(value);
}

function boundedEmail(value: string) {
  const normalized = value.trim();
  return normalized.length <= 320 && /^\S+@\S+\.\S+$/.test(normalized);
}

function normalizeTimestamp(value: string) {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}