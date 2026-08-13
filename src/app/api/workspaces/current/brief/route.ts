import { recoverySuccessResponse } from "@/lib/server/recovery-api";
import { recordProductEvent } from "@/lib/server/product-event-store";
import { runRecoveryRoute } from "@/lib/server/recovery-route";
import { getRecoveryHome } from "@/lib/server/recovery-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return runRecoveryRoute(request, {
    namespace: "recovery-home-read",
    limit: 60,
    windowMs: 60_000,
  }, async ({ requestId, session }) => {
    const result = await getRecoveryHome({
      workspaceId: session.workspaceId,
      actorUserId: session.userId,
    });
    // Distinct users per day here are the only available return-visit signal.
    await recordProductEvent({
      workspaceId: session.workspaceId,
      userId: session.userId,
      eventName: "ledger.viewed",
      source: "workspace-api",
      status: "succeeded",
      metrics: { commitmentsTouched: result.next.length },
    }).catch(() => undefined);
    return recoverySuccessResponse(result, requestId, result.workspace.version);
  });
}
