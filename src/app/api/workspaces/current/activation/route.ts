import { hasCitedRecurringSpendPicture } from "@/lib/recovery/domain";
import {
  createRecoveryRequestId,
  RecoveryServiceError,
  recoveryFailureResponse,
  recoverySuccessResponse,
} from "@/lib/server/recovery-api";
import { hasActiveConsentGrant } from "@/lib/server/consent-store";
import { recordWorkspaceActivationOnce } from "@/lib/server/product-event-store";
import { runRecoveryRoute } from "@/lib/server/recovery-route";
import { getRecoveryHome } from "@/lib/server/recovery-store";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return recoveryFailureResponse(new RecoveryServiceError("FORBIDDEN"), createRecoveryRequestId());
  return runRecoveryRoute(request, {
    namespace: "recovery-activation-write",
    limit: 30,
    windowMs: 60 * 60_000,
  }, async ({ requestId, session }) => {
    const home = await getRecoveryHome({
      workspaceId: session.workspaceId,
      actorUserId: session.userId,
    });
    const consented = await hasActiveConsentGrant({
      userId: session.userId,
      email: session.email,
      workspaceId: session.workspaceId,
      purpose: "product-analytics-opt-in",
    });
    if (!consented) {
      return recoverySuccessResponse(
        { recorded: false, id: null as string | null, outcome: "deferred-no-consent" as const },
        requestId,
        home.workspace.version,
        202,
      );
    }
    if (!hasCitedRecurringSpendPicture(home)) {
      return recoverySuccessResponse(
        { recorded: false, id: null as string | null, outcome: "deferred-no-picture" as const },
        requestId,
        home.workspace.version,
      );
    }
    const recorded = await recordWorkspaceActivationOnce({
      workspaceId: session.workspaceId,
      userId: session.userId,
      commitmentsTouched: home.activeCommitmentCount,
      evidenceWritten: home.coverage.evidenceCount,
    });
    return recoverySuccessResponse(
      {
        recorded: recorded.recorded,
        id: recorded.id,
        outcome: recorded.recorded ? "recorded" as const : "already-recorded" as const,
      },
      requestId,
      home.workspace.version,
      recorded.recorded ? 201 : 200,
    );
  });
}
