import {
  createRecoveryRequestId,
  getRecoveryMutationPreconditions,
  normalizeCorrectionRequest,
  RecoveryServiceError,
  recoveryFailureResponse,
  recoverySuccessResponse,
} from "@/lib/server/recovery-api";
import {
  readRecoveryJson,
  requireRecoveryUuid,
  runRecoveryRoute,
} from "@/lib/server/recovery-route";
import { createRecoveryCorrection } from "@/lib/server/recovery-store";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ commitmentId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return recoveryFailureResponse(new RecoveryServiceError("FORBIDDEN"), createRecoveryRequestId());
  return runRecoveryRoute(request, {
    namespace: "recovery-corrections-write",
    limit: 120,
    windowMs: 60 * 60_000,
  }, async ({ requestId, session }) => {
    const { commitmentId: rawCommitmentId } = await context.params;
    const commitmentId = requireRecoveryUuid(rawCommitmentId, "commitmentId");
    const preconditions = getRecoveryMutationPreconditions(request);
    const body = normalizeCorrectionRequest(await readRecoveryJson(request));
    const result = await createRecoveryCorrection({
      workspaceId: session.workspaceId,
      actorUserId: session.userId,
      commitmentId,
      request: body,
      ...preconditions,
    });
    return recoverySuccessResponse(result.data, requestId, result.workspaceVersion, result.replayed ? 200 : 201);
  });
}
