import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { isDatabaseConfigured } from "@/lib/server/database";
import { createPlatformApiToken, listPlatformApiTokens, revokePlatformApiToken } from "@/lib/server/platform-api-token-store";
import { readLimitedJson, RequestBodyTooLargeError, UnsupportedContentTypeError } from "@/lib/server/request-body";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import { requireSession, requireWorkspaceRole } from "@/lib/server/workspace-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const limit = await rateLimit(request, { namespace: "platform-tokens-read", limit: 30, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);
  const context = await requireTokenAdmin(request);
  if (context instanceof Response) return context;
  return Response.json({
    status: "ok",
    tokens: await listPlatformApiTokens(context.workspaceId),
  }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const limit = await rateLimit(request, { namespace: "platform-tokens-create", limit: 10, windowMs: 60 * 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);
  const context = await requireTokenAdmin(request);
  if (context instanceof Response) return context;
  const body = await readBody(request);
  if (body instanceof Response) return body;
  try {
    const created = await createPlatformApiToken({
      workspaceId: context.workspaceId,
      userId: context.userId,
      name: typeof body.name === "string" ? body.name : "",
      scopes: body.scopes,
      expiresInDays: typeof body.expiresInDays === "number" ? body.expiresInDays : undefined,
    });
    return Response.json({
      status: "created",
      token: created.token,
      tokenNotice: "Copy this token now. Vognary stores only its SHA-256 hash and cannot show it again.",
      summary: created.summary,
    }, { status: 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "API token could not be created." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const limit = await rateLimit(request, { namespace: "platform-tokens-revoke", limit: 30, windowMs: 60 * 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);
  const context = await requireTokenAdmin(request);
  if (context instanceof Response) return context;
  const body = await readBody(request);
  if (body instanceof Response) return body;
  if (typeof body.id !== "string" || !isUuid(body.id)) return Response.json({ error: "A valid token id is required." }, { status: 400 });
  const revoked = await revokePlatformApiToken({ workspaceId: context.workspaceId, tokenId: body.id, userId: context.userId });
  return revoked ? Response.json({ status: "revoked", id: body.id }) : Response.json({ error: "API token not found." }, { status: 404 });
}

async function requireTokenAdmin(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;
  if (!session.workspaceId) return Response.json({ error: "Session has no workspace." }, { status: 400 });
  if (!isDatabaseConfigured()) return Response.json({ status: "not-configured" }, { status: 501 });
  const authorization = await requireWorkspaceRole(request, session.workspaceId, "admin");
  if (authorization instanceof Response) return authorization;
  return { workspaceId: session.workspaceId, userId: session.userId };
}

async function readBody(request: Request): Promise<Record<string, unknown> | Response> {
  try {
    return await readLimitedJson<Record<string, unknown>>(request, 8 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return Response.json({ error: "API token request is too large." }, { status: 413 });
    if (error instanceof UnsupportedContentTypeError) return Response.json({ error: "Content-Type must be application/json." }, { status: 415 });
    return Response.json({ error: "API token request must be valid JSON." }, { status: 400 });
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
