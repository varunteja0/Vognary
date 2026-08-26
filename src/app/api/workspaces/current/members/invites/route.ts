import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import {
  createRecoveryRequestId,
  RecoveryServiceError,
  recoveryFailureResponse,
  recoverySuccessResponse,
} from "@/lib/server/recovery-api";
import { readRecoveryJson, runRecoveryRoute } from "@/lib/server/recovery-route";
import { createWorkspaceInvite } from "@/lib/server/workspace-invite-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return recoveryFailureResponse(new RecoveryServiceError("FORBIDDEN"), createRecoveryRequestId());
  return runRecoveryRoute(request, {
    namespace: "workspace-members-invite-write",
    limit: 30,
    windowMs: 60 * 60_000,
  }, async ({ requestId, session }) => {
    const body = await readRecoveryJson(request) as { email?: unknown; role?: unknown };
    if (typeof body.email !== "string" || typeof body.role !== "string") {
      throw new RecoveryServiceError("INVALID_EVIDENCE", "Invite email and role are required.");
    }
    const invite = await createWorkspaceInvite({
      workspaceId: session.workspaceId,
      actorUserId: session.userId,
      email: body.email,
      role: body.role,
    });
    return recoverySuccessResponse({ invite }, requestId, 0, 201);
  });
}
