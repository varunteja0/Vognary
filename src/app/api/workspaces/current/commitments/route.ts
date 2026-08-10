import { recoverySuccessResponse } from "@/lib/server/recovery-api";
import { readRecoveryPageSize, runRecoveryRoute } from "@/lib/server/recovery-route";
import { listRecoveryCommitments } from "@/lib/server/recovery-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return runRecoveryRoute(request, {
    namespace: "recovery-commitments-read",
    limit: 60,
    windowMs: 60_000,
  }, async ({ requestId, session }) => {
    const url = new URL(request.url);
    const result = await listRecoveryCommitments({
      workspaceId: session.workspaceId,
      actorUserId: session.userId,
      limit: readRecoveryPageSize(url.searchParams.get("limit"), "limit", 50),
      cursor: url.searchParams.get("cursor") || undefined,
    });
    return recoverySuccessResponse({ items: result.items, nextCursor: result.nextCursor }, requestId, result.workspaceVersion);
  });
}
