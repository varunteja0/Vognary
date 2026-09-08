import { RecoveryServiceError, recoverySuccessResponse } from "@/lib/server/recovery-api";
import { requireRecoveryUuid, runRecoveryRoute } from "@/lib/server/recovery-route";
import { getControlReconciliationCandidates } from "@/lib/server/commitment-control-store";
import type { ZohoBooksSort } from "@/lib/zoho-books/contracts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ proposalId: string }> }) {
  return runRecoveryRoute(request, {
    namespace: "commitment-control-reconciliation-candidates-read",
    limit: 120,
    windowMs: 60_000,
  }, async ({ requestId, session }) => {
    const proposalId = requireRecoveryUuid((await context.params).proposalId, "Proposal id");
    const params = new URL(request.url).searchParams;
    const source = params.get("source");
    if (source === "ZOHO_BOOKS") {
      for (const key of params.keys()) {
        if (!["source", "cursor", "search", "sort", "currency"].includes(key) || params.getAll(key).length !== 1) {
          throw new RecoveryServiceError("INVALID_EVIDENCE", "Choose only supported provider bill query fields once.");
        }
      }
      const result = await getControlReconciliationCandidates({
        workspaceId: session.workspaceId, actorUserId: session.userId, proposalId, source: "ZOHO_BOOKS",
        cursor: params.get("cursor") ?? undefined, search: params.get("search") ?? undefined,
        sort: (params.get("sort") ?? undefined) as ZohoBooksSort | undefined, currency: params.get("currency") ?? undefined,
      });
      return recoverySuccessResponse(result.data, requestId, result.workspaceVersion);
    }
    if (source !== null && source !== "RECOVERY") throw new RecoveryServiceError("INVALID_EVIDENCE", "Choose a supported reconciliation source.");
    const result = await getControlReconciliationCandidates({
      workspaceId: session.workspaceId,
      actorUserId: session.userId,
      proposalId,
    });
    return recoverySuccessResponse(result.data, requestId, result.workspaceVersion);
  });
}