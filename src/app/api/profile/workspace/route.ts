import { NextRequest, NextResponse } from "next/server";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { readLimitedJson, RequestBodyTooLargeError, UnsupportedContentTypeError } from "@/lib/server/request-body";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import { rebindSessionWorkspace, sessionCookieOptions } from "@/lib/server/session";
import { requireSession } from "@/lib/server/workspace-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;

  const limit = await rateLimit(request, { namespace: "profile-workspace-switch", limit: 20, windowMs: 60 * 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const sessionOrResponse = await requireSession(request);
  if (sessionOrResponse instanceof Response) return sessionOrResponse;

  let body: { workspaceId?: unknown };
  try {
    body = await readLimitedJson<{ workspaceId?: unknown }>(request, 8 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: "Request is too large." }, { status: 413 });
    if (error instanceof UnsupportedContentTypeError) return NextResponse.json({ error: "Content-Type must be application/json." }, { status: 415 });
    return NextResponse.json({ error: "Request must be valid JSON." }, { status: 400 });
  }

  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workspaceId)) {
    return NextResponse.json({ error: "Workspace id must be a UUID." }, { status: 400 });
  }

  try {
    const cookie = await rebindSessionWorkspace(request, workspaceId);
    const response = NextResponse.json({ status: "ok", workspaceId });
    response.cookies.set(cookie.name, cookie.value, sessionCookieOptions(cookie.maxAgeSeconds));
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not switch workspace.";
    if (/not a member/i.test(message)) return NextResponse.json({ error: message }, { status: 403 });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
