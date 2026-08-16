import { recoverySuccessResponse } from "@/lib/server/recovery-api";
import { runRecoveryRoute } from "@/lib/server/recovery-route";
import { listAutopilotDeadLetters } from "@/lib/server/recovery-autopilot-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return runRecoveryRoute(request, {
    namespace: "recovery-autopilot-dead-letters-read",
    limit: 30,
    windowMs: 60 * 60_000,
  }, async ({ requestId, session }) => {
    const result = await listAutopilotDeadLetters({
      workspaceId: session.workspaceId,
      actorUserId: session.userId,
    });
    return recoverySuccessResponse({ items: result.items }, requestId, result.workspaceVersion);
  });
}
