import "server-only";

import { createHash } from "node:crypto";

import type { ControlAttentionItem } from "@/lib/commitment-control/attention";

const resendMessagesUrl = "https://api.resend.com/emails";
const resendTimeoutMs = 8_000;

export const controlAttentionResendTag = { name: "vognary", value: "control-attention" } as const;

export type ControlAttentionDeliveryErrorCode =
  | "configuration"
  | "provider_conflict"
  | "provider_rate_limited"
  | "provider_unavailable"
  | "provider_rejected"
  | "provider_missing_id"
  | "timeout"
  | "network"
  | "unknown";

export class ControlAttentionDeliveryError extends Error {
  constructor(
    public readonly code: ControlAttentionDeliveryErrorCode,
    public readonly retryable: boolean,
  ) {
    super(`Control attention delivery failed (${code}).`);
    this.name = "ControlAttentionDeliveryError";
  }
}

export function checkControlAttentionEmailConfiguration() {
  if (process.env.NODE_ENV === "test" && !isControlAttentionTestMailerActive()) {
    return { status: "not-configured" as const, missing: ["CONTROL_ATTENTION_TEST_ADAPTER"] };
  }
  const missing = [
    process.env.RESEND_API_KEY?.trim() ? null : "RESEND_API_KEY",
    process.env.RESEND_FROM_EMAIL?.trim() ? null : "RESEND_FROM_EMAIL",
    readAppBaseUrl() ? null : "NEXT_PUBLIC_APP_URL",
    process.env.RESEND_NOTICE_WEBHOOK_SECRET?.trim() ? null : "RESEND_NOTICE_WEBHOOK_SECRET",
  ].filter((value): value is string => Boolean(value));
  if (isControlAttentionTestMailerActive()) return { status: "ready" as const, missing: [] as string[] };
  return { status: missing.length ? "not-configured" as const : "ready" as const, missing };
}

export function buildControlAttentionEmail(input: {
  item: ControlAttentionItem;
  appBaseUrl: string;
}) {
  const url = new URL("/app", input.appBaseUrl);
  url.searchParams.set("view", "CONTROL");
  url.searchParams.set("proposal", input.item.proposalId);
  const merchant = input.item.merchant;
  const subject = input.item.nextStep === "DECIDE_PROPOSAL"
    ? "Decision needed in Vognary"
    : input.item.nextStep === "LINK_EVIDENCE"
      ? "Evidence review needed in Vognary"
      : input.item.nextStep === "RECORD_OUTCOME"
        ? "Outcome review needed in Vognary"
        : input.item.nextStep === "REVIEW_EXCEPTION"
          ? "Commitment exception needs review in Vognary"
          : "Commitment review needed in Vognary";
  const text = [
    merchant,
    input.item.headline,
    input.item.body,
    `Due ${input.item.dueOn}.`,
    `Open ${url.toString()}`,
    "Vognary does not approve, purchase, provision, cancel, or move money. A workspace owner or admin decides.",
  ].join("\n");
  const html = `<p><strong>${escapeHtml(merchant)}</strong></p>`
    + `<p>${escapeHtml(input.item.headline)}</p>`
    + `<p>${escapeHtml(input.item.body)}</p>`
    + `<p>Due ${escapeHtml(input.item.dueOn)}.</p>`
    + `<p><a href="${escapeHtml(url.toString())}">Open Commitment Control</a></p>`
    + "<p>Vognary does not approve, purchase, provision, cancel, or move money. A workspace owner or admin decides.</p>";
  return { subject, text, html };
}

export async function sendControlAttentionEmail(input: {
  notificationId: string;
  email: string;
  item: ControlAttentionItem;
}): Promise<{ providerMessageId: string }> {
  const appBaseUrl = readAppBaseUrl();
  if (isControlAttentionTestMailerActive()) {
    return {
      providerMessageId: `test-${createHash("sha256").update(input.notificationId).digest("hex").slice(0, 16)}`,
    };
  }
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!apiKey || !from || !appBaseUrl || !process.env.RESEND_NOTICE_WEBHOOK_SECRET?.trim()) {
    throw new ControlAttentionDeliveryError("configuration", false);
  }
  const message = buildControlAttentionEmail({ item: input.item, appBaseUrl });

  try {
    const response = await fetch(resendMessagesUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": `control-attention/${input.notificationId}`,
      },
      body: JSON.stringify({
        from,
        to: [input.email],
        subject: message.subject,
        text: message.text,
        html: message.html,
        tags: [controlAttentionResendTag],
      }),
      signal: AbortSignal.timeout(resendTimeoutMs),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 409) throw new ControlAttentionDeliveryError("provider_conflict", true);
      if (response.status === 429) throw new ControlAttentionDeliveryError("provider_rate_limited", true);
      if (response.status >= 500) throw new ControlAttentionDeliveryError("provider_unavailable", true);
      throw new ControlAttentionDeliveryError("provider_rejected", false);
    }
    const payload = await response.json() as { id?: unknown };
    const providerMessageId = typeof payload.id === "string" ? payload.id.trim() : "";
    if (providerMessageId.length < 8) throw new ControlAttentionDeliveryError("provider_missing_id", true);
    return { providerMessageId };
  } catch (error) {
    if (error instanceof ControlAttentionDeliveryError) throw error;
    if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new ControlAttentionDeliveryError("timeout", true);
    }
    if (error instanceof TypeError) throw new ControlAttentionDeliveryError("network", true);
    throw new ControlAttentionDeliveryError("unknown", true);
  }
}

export function hasControlAttentionTag(tags: unknown): boolean {
  const matches = (name: unknown, value: unknown) => name === controlAttentionResendTag.name
    && value === controlAttentionResendTag.value;
  if (Array.isArray(tags)) {
    return tags.some((tag) => {
      if (!tag || typeof tag !== "object") return false;
      const record = tag as { name?: unknown; value?: unknown };
      return matches(record.name, record.value);
    });
  }
  if (!tags || typeof tags !== "object") return false;
  return matches(controlAttentionResendTag.name, (tags as Record<string, unknown>)[controlAttentionResendTag.name]);
}

function isControlAttentionTestMailerActive() {
  return process.env.CONTROL_ATTENTION_TEST_ADAPTER === "true" && process.env.NODE_ENV !== "production";
}

function readAppBaseUrl() {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;",
  })[character] ?? character);
}