import "server-only";

import { publicOffer, type BillingPlan } from "@/lib/billing";

export type BillingCheckoutConfiguration =
  | { status: "ready"; provider: "razorpay"; amountMinor: number; currency: "INR"; missing: [] }
  | { status: "not-configured"; provider: null; missing: string[] };

export class BillingProviderCheckoutError extends Error {
  constructor(message: string, readonly outcomeUnknown: boolean) {
    super(message);
    this.name = "BillingProviderCheckoutError";
  }
}

export function getBillingCheckoutConfiguration(plan: BillingPlan): BillingCheckoutConfiguration {
  if (plan !== publicOffer.plan) return { status: "not-configured", provider: null, missing: ["unsupported Vognary 1.0 checkout SKU"] };
  const appUrl = readAppUrl();
  const testModeRequested = process.env.ASSISTED_AUDIT_CHECKOUT_MODE === "test";
  const testMode = testModeRequested && process.env.NODE_ENV !== "production";
  const keyId = process.env.RAZORPAY_KEY_ID?.trim() ?? "";
  const missing = [
    testModeRequested && !testMode ? "ASSISTED_AUDIT_CHECKOUT_MODE=test is forbidden in production" : null,
    (testMode ? /^rzp_test_[A-Za-z0-9]+$/ : /^rzp_live_[A-Za-z0-9]+$/).test(keyId)
      ? null
      : `RAZORPAY_KEY_ID (${testMode ? "test" : "live"}-mode key)`,
    process.env.RAZORPAY_KEY_SECRET?.trim() ? null : "RAZORPAY_KEY_SECRET",
    process.env.RAZORPAY_WEBHOOK_SECRET?.trim() ? null : "RAZORPAY_WEBHOOK_SECRET",
    appUrl ? null : "NEXT_PUBLIC_APP_URL",
    testMode || process.env.ASSISTED_AUDIT_LEGAL_TERMS_STATUS === "approved" ? null : "ASSISTED_AUDIT_LEGAL_TERMS_STATUS=approved",
    testMode || process.env.RAZORPAY_ACCOUNT_STATUS === "live-kyc-approved" ? null : "RAZORPAY_ACCOUNT_STATUS=live-kyc-approved",
    testMode || process.env.RAZORPAY_WEBHOOK_PROOF_STATUS === "passed" ? null : "RAZORPAY_WEBHOOK_PROOF_STATUS=passed",
    testMode || process.env.RAZORPAY_REPLAY_PROOF_STATUS === "passed" ? null : "RAZORPAY_REPLAY_PROOF_STATUS=passed",
    testMode || process.env.RAZORPAY_REFUND_PROOF_STATUS === "passed" ? null : "RAZORPAY_REFUND_PROOF_STATUS=passed",
    testMode || process.env.RAZORPAY_RECONCILIATION_STATUS === "passed" ? null : "RAZORPAY_RECONCILIATION_STATUS=passed",
  ].filter((value): value is string => Boolean(value));
  if (!missing.length) return { status: "ready", provider: "razorpay", amountMinor: publicOffer.amountMinor, currency: "INR", missing: [] };
  return { status: "not-configured", provider: null, missing };
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

  let response: Response;
  try {
    response = await fetch("https://api.razorpay.com/v1/payment_links", {
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
        description: input.plan === publicOffer.plan || input.plan === publicOffer.legacyPlan ? publicOffer.title : `Vognary ${input.plan} plan`,
        customer: { email: input.email },
        // The browser receives the URL only after the local checkout row is
        // attached. Provider notifications would expose an unrecoverable link
        // if the network or database failed between those two operations.
        notify: { email: false, sms: false },
        reminder_enable: false,
        callback_url: `${appUrl}/billing/return?checkout=${input.checkoutId}`,
        callback_method: "get",
        notes: input.plan === publicOffer.plan || input.plan === publicOffer.legacyPlan
          ? {
              vognary_plan: input.plan,
              vognary_offer_id: publicOffer.id,
              vognary_offer_version: String(publicOffer.version),
              vognary_terms_version: publicOffer.termsVersion,
            }
          : { vognary_plan: input.plan },
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new BillingProviderCheckoutError("Razorpay Payment Link creation outcome is unknown.", true);
  }
  const payload = await response.json().catch(() => ({})) as { id?: string; short_url?: string; status?: string };
  if (!response.ok) {
    throw new BillingProviderCheckoutError(`Razorpay Payment Link creation failed with HTTP ${response.status}.`, response.status >= 500);
  }
  if (!payload.id?.startsWith("plink_") || !payload.short_url || !isHttpsUrl(payload.short_url)) {
    throw new BillingProviderCheckoutError("Razorpay returned an invalid Payment Link response.", true);
  }
  return { providerCheckoutId: payload.id, paymentUrl: payload.short_url };
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
