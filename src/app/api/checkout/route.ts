import { NextRequest, NextResponse } from "next/server";
import { normalizeBillingPlan, publicOffer } from "@/lib/billing";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import {
  attachBillingProviderCheckout,
  BillingCheckoutIdempotencyConflictError,
  claimBillingProviderCreation,
  createBillingCheckout,
  markBillingProviderCreationUncertain,
  releaseRejectedBillingProviderCreation,
} from "@/lib/server/billing-store";
import { BillingProviderCheckoutError, createRazorpayPaymentLink, getBillingCheckoutConfiguration } from "@/lib/server/billing-provider";
import { isDatabaseConfigured } from "@/lib/server/database";
import { getAuditLeadEmail } from "@/lib/server/lead-store";
import { readLimitedJson, RequestBodyTooLargeError, UnsupportedContentTypeError } from "@/lib/server/request-body";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import { readCurrentSession } from "@/lib/server/session";
import { requireWorkspaceRole } from "@/lib/server/workspace-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const plan = normalizeBillingPlan(new URL(request.url).searchParams.get("plan"));
  if (!plan || plan !== publicOffer.plan) return NextResponse.json({ error: "This checkout SKU is not offered in Vognary 1.0." }, { status: 404 });
  const configuration = getBillingCheckoutConfiguration(plan);
  const ready = configuration.status === "ready";
  return NextResponse.json({
    status: ready ? "ready" : "not-configured",
    plan,
    offerId: publicOffer.id,
    offerVersion: publicOffer.version,
    termsVersion: publicOffer.termsVersion,
    provider: ready ? configuration.provider : null,
    settlementTracking: ready,
    amountMinor: ready ? configuration.amountMinor : null,
    currency: ready ? configuration.currency : null,
    requiredEnv: configuration.missing,
  });
}

export async function POST(request: NextRequest) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;

  const limit = await rateLimit(request, { namespace: "checkout", limit: 30, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  let body: { plan?: string; email?: string; leadId?: string; termsVersion?: string };
  try {
    body = await readLimitedJson<{ plan?: string; email?: string; leadId?: string; termsVersion?: string }>(request, 4 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: "Checkout request is too large." }, { status: 413 });
    if (error instanceof UnsupportedContentTypeError) return NextResponse.json({ error: "Content-Type must be application/json." }, { status: 415 });
    return NextResponse.json({ error: "Checkout request must be valid JSON." }, { status: 400 });
  }
  const plan = normalizeBillingPlan(body?.plan);
  if (!plan || plan !== publicOffer.plan) return NextResponse.json({ error: "This checkout SKU is not offered in Vognary 1.0." }, { status: 404 });
  if (body.termsVersion !== publicOffer.termsVersion) {
    return NextResponse.json({ error: "Review and accept the current assisted-audit terms before checkout.", code: "terms-version-required" }, { status: 409 });
  }
  const session = await readCurrentSession(request).catch(() => null);
  if (session?.workspaceId) {
    const authorization = await requireWorkspaceRole(request, session.workspaceId, "admin");
    if (authorization instanceof Response) return authorization;
  }
  const email = session?.email ?? normalizeEmail(body.email);
  if (!email) return NextResponse.json({ error: "A valid billing email is required." }, { status: 400 });

  if (body.leadId === undefined) {
    return NextResponse.json({
      error: "Start with the private audit request before opening checkout.",
      code: "audit-lead-required",
    }, { status: 400 });
  }

  let leadId: string | null = null;
  if (body.leadId !== undefined) {
    if (typeof body.leadId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.leadId)) {
      return NextResponse.json({ error: "leadId must be the UUID returned by the audit intake." }, { status: 400 });
    }
    if (!isDatabaseConfigured()) {
      return NextResponse.json({ status: "not-configured", requiredEnv: ["DATABASE_URL"] }, { status: 501 });
    }
    const normalizedLeadId = body.leadId.toLowerCase();
    const leadEmail = await getAuditLeadEmail(normalizedLeadId);
    if (!leadEmail || leadEmail.toLowerCase() !== email.toLowerCase()) {
      return NextResponse.json({ error: "This checkout email does not match the audit request on file." }, { status: 409 });
    }
    leadId = normalizedLeadId;
  }

  const configuration = getBillingCheckoutConfiguration(plan);

  if (configuration.status === "not-configured") {
    return NextResponse.json({
      status: "not-configured",
      plan,
      requiredEnv: configuration.missing,
      message: "Tracked assisted-audit checkout is not active.",
    }, { status: 501 });
  }
  if (!isDatabaseConfigured()) return NextResponse.json({ status: "not-configured", requiredEnv: ["DATABASE_URL"] }, { status: 501 });
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  const expectedIdempotencyKey = `assisted-audit:${publicOffer.version}:${leadId}`;
  if (idempotencyKey !== expectedIdempotencyKey) {
    return NextResponse.json({
      error: "Use the checkout key issued for this audit request and offer version.",
      code: "checkout-idempotency-key-mismatch",
    }, { status: 409 });
  }

  let intent: Awaited<ReturnType<typeof createBillingCheckout>>;
  try {
    intent = await createBillingCheckout({
      workspaceId: session?.workspaceId ?? null,
      userId: session?.userId ?? null,
      leadId,
      customerEmail: email,
      plan,
      offerId: publicOffer.id,
      offerVersion: publicOffer.version,
      termsVersion: publicOffer.termsVersion,
      provider: "razorpay",
      amountMinor: configuration.amountMinor,
      currency: configuration.currency,
      idempotencyKey,
    });
  } catch (error) {
    if (error instanceof BillingCheckoutIdempotencyConflictError) {
      return NextResponse.json({
        error: "This Idempotency-Key is already bound to a different checkout request.",
        code: "checkout-idempotency-conflict",
      }, { status: 409 });
    }
    return NextResponse.json({ error: "Tracked payment checkout could not be initialized." }, { status: 502 });
  }
  if (intent.checkout.providerCheckoutUrl) {
    return NextResponse.json({
      status: "ready",
      plan,
      checkoutId: intent.checkout.id,
      paymentUrl: intent.checkout.providerCheckoutUrl,
      settlementTracking: true,
      idempotentReplay: true,
    });
  }

  if (!await claimBillingProviderCreation(intent.checkout.id)) {
    return NextResponse.json({
      error: "Checkout creation is already in progress or requires operator reconciliation. No second payment link was created.",
      code: "checkout-creation-in-progress",
      checkoutId: intent.checkout.id,
    }, { status: 409 });
  }

  try {
    const provider = await createRazorpayPaymentLink({
      checkoutId: intent.checkout.id,
      plan,
      email,
      amountMinor: configuration.amountMinor,
      currency: configuration.currency,
    });
    const checkout = await attachBillingProviderCheckout({
      checkoutId: intent.checkout.id,
      providerCheckoutId: provider.providerCheckoutId,
      paymentUrl: provider.paymentUrl,
    });
    return NextResponse.json({
      status: "ready",
      plan,
      checkoutId: checkout.id,
      paymentUrl: checkout.providerCheckoutUrl,
      settlementTracking: true,
      idempotentReplay: false,
    }, { status: 201 });
  } catch (error) {
    const outcomeUnknown = !(error instanceof BillingProviderCheckoutError) || error.outcomeUnknown;
    if (outcomeUnknown) await markBillingProviderCreationUncertain(intent.checkout.id).catch(() => undefined);
    else await releaseRejectedBillingProviderCreation(intent.checkout.id).catch(() => undefined);
    return NextResponse.json({
      error: outcomeUnknown
        ? "Razorpay checkout creation could not be confirmed. No automatic retry will create a second link; operator reconciliation is required."
        : "Razorpay rejected checkout creation. Retry with the same Idempotency-Key after correcting provider configuration.",
      code: outcomeUnknown ? "checkout-reconciliation-required" : "checkout-provider-rejected",
    }, { status: 502 });
  }
}

function normalizeEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^\S+@\S+\.\S+$/.test(email) ? email : null;
}
