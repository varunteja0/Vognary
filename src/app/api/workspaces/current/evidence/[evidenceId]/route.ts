import { recoverySuccessResponse } from "@/lib/server/recovery-api";
import { requireRecoveryUuid, runRecoveryRoute } from "@/lib/server/recovery-route";
import { getRecoveryEvidence } from "@/lib/server/recovery-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ evidenceId: string }> };

export async function GET(request: Request, context: RouteContext) {
  return runRecoveryRoute(request, {
    namespace: "recovery-evidence-read",
    limit: 180,
    windowMs: 60_000,
  }, async ({ requestId, session }) => {
    const { evidenceId: rawEvidenceId } = await context.params;
    const evidenceId = requireRecoveryUuid(rawEvidenceId, "evidenceId");
    const result = await getRecoveryEvidence({
      workspaceId: session.workspaceId,
      actorUserId: session.userId,
      evidenceId,
    });
    return recoverySuccessResponse(result.evidence, requestId, result.workspaceVersion);
  });
}