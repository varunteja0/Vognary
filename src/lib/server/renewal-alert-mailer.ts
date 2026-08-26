import "server-only";

import {
  buildRenewalAlertEmail,
  buildWeeklyDigestEmail,
  type RenewalAlertFailureCode,
  type RenewalAlertWindow,
  type WeeklyDigestEmailInput,
} from "@/lib/renewal-alerts";
import { ResendDeliveryError, sendWithResend as deliverWithResend } from "@/lib/server/resend-mailer";

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

  return deliverRenewalEmail({ email: input.email, idempotencyKey: `renewal-alert/${input.deliveryId}`, message });
}

export async function sendWeeklyDigestEmail(input: Omit<WeeklyDigestEmailInput, "appBaseUrl"> & { deliveryId: string; email: string }) {
  const appBaseUrl = readAppBaseUrl();
  if (!appBaseUrl) throw new RenewalAlertDeliveryError("configuration", false);
  const message = buildWeeklyDigestEmail({ ...input, appBaseUrl });
  return deliverRenewalEmail({ email: input.email, idempotencyKey: `weekly-digest/${input.deliveryId}`, message });
}

async function deliverRenewalEmail(input: {
  email: string;
  idempotencyKey: string;
  message: { subject: string; text: string; html: string };
}) {
  try {
    await deliverWithResend(input);
  } catch (error) {
    if (error instanceof ResendDeliveryError) {
      throw new RenewalAlertDeliveryError(error.code as RenewalAlertFailureCode, error.retryable);
    }
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
