import { NextRequest, NextResponse } from "next/server";
import { normalizeBillingPlan } from "@/lib/billing";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { createBillingCheckout, attachBillingProviderCheckout, markBillingCheckoutFailed } from "@/lib/server/billing-store";
import { createRazorpayPaymentLink, getBillingCheckoutConfiguration } from "@/lib/server/billing-provider";
import { isDatabaseConfigured } from "@/lib/server/database";
import { getAuditLeadEmail } from "@/lib/server/lead-store";
import { readLimitedJson, RequestBodyTooLargeError, UnsupportedContentTypeError } from "@/lib/server/request-body";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import { readCurrentSession } from "@/lib/server/session";
import { requireWorkspaceRole } from "@/lib/server/workspace-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const plan = normalizeBillingPlan(new URL(request.url).searchParams.get("plan"));
  if (!plan) return NextResponse.json({ error: "A valid checkout plan is required." }, { status: 400 });
  const configuration = getBillingCheckoutConfiguration(plan);
  return NextResponse.json({
    status: configuration.status,
    plan,
    provider: configuration.provider,
    settlementTracking: configuration.status === "ready",
    amountMinor: configuration.status === "ready" ? configuration.amountMinor : null,
    currency: configuration.status === "ready" ? configuration.currency : null,
    requiredEnv: configuration.missing,
  }, { status: configuration.status === "not-configured" ? 501 : 200 });
}

export async function POST(request: NextRequest) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;

  const limit = await rateLimit(request, { namespace: "checkout", limit: 30, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  let body: { plan?: string; email?: string; leadId?: string };
  try {
    body = await readLimitedJson<{ plan?: string; email?: string; leadId?: string }>(request, 4 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: "Checkout request is too large." }, { status: 413 });
    if (error instanceof UnsupportedContentTypeError) return NextResponse.json({ error: "Content-Type must be application/json." }, { status: 415 });
    return NextResponse.json({ error: "Checkout request must be valid JSON." }, { status: 400 });
  }
  const plan = normalizeBillingPlan(body?.plan);
  if (!plan) return NextResponse.json({ error: "A valid checkout plan is required." }, { status: 400 });
  const configuration = getBillingCheckoutConfiguration(plan);
  const session = await readCurrentSession(request).catch(() => null);
  if (plan !== "annual" && !session?.workspaceId) {
    return NextResponse.json({
      error: "Sign in to a workspace before purchasing monitoring.",
      code: "workspace-required",
    }, { status: 401 });
  }
  if (session?.workspaceId) {
    const authorization = await requireWorkspaceRole(request, session.workspaceId, "admin");
    if (authorization instanceof Response) return authorization;
  }
  const email = session?.email ?? normalizeEmail(body.email);
  if (!email) return NextResponse.json({ error: "A valid billing email is required." }, { status: 400 });

  if (configuration.status === "link-only") {
    return NextResponse.json({
      status: "link-only",
      plan,
      paymentUrl: configuration.paymentUrl,
      settlementTracking: false,
      message: "This fallback link does not grant an automatic Vognary entitlement. Operator reconciliation is required.",
    });
  }
  if (configuration.status === "not-configured") {
    return NextResponse.json({
      status: "not-configured",
      plan,
      requiredEnv: configuration.missing,
      message: "Configure tracked Razorpay checkout or a fallback payment link.",
    }, { status: 501 });
  }
  if (!isDatabaseConfigured()) return NextResponse.json({ status: "not-configured", requiredEnv: ["DATABASE_URL"] }, { status: 501 });
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) {
    return NextResponse.json({ error: "A 16–128 character Idempotency-Key header is required." }, { status: 400 });
  }

  let leadId: string | null = null;
  if (body.leadId !== undefined) {
    if (typeof body.leadId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.leadId)) {
      return NextResponse.json({ error: "leadId must be the UUID returned by the audit intake." }, { status: 400 });
    }
    const leadEmail = await getAuditLeadEmail(body.leadId.toLowerCase());
    if (!leadEmail || leadEmail.toLowerCase() !== email.toLowerCase()) {
      return NextResponse.json({ error: "This checkout email does not match the audit request on file." }, { status: 409 });
    }
    leadId = body.leadId.toLowerCase();
  }

  const intent = await createBillingCheckout({
    workspaceId: session?.workspaceId ?? null,
    userId: session?.userId ?? null,
    leadId,
    customerEmail: email,
    plan,
    provider: "razorpay",
    amountMinor: configuration.amountMinor,
    currency: configuration.currency,
    idempotencyKey,
  });
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
  } catch {
    await markBillingCheckoutFailed(intent.checkout.id).catch(() => undefined);
    return NextResponse.json({ error: "Tracked payment checkout could not be created. Retry with the same Idempotency-Key." }, { status: 502 });
  }
}

function normalizeEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^\S+@\S+\.\S+$/.test(email) ? email : null;
}
