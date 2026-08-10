import { recoverySuccessResponse } from "@/lib/server/recovery-api";
import { runRecoveryRoute } from "@/lib/server/recovery-route";
import { getRecoveryHome } from "@/lib/server/recovery-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return runRecoveryRoute(request, {
    namespace: "recovery-home-read",
    limit: 60,
    windowMs: 60_000,
  }, async ({ requestId, session }) => {
    const result = await getRecoveryHome({
      workspaceId: session.workspaceId,
      actorUserId: session.userId,
    });
    return recoverySuccessResponse(result, requestId, result.workspace.version);
  });
}
