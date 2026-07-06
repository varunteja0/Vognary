import { NextRequest, NextResponse } from "next/server";

const paymentLinks: Record<string, string | undefined> = {
  personal: process.env.PAYMENT_LINK_PERSONAL_PRO,
  founder: process.env.PAYMENT_LINK_FOUNDER_PRO,
  team: process.env.PAYMENT_LINK_TEAM,
  annual: process.env.PAYMENT_LINK_ANNUAL_AUDIT,
};

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { plan?: string; email?: string } | null;
  const plan = body?.plan ?? "founder";
  const paymentUrl = paymentLinks[plan];

  if (!paymentUrl) {
    return NextResponse.json({
      status: "not-configured",
      plan,
      requiredEnv: [`PAYMENT_LINK_${plan.toUpperCase()}${plan === "founder" ? "_PRO" : ""}`],
      message: "Configure a Razorpay/Stripe payment link env var to accept paid plans.",
    }, { status: 501 });
  }

  return NextResponse.json({ status: "ready", plan, paymentUrl });
}