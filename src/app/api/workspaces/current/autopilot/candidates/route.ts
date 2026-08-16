import { recoverySuccessResponse } from "@/lib/server/recovery-api";
import { runRecoveryRoute } from "@/lib/server/recovery-route";
import { listAutopilotCandidates } from "@/lib/server/recovery-autopilot-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return runRecoveryRoute(request, {
    namespace: "recovery-autopilot-candidates-read",
    limit: 60,
    windowMs: 60_000,
  }, async ({ requestId, session }) => {
    const result = await listAutopilotCandidates({
      workspaceId: session.workspaceId,
      actorUserId: session.userId,
    });
    return recoverySuccessResponse({ items: result.items }, requestId, result.workspaceVersion);
  });
}
