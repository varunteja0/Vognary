import { recoverySuccessResponse } from "@/lib/server/recovery-api";
import { requireRecoveryUuid, runRecoveryRoute } from "@/lib/server/recovery-route";
import { getControlReconciliationCandidates } from "@/lib/server/commitment-control-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ proposalId: string }> }) {
  return runRecoveryRoute(request, {
    namespace: "commitment-control-reconciliation-candidates-read",
    limit: 120,
    windowMs: 60_000,
  }, async ({ requestId, session }) => {
    const proposalId = requireRecoveryUuid((await context.params).proposalId, "Proposal id");
    const result = await getControlReconciliationCandidates({
      workspaceId: session.workspaceId,
      actorUserId: session.userId,
      proposalId,
    });
    return recoverySuccessResponse(result.data, requestId, result.workspaceVersion);
  });
}