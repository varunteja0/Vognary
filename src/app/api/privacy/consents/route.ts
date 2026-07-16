import { normalizeConsentGrant, type ConsentPurpose } from "@/lib/consent";
import { currentPrivacyNoticeVersion } from "@/lib/privacy-notice";
import { isDatabaseConfigured } from "@/lib/server/database";
import { listConsentGrants, recordConsentGrant, withdrawConsentGrant } from "@/lib/server/consent-store";
import { readLimitedJson, RequestBodyTooLargeError, UnsupportedContentTypeError } from "@/lib/server/request-body";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import { requireSession } from "@/lib/server/workspace-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const selfServicePurposes = new Set<ConsentPurpose>([
  "merchant-intelligence-opt-in",
  "product-analytics-opt-in",
  "product-research-contact",
]);

export async function GET(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;
  if (!isDatabaseConfigured()) return Response.json({ error: "Consent storage is not configured." }, { status: 501 });
  return Response.json({
    status: "ok",
    consents: await listConsentGrants({ userId: session.userId, email: session.email }),
  }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;

  const session = await requireSession(request);
  if (session instanceof Response) return session;
  if (!isDatabaseConfigured()) return Response.json({ error: "Consent storage is not configured." }, { status: 501 });
  const body = await readConsentJson(request);
  if (body instanceof Response) return body;
  if (!selfServicePurposes.has(body.purpose as ConsentPurpose)) {
    return Response.json({ error: `Purpose must be one of: ${[...selfServicePurposes].join(", ")}.` }, { status: 400 });
  }
  try {
    const normalized = normalizeConsentGrant({
      workspaceId: session.workspaceId,
      userId: session.userId,
      subjectEmail: session.email,
      purpose: body.purpose as ConsentPurpose,
      noticeVersion: currentPrivacyNoticeVersion,
      source: "profile-privacy-controls",
      scopes: Array.isArray(body.scopes) ? body.scopes : [],
    });
    const consent = await recordConsentGrant(normalized);
    return Response.json({ status: "granted", consent }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Consent could not be recorded." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;

  const session = await requireSession(request);
  if (session instanceof Response) return session;
  if (!isDatabaseConfigured()) return Response.json({ error: "Consent storage is not configured." }, { status: 501 });
  const body = await readConsentJson(request);
  if (body instanceof Response) return body;
  if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id)) {
    return Response.json({ error: "A valid consent id is required." }, { status: 400 });
  }
  const withdrawn = await withdrawConsentGrant({ id: body.id, userId: session.userId, email: session.email, workspaceId: session.workspaceId });
  return withdrawn
    ? Response.json({ status: "withdrawn", id: body.id })
    : Response.json({ error: "Consent was not found." }, { status: 404 });
}

async function readConsentJson(request: Request): Promise<Record<string, unknown> | Response> {
  try {
    return await readLimitedJson<Record<string, unknown>>(request, 8 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return Response.json({ error: "Request is too large." }, { status: 413 });
    if (error instanceof UnsupportedContentTypeError) return Response.json({ error: "Content-Type must be application/json." }, { status: 415 });
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
}
