import "server-only";

import { createHash } from "node:crypto";

import { canDeliverAutopilotNotice, isAutopilotNoticeChannelReady, isAutopilotNoticeEnabled } from "@/lib/recovery/autopilot-switch";
import { isVetoTokenSecretValid } from "@/lib/recovery/veto-token";

const resendMessagesUrl = "https://api.resend.com/emails";

export type AutopilotMailerReadiness = {
  status: "off" | "channel-not-ready" | "credentials-missing" | "ready";
  missing: readonly string[];
};

export type AutopilotNoticeSendInput = {
  from: string;
  to: string;
  subject: string;
  text: string;
  idempotencyKey: string;
  tags?: ReadonlyArray<{ name: string; value: string }>;
};

export type AutopilotNoticeSendResult =
  | { status: "accepted"; providerMessageId: string }
  | { status: "not-ready"; reason: AutopilotMailerReadiness["status"] }
  | { status: "rejected"; errorCode: string };

let testNoticeSends: AutopilotNoticeSendInput[] = [];

function isAutopilotTestMailerActive(): boolean {
  return process.env.AUTOPILOT_TEST_ADAPTER === "true" && process.env.NODE_ENV !== "production";
}

export function drainAutopilotTestNoticeSends(): AutopilotNoticeSendInput[] {
  const sent = testNoticeSends;
  testNoticeSends = [];
  return sent;
}

export function getAutopilotMailerReadiness(): AutopilotMailerReadiness {
  if (!isAutopilotNoticeEnabled()) {
    return { status: "off", missing: ["AUTOPILOT_NOTICE_ENABLED"] };
  }
  if (isAutopilotTestMailerActive()) {
    const missing: string[] = [];
    if (!isAutopilotNoticeChannelReady()) missing.push("AUTOPILOT_NOTICE_CHANNEL_READY");
    if (!autopilotVetoTokenSecret()) missing.push("AUTOPILOT_VETO_TOKEN_SECRET");
    if (missing.length) return { status: "credentials-missing", missing };
    return { status: "ready", missing: [] };
  }
  const missing: string[] = [];
  if (!isAutopilotNoticeChannelReady()) {
    missing.push("AUTOPILOT_NOTICE_CHANNEL_READY");
  }
  if (!process.env.RESEND_API_KEY?.trim()) missing.push("RESEND_API_KEY");
  if (!autopilotNoticeFromEmail()) missing.push("RESEND_FROM_EMAIL");
  if (!autopilotNoticeWebhookSecret()) missing.push("RESEND_NOTICE_WEBHOOK_SECRET");
  if (!autopilotVetoTokenSecret()) missing.push("AUTOPILOT_VETO_TOKEN_SECRET");
  if (missing.includes("AUTOPILOT_NOTICE_CHANNEL_READY")) {
    return { status: "channel-not-ready", missing };
  }
  if (missing.length) return { status: "credentials-missing", missing };
  return { status: "ready", missing: [] };
}

export function isAutopilotMailerConfigured(): boolean {
  return getAutopilotMailerReadiness().status === "ready";
}

export function canQueueDeliverableAutopilotNotice(): boolean {
  return canDeliverAutopilotNotice() && isAutopilotMailerConfigured();
}

export function autopilotNoticeFromEmail(): string {
  return (process.env.RESEND_FROM_EMAIL ?? process.env.AUTOPILOT_NOTICE_FROM_EMAIL ?? "").trim();
}

export function autopilotNoticeWebhookSecret(): string {
  return (process.env.RESEND_NOTICE_WEBHOOK_SECRET ?? "").trim();
}

export function autopilotVetoTokenSecret(): string {
  const secret = (process.env.AUTOPILOT_VETO_TOKEN_SECRET ?? "").trim();
  return isVetoTokenSecretValid(secret) ? secret : "";
}

/** Production default is off. A test adapter must not become a live mailer. */
export async function sendAutopilotNotice(input: AutopilotNoticeSendInput): Promise<AutopilotNoticeSendResult> {
  if (process.env.NODE_ENV === "production" && process.env.AUTOPILOT_TEST_ADAPTER === "true") {
    return { status: "not-ready", reason: "off" };
  }
  const readiness = getAutopilotMailerReadiness();
  if (readiness.status !== "ready") return { status: "not-ready", reason: readiness.status };
  if (isAutopilotTestMailerActive()) {
    testNoticeSends.push(input);
    const providerMessageId = `test-${createHash("sha256").update(input.idempotencyKey).digest("hex").slice(0, 16)}`;
    return { status: "accepted", providerMessageId };
  }
  const response = await fetch(resendMessagesUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`,
      "content-type": "application/json",
      "idempotency-key": input.idempotencyKey,
    },
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      tags: input.tags,
    }),
  });
  if (!response.ok) {
    return { status: "rejected", errorCode: `resend-${response.status}` };
  }
  const payload = await response.json() as { id?: unknown };
  const providerMessageId = typeof payload.id === "string" ? payload.id.trim() : "";
  if (providerMessageId.length < 8) return { status: "rejected", errorCode: "resend-missing-id" };
  return { status: "accepted", providerMessageId };
}
