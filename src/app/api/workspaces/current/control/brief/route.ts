import { recoverySuccessResponse } from "@/lib/server/recovery-api";
import { runRecoveryRoute } from "@/lib/server/recovery-route";
import { getCommitmentControlBrief } from "@/lib/server/commitment-control-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return runRecoveryRoute(request, {
    namespace: "commitment-control-brief-read",
    limit: 120,
    windowMs: 60_000,
  }, async ({ requestId, session }) => {
    const result = await getCommitmentControlBrief({ workspaceId: session.workspaceId, actorUserId: session.userId });
    return recoverySuccessResponse(result.data, requestId, result.workspaceVersion);
  });
}