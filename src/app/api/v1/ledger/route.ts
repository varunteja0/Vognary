import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import {
  decodePlatformLedgerCursor,
  encodePlatformLedgerCursor,
  normalizePlatformPageLimit,
} from "@/lib/platform-pagination";
import { listWorkspaceCommitmentDecisions } from "@/lib/server/commitment-decision-store";
import { listWorkspaceRecurringItems } from "@/lib/server/connected-account-store";
import { isDatabaseConfigured } from "@/lib/server/database";
import { authenticatePlatformApiToken } from "@/lib/server/platform-api-token-store";
import { createPlatformRequestId, platformError, platformJson } from "@/lib/server/platform-api-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestId = createPlatformRequestId(request);
  if (!isDatabaseConfigured()) return platformError({ requestId, status: 503, code: "service_not_configured", message: "Platform API storage is not configured." });

  const networkLimit = await rateLimit(request, { namespace: "api-v1-ledger-network", limit: 120, windowMs: 60_000 });
  if (!networkLimit.allowed) return withRequestId(rateLimitExceeded(networkLimit), requestId);
  const authorization = await authenticatePlatformApiToken(request, "ledger:read");
  if (!authorization) return platformError({
    requestId,
    status: 401,
    code: "invalid_token",
    message: "A valid Bearer token with ledger:read is required.",
    hint: "Create or rotate a read-only token from the Vognary profile.",
  });
  const tokenLimit = await rateLimit(request, {
    namespace: "api-v1-ledger-token",
    identity: `token:${authorization.tokenId}`,
    limit: 600,
    windowMs: 60_000,
  });
  if (!tokenLimit.allowed) return withRequestId(rateLimitExceeded(tokenLimit), requestId);

  let limit: number;
  let cursor: ReturnType<typeof decodePlatformLedgerCursor>;
  try {
    const url = new URL(request.url);
    limit = normalizePlatformPageLimit(url.searchParams.get("limit"));
    cursor = decodePlatformLedgerCursor(url.searchParams.get("cursor"));
  } catch (error) {
    return platformError({
      requestId,
      status: 400,
      code: "invalid_pagination",
      message: error instanceof Error ? error.message : "Pagination parameters are invalid.",
    });
  }

  const [itemRows, decisionRows] = await Promise.all([
    listWorkspaceRecurringItems(authorization.workspaceId, limit + 1, false, cursor.recurringAfter, true),
    listWorkspaceCommitmentDecisions(authorization.workspaceId, limit + 1, cursor.decisionsAfter, true),
  ]);
  const recurringHasMore = itemRows.length > limit;
  const decisionsHaveMore = decisionRows.length > limit;
  const items = itemRows.slice(0, limit);
  const decisions = decisionRows.slice(0, limit);
  const hasMore = recurringHasMore || decisionsHaveMore;
  const nextCursor = hasMore
    ? encodePlatformLedgerCursor({
      recurringAfter: items.at(-1)?.id ?? cursor.recurringAfter,
      decisionsAfter: decisions.at(-1)?.id ?? cursor.decisionsAfter,
    })
    : null;
  return platformJson({
    apiVersion: "2026-07-11",
    serverTime: new Date().toISOString(),
    data: { recurringItems: items, decisions },
    page: { limit, hasMore, nextCursor },
  }, requestId);
}

function withRequestId(response: Response, requestId: string) {
  response.headers.set("x-request-id", requestId);
  return response;
}
