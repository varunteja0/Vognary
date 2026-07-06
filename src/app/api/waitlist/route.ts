import { NextRequest, NextResponse } from "next/server";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

type WaitlistRequest = {
  email?: string;
  name?: string;
  segment?: string;
  message?: string;
};

export async function POST(request: NextRequest) {
  const limit = rateLimit(request, { namespace: "waitlist", limit: 12, windowMs: 60 * 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  let body: WaitlistRequest;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ error: "Valid email is required." }, { status: 400 });
  }

  const payload = {
    email,
    name: body.name?.trim() ?? "",
    segment: body.segment?.trim() ?? "",
    message: body.message?.trim() ?? "",
    createdAt: new Date().toISOString(),
    source: "vognary-launch-page",
  };

  const webhookUrl = process.env.WAITLIST_WEBHOOK_URL;
  if (!webhookUrl) {
    return NextResponse.json({
      status: "accepted-preview",
      persisted: false,
      nextStep: "Set WAITLIST_WEBHOOK_URL to persist signups in production.",
      lead: payload,
    });
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    return NextResponse.json({ error: "Waitlist webhook failed." }, { status: 502 });
  }

  return NextResponse.json({ status: "accepted", persisted: true });
}