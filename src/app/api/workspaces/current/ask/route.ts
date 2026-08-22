import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { isDatabaseConfigured } from "@/lib/server/database";
import { reportServerError } from "@/lib/server/monitoring";
import { askWorkspaceProofGraph } from "@/lib/server/proof-question-store";
import { readLimitedJson, RequestBodyTooLargeError, UnsupportedContentTypeError } from "@/lib/server/request-body";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import { requireSession, requireWorkspaceRole } from "@/lib/server/workspace-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const noStoreHeaders = { "cache-control": "private, no-store" };

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const limit = await rateLimit(request, { namespace: "workspace-proof-question", limit: 60, windowMs: 60 * 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);
  const session = await requireSession(request);
  if (session instanceof Response) return session;
  if (!session.workspaceId) return Response.json({ error: "Session has no workspace." }, { status: 400, headers: noStoreHeaders });
  if (!isDatabaseConfigured()) return Response.json({ status: "not-configured" }, { status: 501, headers: noStoreHeaders });
  const authorization = await requireWorkspaceRole(request, session.workspaceId, "viewer");
  if (authorization instanceof Response) return authorization;

  try {
    const body = await readLimitedJson<{ question?: unknown }>(request, 4 * 1024);
    const answer = await askWorkspaceProofGraph(session.workspaceId, body.question);
    return Response.json({ status: "ok", answer }, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return Response.json({ error: "Question request is too large." }, { status: 413, headers: noStoreHeaders });
    if (error instanceof UnsupportedContentTypeError) return Response.json({ error: "Content-Type must be application/json." }, { status: 415, headers: noStoreHeaders });
    // Question-validation copy is safe to echo; anything else (driver, storage)
    // stays server-side so infrastructure detail never reaches the client.
    if (error instanceof Error && error.message.startsWith("Question must ")) {
      return Response.json({ error: error.message }, { status: 400, headers: noStoreHeaders });
    }
    void reportServerError(error, { path: "/api/workspaces/current/ask", method: "POST", headers: Object.fromEntries(request.headers) }, { workspaceId: session.workspaceId });
    return Response.json({ error: "The Proof Graph could not answer that question." }, { status: 500, headers: noStoreHeaders });
  }
}
