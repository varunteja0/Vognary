import { NextRequest, NextResponse } from "next/server";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const paymentLinks = {
  personal: process.env.PAYMENT_LINK_PERSONAL_PRO,
  founder: process.env.PAYMENT_LINK_FOUNDER_PRO,
  team: process.env.PAYMENT_LINK_TEAM,
  annual: process.env.PAYMENT_LINK_ANNUAL_AUDIT,
} as const;

type PaymentPlan = keyof typeof paymentLinks;

const planEnvVars: Record<PaymentPlan, string> = {
  personal: "PAYMENT_LINK_PERSONAL_PRO",
  founder: "PAYMENT_LINK_FOUNDER_PRO",
  team: "PAYMENT_LINK_TEAM",
  annual: "PAYMENT_LINK_ANNUAL_AUDIT",
};

export async function POST(request: NextRequest) {
  const limit = rateLimit(request, { namespace: "checkout", limit: 30, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const body = await request.json().catch(() => null) as { plan?: string; email?: string } | null;
  const plan = isPaymentPlan(body?.plan) ? body.plan : "founder";
  const paymentUrl = paymentLinks[plan];

  if (!paymentUrl) {
    return NextResponse.json({
      status: "not-configured",
      plan,
      requiredEnv: [planEnvVars[plan]],
      message: "Configure a Razorpay/Stripe payment link env var to accept paid plans.",
    }, { status: 501 });
  }

  return NextResponse.json({ status: "ready", plan, paymentUrl });
}

function isPaymentPlan(value: unknown): value is PaymentPlan {
  return typeof value === "string" && Object.hasOwn(paymentLinks, value);
}