import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import {
  createRecoveryRequestId,
  RecoveryServiceError,
  recoveryFailureResponse,
  recoverySuccessResponse,
} from "@/lib/server/recovery-api";
import { requireRecoveryUuid, runRecoveryRoute } from "@/lib/server/recovery-route";
import { revokeWorkspaceInvite } from "@/lib/server/workspace-invite-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ inviteId: string }> },
) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return recoveryFailureResponse(new RecoveryServiceError("FORBIDDEN"), createRecoveryRequestId());
  return runRecoveryRoute(request, {
    namespace: "workspace-members-invite-revoke",
    limit: 30,
    windowMs: 60 * 60_000,
  }, async ({ requestId, session }) => {
    const { inviteId } = await context.params;
    await revokeWorkspaceInvite({
      workspaceId: session.workspaceId,
      actorUserId: session.userId,
      inviteId: requireRecoveryUuid(inviteId, "Invite id"),
    });
    return recoverySuccessResponse({ revoked: true }, requestId, 0);
  });
}
