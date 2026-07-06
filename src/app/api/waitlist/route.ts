import { NextRequest, NextResponse } from "next/server";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { isLeadDatabaseConfigured, persistWaitlistLead } from "@/lib/server/lead-store";

export const dynamic = "force-dynamic";

type WaitlistRequest = {
  email?: string;
  name?: string;
  segment?: string;
  message?: string;
};

export async function POST(request: NextRequest) {
  const limit = await rateLimit(request, { namespace: "waitlist", limit: 12, windowMs: 60 * 60_000 });
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

  if (isLeadDatabaseConfigured()) {
    try {
      const leadId = await persistWaitlistLead(payload);
      await mirrorToWebhook(process.env.WAITLIST_WEBHOOK_URL, payload);
      return NextResponse.json({ status: "accepted", persisted: true, storage: "database", leadId });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Waitlist database persistence failed." }, { status: 502 });
    }
  }

  const webhookUrl = process.env.WAITLIST_WEBHOOK_URL;
  if (!webhookUrl) {
    return NextResponse.json({
      status: "accepted-preview",
      persisted: false,
      nextStep: "Set DATABASE_URL for free database lead storage, or set WAITLIST_WEBHOOK_URL for webhook persistence.",
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

async function mirrorToWebhook(webhookUrl: string | undefined, payload: Record<string, unknown>) {
  if (!webhookUrl) return;
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => null);
}