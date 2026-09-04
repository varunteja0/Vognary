import { normalizeControlExceptionReviewRequest } from "@/lib/commitment-control/contracts";
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
import { recordCommitmentControlExceptionReview } from "@/lib/server/commitment-control-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ proposalId: string }> }) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return recoveryFailureResponse(new RecoveryServiceError("FORBIDDEN"), createRecoveryRequestId());
  return runRecoveryRoute(request, {
    namespace: "commitment-control-exception-review-write",
    limit: 120,
    windowMs: 60 * 60_000,
  }, async ({ requestId, session }) => {
    const proposalId = requireRecoveryUuid((await context.params).proposalId, "Proposal id");
    const preconditions = getRecoveryMutationPreconditions(request);
    const body = await readCommitmentControlRequest(request, normalizeControlExceptionReviewRequest);
    const result = await recordCommitmentControlExceptionReview({
      workspaceId: session.workspaceId,
      actorUserId: session.userId,
      proposalId,
      request: body,
      ...preconditions,
    });
    const attentionProjection = await refreshControlAttentionAfterMutation({
      workspaceId: session.workspaceId,
      requestId,
      routePath: "/api/workspaces/current/control/proposals/[proposalId]/exception-reviews",
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
