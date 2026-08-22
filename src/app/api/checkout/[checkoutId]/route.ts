import { NextRequest, NextResponse } from "next/server";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { getPublicCheckoutStatus } from "@/lib/server/billing-store";
import { isDatabaseConfigured } from "@/lib/server/database";

export const dynamic = "force-dynamic";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, { params }: { params: Promise<{ checkoutId: string }> }) {
  const limit = await rateLimit(request, { namespace: "checkout-status", limit: 60, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const { checkoutId } = await params;
  if (!uuidPattern.test(checkoutId)) {
    return NextResponse.json({ error: "A valid checkout reference is required." }, { status: 400 });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      {
        status: "unavailable",
        message: "Historical checkout status is temporarily unavailable. No settlement conclusion can be drawn yet.",
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  let checkout;
  try {
    checkout = await getPublicCheckoutStatus(checkoutId.toLowerCase());
  } catch {
    return NextResponse.json(
      { error: "Payment status is temporarily unavailable. No settlement conclusion can be drawn yet." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  if (!checkout) {
    return NextResponse.json({ error: "This checkout reference was not found." }, { status: 404, headers: { "cache-control": "no-store" } });
  }
  return NextResponse.json(checkout, { headers: { "cache-control": "no-store" } });
}
