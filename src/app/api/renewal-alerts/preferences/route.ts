import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { normalizeRenewalAlertPreferenceInput } from "@/lib/renewal-alerts";
import { isDatabaseConfigured } from "@/lib/server/database";
import { readLimitedJson, RequestBodyTooLargeError, UnsupportedContentTypeError } from "@/lib/server/request-body";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import { getRenewalAlertPreference, updateRenewalAlertPreference } from "@/lib/server/renewal-alert-store";
import { requireSession } from "@/lib/server/workspace-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const privateHeaders = { "cache-control": "private, no-store", pragma: "no-cache" };

export async function GET(request: Request) {
  const limit = await rateLimit(request, { namespace: "renewal-alert-preferences-read", limit: 60, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const session = await requireSession(request);
  if (session instanceof Response) return session;
  if (!session.workspaceId) return Response.json({ error: "Session has no workspace." }, { status: 400, headers: privateHeaders });
  if (!isDatabaseConfigured()) return Response.json({ error: "Renewal alert storage is not configured." }, { status: 501, headers: privateHeaders });

  try {
    const preference = await getRenewalAlertPreference({ workspaceId: session.workspaceId, userId: session.userId });
    return Response.json({ status: "ok", preference }, { headers: privateHeaders });
  } catch {
    return Response.json({ error: "Renewal alert preferences could not be loaded." }, { status: 500, headers: privateHeaders });
  }
}

export async function PUT(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;

  const limit = await rateLimit(request, { namespace: "renewal-alert-preferences-update", limit: 20, windowMs: 60 * 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const session = await requireSession(request);
  if (session instanceof Response) return session;
  if (!session.workspaceId) return Response.json({ error: "Session has no workspace." }, { status: 400, headers: privateHeaders });
  if (!isDatabaseConfigured()) return Response.json({ error: "Renewal alert storage is not configured." }, { status: 501, headers: privateHeaders });

  const body = await readPreferenceJson(request);
  if (body instanceof Response) return body;
  let preference;
  try {
    preference = normalizeRenewalAlertPreferenceInput(body);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Renewal alert preferences are invalid." }, { status: 400, headers: privateHeaders });
  }

  try {
    const updated = await updateRenewalAlertPreference({
      workspaceId: session.workspaceId,
      userId: session.userId,
      email: session.email,
      preference,
    });
    return Response.json({ status: "updated", preference: updated }, { headers: privateHeaders });
  } catch {
    return Response.json({ error: "Renewal alert preferences could not be updated." }, { status: 500, headers: privateHeaders });
  }
}

async function readPreferenceJson(request: Request): Promise<Record<string, unknown> | Response> {
  try {
    return await readLimitedJson<Record<string, unknown>>(request, 4 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return Response.json({ error: "Renewal alert preference request is too large." }, { status: 413, headers: privateHeaders });
    if (error instanceof UnsupportedContentTypeError) return Response.json({ error: "Content-Type must be application/json." }, { status: 415, headers: privateHeaders });
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400, headers: privateHeaders });
  }
}
