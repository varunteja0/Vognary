import { recoverySuccessResponse } from "@/lib/server/recovery-api";
import { runRecoveryRoute } from "@/lib/server/recovery-route";
import { listWorkspacePeople } from "@/lib/server/workspace-invite-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return runRecoveryRoute(request, {
    namespace: "workspace-members-read",
    limit: 60,
    windowMs: 60_000,
  }, async ({ requestId, session }) => {
    const people = await listWorkspacePeople({
      workspaceId: session.workspaceId,
      actorUserId: session.userId,
    });
    return recoverySuccessResponse(people, requestId, 0);
  });
}
