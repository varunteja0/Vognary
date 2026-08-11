import type { ReceiptInboxStatusDto } from "@/lib/recovery/contracts";
import {
  RecoveryServiceError,
  recoverySuccessResponse,
} from "@/lib/server/recovery-api";
import {
  getReceiptInboxConfiguration,
  getReceiptInboxWorkspaceVersion,
} from "@/lib/server/recovery-inbound-store";
import { runRecoveryRoute } from "@/lib/server/recovery-route";

type ReceiptInboxRouteContext = {
  workspaceId: string;
  actorUserId: string;
};

export async function runReceiptInboxRoute(
  request: Request,
  options: { namespace: string; mutation?: boolean; configurationRequired?: boolean },
  handler: (context: ReceiptInboxRouteContext) => Promise<ReceiptInboxStatusDto | Response>,
) {
  return runRecoveryRoute(request, {
    namespace: options.namespace,
    limit: options.mutation ? 20 : 120,
    windowMs: 60_000,
  }, async ({ requestId, session }) => {
    const readiness = getReceiptInboxConfiguration();
    if (options.configurationRequired !== false && readiness.status !== "ready") {
      throw new RecoveryServiceError("FEATURE_UNAVAILABLE", readiness.message);
    }

    const data = await handler({ workspaceId: session.workspaceId, actorUserId: session.userId });
    if (data instanceof Response) return data;
    const workspaceVersion = await getReceiptInboxWorkspaceVersion(session.workspaceId);
    return recoverySuccessResponse(data, requestId, workspaceVersion);
  });
}