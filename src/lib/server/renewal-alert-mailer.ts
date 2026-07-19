import "server-only";

import {
  buildRenewalAlertEmail,
  buildWeeklyDigestEmail,
  type RenewalAlertFailureCode,
  type RenewalAlertWindow,
  type WeeklyDigestEmailInput,
} from "@/lib/renewal-alerts";

const resendTimeoutMs = 8_000;

export class RenewalAlertDeliveryError extends Error {
  constructor(
    public readonly code: RenewalAlertFailureCode,
    public readonly retryable: boolean,
  ) {
    super(`Renewal alert delivery failed (${code}).`);
    this.name = "RenewalAlertDeliveryError";
  }
}

export function checkRenewalAlertEmailConfiguration() {
  const missing = [
    process.env.RESEND_API_KEY?.trim() ? null : "RESEND_API_KEY",
    process.env.RESEND_FROM_EMAIL?.trim() ? null : "RESEND_FROM_EMAIL",
    readAppBaseUrl() ? null : "NEXT_PUBLIC_APP_URL",
  ].filter((value): value is string => Boolean(value));

  return { status: missing.length ? "not-configured" as const : "ready" as const, missing };
}

export async function sendRenewalAlertEmail(input: {
  deliveryId: string;
  email: string;
  merchant: string;
  renewalDate: string;
  alertWindow: RenewalAlertWindow;
}) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  const appBaseUrl = readAppBaseUrl();
  if (!apiKey || !from || !appBaseUrl) throw new RenewalAlertDeliveryError("configuration", false);

  const message = buildRenewalAlertEmail({
    merchant: input.merchant,
    renewalDate: input.renewalDate,
    alertWindow: input.alertWindow,
    appBaseUrl,
  });

  return sendWithResend({ email: input.email, idempotencyKey: `renewal-alert/${input.deliveryId}`, message });
}

export async function sendWeeklyDigestEmail(input: Omit<WeeklyDigestEmailInput, "appBaseUrl"> & { deliveryId: string; email: string }) {
  const appBaseUrl = readAppBaseUrl();
  if (!appBaseUrl) throw new RenewalAlertDeliveryError("configuration", false);
  const message = buildWeeklyDigestEmail({ ...input, appBaseUrl });
  return sendWithResend({ email: input.email, idempotencyKey: `weekly-digest/${input.deliveryId}`, message });
}

async function sendWithResend(input: {
  email: string;
  idempotencyKey: string;
  message: { subject: string; text: string; html: string };
}) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!apiKey || !from) throw new RenewalAlertDeliveryError("configuration", false);

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": input.idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to: input.email,
        subject: input.message.subject,
        text: input.message.text,
        html: input.message.html,
      }),
      signal: AbortSignal.timeout(resendTimeoutMs),
    });

    if (response.ok) return;
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 409) throw new RenewalAlertDeliveryError("provider_conflict", true);
    if (response.status === 429) throw new RenewalAlertDeliveryError("provider_rate_limited", true);
    if (response.status >= 500) throw new RenewalAlertDeliveryError("provider_unavailable", true);
    throw new RenewalAlertDeliveryError("provider_rejected", false);
  } catch (error) {
    if (error instanceof RenewalAlertDeliveryError) throw error;
    if (isTimeoutError(error)) throw new RenewalAlertDeliveryError("timeout", true);
    if (error instanceof TypeError) throw new RenewalAlertDeliveryError("network", true);
    throw new RenewalAlertDeliveryError("unknown", true);
  }
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

function isTimeoutError(error: unknown) {
  return error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError");
}
