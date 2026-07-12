import "server-only";

import type { BillingPlan } from "@/lib/billing";

const planAmountEnv: Record<BillingPlan, string> = {
  personal: "PAYMENT_AMOUNT_PERSONAL_INR",
  founder: "PAYMENT_AMOUNT_FOUNDER_INR",
  team: "PAYMENT_AMOUNT_TEAM_INR",
  annual: "PAYMENT_AMOUNT_ANNUAL_AUDIT_INR",
};

const planLinkEnv: Record<BillingPlan, string> = {
  personal: "PAYMENT_LINK_PERSONAL_PRO",
  founder: "PAYMENT_LINK_FOUNDER_PRO",
  team: "PAYMENT_LINK_TEAM",
  annual: "PAYMENT_LINK_ANNUAL_AUDIT",
};

export type BillingCheckoutConfiguration =
  | { status: "ready"; provider: "razorpay"; amountMinor: number; currency: "INR"; missing: [] }
  | { status: "link-only"; provider: "payment-link"; paymentUrl: string; missing: string[] }
  | { status: "not-configured"; provider: null; missing: string[] };

export function getBillingCheckoutConfiguration(plan: BillingPlan): BillingCheckoutConfiguration {
  const amount = parseRupeeAmount(process.env[planAmountEnv[plan]]);
  const appUrl = readAppUrl();
  const missing = [
    process.env.RAZORPAY_KEY_ID?.trim() ? null : "RAZORPAY_KEY_ID",
    process.env.RAZORPAY_KEY_SECRET?.trim() ? null : "RAZORPAY_KEY_SECRET",
    process.env.RAZORPAY_WEBHOOK_SECRET?.trim() ? null : "RAZORPAY_WEBHOOK_SECRET",
    amount ? null : `${planAmountEnv[plan]} (positive whole INR amount)`,
    appUrl ? null : "NEXT_PUBLIC_APP_URL",
  ].filter((value): value is string => Boolean(value));
  if (!missing.length && amount) return { status: "ready", provider: "razorpay", amountMinor: amount * 100, currency: "INR", missing: [] };

  const fallback = process.env[planLinkEnv[plan]]?.trim();
  if (fallback && isHttpsUrl(fallback)) return { status: "link-only", provider: "payment-link", paymentUrl: fallback, missing };
  return { status: "not-configured", provider: null, missing: [...new Set([...missing, planLinkEnv[plan]])] };
}

export async function createRazorpayPaymentLink(input: {
  checkoutId: string;
  plan: BillingPlan;
  email: string;
  amountMinor: number;
  currency: "INR";
}) {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  const appUrl = readAppUrl();
  if (!keyId || !keySecret || !appUrl) throw new Error("Tracked Razorpay checkout is not configured.");

  const response = await fetch("https://api.razorpay.com/v1/payment_links", {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      amount: input.amountMinor,
      currency: input.currency,
      accept_partial: false,
      reference_id: input.checkoutId,
      description: `Vognary ${input.plan} plan`,
      customer: { email: input.email },
      notify: { email: true, sms: false },
      reminder_enable: true,
      callback_url: `${appUrl}/billing/return?checkout=${input.checkoutId}`,
      callback_method: "get",
      notes: { vognary_plan: input.plan },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => ({})) as { id?: string; short_url?: string; status?: string };
  if (!response.ok || !payload.id?.startsWith("plink_") || !payload.short_url || !isHttpsUrl(payload.short_url)) {
    throw new Error(`Razorpay Payment Link creation failed with HTTP ${response.status}.`);
  }
  return { providerCheckoutId: payload.id, paymentUrl: payload.short_url };
}

function parseRupeeAmount(value: string | undefined) {
  const normalized = value?.trim() ?? "";
  if (!/^\d{1,9}$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function readAppUrl() {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") return null;
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}