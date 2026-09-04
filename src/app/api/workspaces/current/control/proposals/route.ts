import { normalizeControlProposalRequest } from "@/lib/commitment-control/contracts";
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
import { runRecoveryRoute } from "@/lib/server/recovery-route";
import { createCommitmentControlProposal } from "@/lib/server/commitment-control-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return recoveryFailureResponse(new RecoveryServiceError("FORBIDDEN"), createRecoveryRequestId());
  return runRecoveryRoute(request, {
    namespace: "commitment-control-proposal-write",
    limit: 120,
    windowMs: 60 * 60_000,
  }, async ({ requestId, session }) => {
    const preconditions = getRecoveryMutationPreconditions(request);
    const body = await readCommitmentControlRequest(request, normalizeControlProposalRequest);
    const result = await createCommitmentControlProposal({
      workspaceId: session.workspaceId,
      actorUserId: session.userId,
      request: body,
      ...preconditions,
    });
    const attentionProjection = await refreshControlAttentionAfterMutation({
      workspaceId: session.workspaceId,
      requestId,
      routePath: "/api/workspaces/current/control/proposals",
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