import { NextRequest, NextResponse } from "next/server";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { isLeadDatabaseConfigured, persistWaitlistLead } from "@/lib/server/lead-store";
import { currentPrivacyNoticeVersion } from "@/lib/privacy-notice";
import { readLimitedJson, RequestBodyTooLargeError, UnsupportedContentTypeError } from "@/lib/server/request-body";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";

export const dynamic = "force-dynamic";

type WaitlistRequest = {
  email?: string;
  name?: string;
  segment?: string;
  message?: string;
  canContact?: boolean;
  consentNoticeVersion?: string;
  consentPurpose?: string;
};

const allowedConsentPurposes = new Set(["regulated-rail-pilot-contact", "launch-audit-contact", "product-research-contact"]);

export async function POST(request: NextRequest) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;

  const limit = await rateLimit(request, { namespace: "waitlist", limit: 12, windowMs: 60 * 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  let body: WaitlistRequest;

  try {
    body = await readLimitedJson<WaitlistRequest>(request, 8 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: "Request is too large." }, { status: 413 });
    if (error instanceof UnsupportedContentTypeError) return NextResponse.json({ error: "Content-Type must be application/json." }, { status: 415 });
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ error: "Valid email is required." }, { status: 400 });
  }
  if (body.canContact !== true) {
    return NextResponse.json({ error: "Consent to store your email and contact you is required." }, { status: 400 });
  }

  const createdAt = new Date().toISOString();

  const requestedPurpose = cleanText(body.consentPurpose, 160);
  const payload = {
    email,
    name: cleanText(body.name, 120),
    segment: cleanText(body.segment, 80),
    message: cleanText(body.message, 800),
    createdAt,
    source: "vognary-launch-page",
    consentPurpose: allowedConsentPurposes.has(requestedPurpose) ? requestedPurpose : "product-research-contact",
    consentNoticeVersion: cleanText(body.consentNoticeVersion, 80) || currentPrivacyNoticeVersion,
    consentGrantedAt: createdAt,
  };

  if (isLeadDatabaseConfigured()) {
    try {
      const leadId = await persistWaitlistLead(payload);
      await mirrorToWebhook(process.env.WAITLIST_WEBHOOK_URL, payload);
      return NextResponse.json({ status: "accepted", persisted: true, storage: "database", leadId });
    } catch {
      return NextResponse.json({ error: "The request could not be stored right now. Please try again later." }, { status: 502 });
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

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

async function mirrorToWebhook(webhookUrl: string | undefined, payload: Record<string, unknown>) {
  if (!webhookUrl) return;
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => null);
}
