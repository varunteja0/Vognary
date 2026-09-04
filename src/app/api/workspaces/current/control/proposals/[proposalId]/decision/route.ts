import { normalizeControlDecisionRequest } from "@/lib/commitment-control/contracts";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import {
  createRecoveryRequestId,
  getRecoveryMutationPreconditions,
  RecoveryServiceError,
  recoveryFailureResponse,
  recoverySuccessResponse,
} from "@/lib/server/recovery-api";
import { readCommitmentControlRequest } from "@/lib/server/commitment-control-route";
import { refreshControlAttentionAfterMutation } from "@/lib/server/commitment-control-attention-trigger";
import { requireRecoveryUuid, runRecoveryRoute } from "@/lib/server/recovery-route";
import { decideCommitmentControlProposal } from "@/lib/server/commitment-control-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ proposalId: string }> }) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return recoveryFailureResponse(new RecoveryServiceError("FORBIDDEN"), createRecoveryRequestId());
  return runRecoveryRoute(request, {
    namespace: "commitment-control-decision-write",
    limit: 120,
    windowMs: 60 * 60_000,
  }, async ({ requestId, session }) => {
    const proposalId = requireRecoveryUuid((await context.params).proposalId, "Proposal id");
    const preconditions = getRecoveryMutationPreconditions(request);
    const body = await readCommitmentControlRequest(request, normalizeControlDecisionRequest);
    const result = await decideCommitmentControlProposal({
      workspaceId: session.workspaceId,
      actorUserId: session.userId,
      proposalId,
      request: body,
      ...preconditions,
    });
    const attentionProjection = await refreshControlAttentionAfterMutation({
      workspaceId: session.workspaceId,
      requestId,
      routePath: "/api/workspaces/current/control/proposals/[proposalId]/decision",
    });
    return recoverySuccessResponse(
      result.data,
      requestId,
      result.workspaceVersion,
      result.replayed ? 200 : 201,
      { attentionProjection },
    );
  });
}