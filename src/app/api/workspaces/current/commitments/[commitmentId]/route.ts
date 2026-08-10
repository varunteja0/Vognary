import { recoveryLimits } from "@/lib/recovery/contracts";
import { recoverySuccessResponse } from "@/lib/server/recovery-api";
import {
  readRecoveryPageSize,
  requireRecoveryUuid,
  runRecoveryRoute,
} from "@/lib/server/recovery-route";
import { getRecoveryCommitment } from "@/lib/server/recovery-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ commitmentId: string }> };

export async function GET(request: Request, context: RouteContext) {
  return runRecoveryRoute(request, {
    namespace: "recovery-commitment-read",
    limit: 120,
    windowMs: 60_000,
  }, async ({ requestId, session }) => {
    const { commitmentId: rawCommitmentId } = await context.params;
    const commitmentId = requireRecoveryUuid(rawCommitmentId, "commitmentId");
    const url = new URL(request.url);
    const result = await getRecoveryCommitment({
      workspaceId: session.workspaceId,
      actorUserId: session.userId,
      commitmentId,
      evidenceLimit: readRecoveryPageSize(
        url.searchParams.get("evidenceLimit"),
        "evidenceLimit",
        recoveryLimits.maxCommitmentEvidencePageSize,
      ),
      evidenceCursor: url.searchParams.get("evidenceCursor") || undefined,
    });
    return recoverySuccessResponse(result.commitment, requestId, result.workspaceVersion);
  });
}
