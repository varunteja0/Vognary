import { NextRequest, NextResponse } from "next/server";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { isLeadDatabaseConfigured, persistAuditLead } from "@/lib/server/lead-store";
import { recordProductEvent } from "@/lib/server/product-event-store";
import { readLimitedJson, RequestBodyTooLargeError, UnsupportedContentTypeError } from "@/lib/server/request-body";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import { buildRedactionFirstSourcePlan } from "@/lib/private-audit-plan";
import { currentPrivacyNoticeVersion } from "@/lib/privacy-notice";

export const dynamic = "force-dynamic";

type AuditIntakeRequest = {
  name?: string;
  email?: string;
  contact?: string;
  persona?: string;
  spendGuess?: string;
  paymentTypes?: string[];
  sourceTypes?: string[];
  biggestConcern?: string;
  canContact?: boolean;
  message?: string;
  sourceTag?: string;
};

const allowedPersonas = new Set([
  "Founder",
  "Freelancer",
  "Agency owner",
  "AI builder",
  "Developer",
  "Household / personal user",
  "CA / finance operator",
  "Other",
]);

const allowedPaymentTypes = new Set([
  "AI tools",
  "SaaS tools",
  "Cloud hosting",
  "Domains",
  "App stores",
  "UPI AutoPay",
  "Card mandates",
  "Insurance",
  "EMIs",
  "SIPs",
  "Utilities",
  "Streaming",
  "Other",
]);

const allowedSourceTypes = new Set([
  "Redacted bank/card statement",
  "UPI/card mandate screenshot",
  "SaaS invoices",
  "Cloud invoices",
  "Gmail receipt snippets",
  "Apple/Google Play screenshot",
  "Manual list only",
  "Not sure yet",
]);

const allowedConcerns = new Set([
  "Privacy",
  "Time",
  "Not sure it is useful",
  "Do not want to upload financial data",
  "Need full bank automation",
  "Price",
  "Other",
]);

export async function GET() {
  if (isLeadDatabaseConfigured()) {
    return NextResponse.json({ status: "ready", persisted: true, storage: "database" });
  }
  if (process.env.AUDIT_INTAKE_WEBHOOK_URL || process.env.WAITLIST_WEBHOOK_URL) {
    return NextResponse.json({ status: "ready", persisted: true, storage: "webhook" });
  }
  return NextResponse.json({
    status: "not-configured",
    persisted: false,
    requiredEnv: ["DATABASE_URL or AUDIT_INTAKE_WEBHOOK_URL or WAITLIST_WEBHOOK_URL"],
  }, { status: 501 });
}

export async function POST(request: NextRequest) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;

  const limit = await rateLimit(request, { namespace: "audit-intake", limit: 10, windowMs: 60 * 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  let body: AuditIntakeRequest;

  try {
    body = await readLimitedJson<AuditIntakeRequest>(request, 16 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: "Request is too large." }, { status: 413 });
    if (error instanceof UnsupportedContentTypeError) return NextResponse.json({ error: "Content-Type must be application/json." }, { status: 415 });
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const name = cleanText(body.name, 120);
  const email = body.email?.trim().toLowerCase() ?? "";
  const contact = cleanText(body.contact, 160);
  const persona = typeof body.persona === "string" && allowedPersonas.has(body.persona) ? body.persona : "Other";
  const spendGuess = cleanText(body.spendGuess, 80);
  const paymentTypes = cleanList(body.paymentTypes, allowedPaymentTypes);
  const sourceTypes = cleanList(body.sourceTypes, allowedSourceTypes);
  const biggestConcern = typeof body.biggestConcern === "string" && allowedConcerns.has(body.biggestConcern) ? body.biggestConcern : "Other";
  const message = cleanText(body.message, 1200);

  if (!name) return NextResponse.json({ error: "Name is required." }, { status: 400 });
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ error: "Valid email is required." }, { status: 400 });
  }
  if (!body.canContact) {
    return NextResponse.json({ error: "Consent to contact is required for the private audit." }, { status: 400 });
  }
  if (!paymentTypes.length) {
    return NextResponse.json({ error: "Select at least one recurring payment type." }, { status: 400 });
  }
  if (!sourceTypes.length) {
    return NextResponse.json({ error: "Select at least one source you can share." }, { status: 400 });
  }

  // Outreach attribution: the page forwards ?src=<tag> from tracked links.
  // Server-validated so the stored source stays a bounded, predictable value.
  const sourceTag = typeof body.sourceTag === "string" && /^[a-z0-9][a-z0-9-]{0,31}$/.test(body.sourceTag.trim().toLowerCase())
    ? body.sourceTag.trim().toLowerCase()
    : null;

  const createdAt = new Date().toISOString();
  const payload = {
    source: sourceTag ? `vognary-private-audit-intake:${sourceTag}` : "vognary-private-audit-intake",
    createdAt,
    name,
    email,
    contact,
    persona,
    spendGuess,
    paymentTypes,
    sourceTypes,
    biggestConcern,
    message,
    score: scoreLead({ persona, paymentTypes, sourceTypes }),
    consentPurpose: "private-audit-contact",
    consentNoticeVersion: currentPrivacyNoticeVersion,
    consentGrantedAt: createdAt,
  };
  const sourcePlan = buildRedactionFirstSourcePlan({ paymentTypes, sourceTypes });

  if (isLeadDatabaseConfigured()) {
    try {
      const leadId = await persistAuditLead(payload);
      await recordProductEvent({ eventName: "private_audit.requested", source: "workspace-api", status: "succeeded" }).catch(() => undefined);
      await mirrorToWebhook(process.env.AUDIT_INTAKE_WEBHOOK_URL || process.env.WAITLIST_WEBHOOK_URL, payload);
      return NextResponse.json({ status: "accepted", persisted: true, storage: "database", leadId, score: payload.score, sourcePlan });
    } catch {
      return NextResponse.json({ error: "The audit request could not be stored right now. Please try again later." }, { status: 502 });
    }
  }

  const webhookUrl = process.env.AUDIT_INTAKE_WEBHOOK_URL || process.env.WAITLIST_WEBHOOK_URL;
  if (!webhookUrl) {
    return NextResponse.json({
      status: "prepared-not-persisted",
      persisted: false,
      nextStep: "Set DATABASE_URL for free database lead storage, or set AUDIT_INTAKE_WEBHOOK_URL / WAITLIST_WEBHOOK_URL for webhook persistence.",
      sourcePlan,
    });
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    return NextResponse.json({ error: "Audit intake webhook failed." }, { status: 502 });
  }

  return NextResponse.json({ status: "accepted", persisted: true, score: payload.score, sourcePlan });
}

async function mirrorToWebhook(webhookUrl: string | undefined, payload: Record<string, unknown>) {
  if (!webhookUrl) return;
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => null);
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanList(value: unknown, allowed: Set<string>) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && allowed.has(item)).slice(0, 12);
}

function scoreLead({ persona, paymentTypes, sourceTypes }: { persona?: string; paymentTypes: string[]; sourceTypes: string[] }) {
  let score = 0;
  if (["Founder", "Agency owner", "AI builder", "CA / finance operator"].includes(persona ?? "")) score += 2;
  if (paymentTypes.some((type) => ["AI tools", "SaaS tools", "Cloud hosting", "Domains"].includes(type))) score += 2;
  if (paymentTypes.some((type) => ["UPI AutoPay", "Card mandates", "Insurance", "EMIs", "SIPs"].includes(type))) score += 1;
  if (sourceTypes.some((type) => ["Redacted bank/card statement", "SaaS invoices", "Cloud invoices"].includes(type))) score += 2;
  if (sourceTypes.includes("Manual list only") || sourceTypes.includes("Not sure yet")) score -= 1;
  return Math.max(0, score);
}
