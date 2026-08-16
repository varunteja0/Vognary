import { recoverySuccessResponse } from "@/lib/server/recovery-api";
import { requireRecoveryUuid, runRecoveryRoute } from "@/lib/server/recovery-route";
import { listExecutionAttempts } from "@/lib/server/recovery-autopilot-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ candidateId: string }> };

export async function GET(request: Request, context: RouteContext) {
  return runRecoveryRoute(request, {
    namespace: "recovery-autopilot-attempts",
    limit: 60,
    windowMs: 60 * 60_000,
  }, async ({ requestId, session }) => {
    const { candidateId: rawId } = await context.params;
    const candidateId = requireRecoveryUuid(rawId, "candidateId");
    const result = await listExecutionAttempts({
      workspaceId: session.workspaceId,
      actorUserId: session.userId,
      candidateId,
    });
    return recoverySuccessResponse({ items: result.items }, requestId, result.workspaceVersion);
  });
}
