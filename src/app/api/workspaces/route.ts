import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { isDatabaseConfigured } from "@/lib/server/database";
import { requireSession } from "@/lib/server/workspace-auth";
import { createWorkspaceForUser, listWorkspacesForUser } from "@/lib/server/workspace-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const limit = rateLimit(request, { namespace: "workspaces", limit: 60, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const session = requireSession(request);
  if (session instanceof Response) return session;

  if (!isDatabaseConfigured()) {
    return Response.json({ status: "not-configured", requiredEnv: ["DATABASE_URL"] }, { status: 501 });
  }

  const workspaces = await listWorkspacesForUser(session.userId);
  return Response.json({ status: "ok", workspaces });
}

export async function POST(request: Request) {
  const limit = rateLimit(request, { namespace: "workspaces-create", limit: 12, windowMs: 60 * 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const session = requireSession(request);
  if (session instanceof Response) return session;

  if (!isDatabaseConfigured()) {
    return Response.json({ status: "not-configured", requiredEnv: ["DATABASE_URL"] }, { status: 501 });
  }

  const body = await readJson(request);
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Vognary Workspace";
  const workspace = await createWorkspaceForUser({ userId: session.userId, name });
  return Response.json({ status: "created", workspace }, { status: 201 });
}

async function readJson(request: Request) {
  try {
    return await request.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}