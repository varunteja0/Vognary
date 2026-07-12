import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { listWorkspaceConnectedAccounts } from "@/lib/server/connected-account-store";
import { isDatabaseConfigured } from "@/lib/server/database";
import { authenticatePlatformApiToken } from "@/lib/server/platform-api-token-store";
import { createPlatformRequestId, platformError, platformJson } from "@/lib/server/platform-api-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestId = createPlatformRequestId(request);
  if (!isDatabaseConfigured()) return platformError({ requestId, status: 503, code: "service_not_configured", message: "Platform API storage is not configured." });

  const networkLimit = await rateLimit(request, { namespace: "api-v1-sources-network", limit: 120, windowMs: 60_000 });
  if (!networkLimit.allowed) return withRequestId(rateLimitExceeded(networkLimit), requestId);
  const authorization = await authenticatePlatformApiToken(request, "sources:read");
  if (!authorization) return platformError({
    requestId,
    status: 401,
    code: "invalid_token",
    message: "A valid Bearer token with sources:read is required.",
    hint: "Create or rotate a read-only token from the Vognary profile.",
  });
  const tokenLimit = await rateLimit(request, {
    namespace: "api-v1-sources-token",
    identity: `token:${authorization.tokenId}`,
    limit: 600,
    windowMs: 60_000,
  });
  if (!tokenLimit.allowed) return withRequestId(rateLimitExceeded(tokenLimit), requestId);

  const accounts = await listWorkspaceConnectedAccounts(authorization.workspaceId);
  return platformJson({
    apiVersion: "2026-07-11",
    serverTime: new Date().toISOString(),
    data: {
      sources: accounts.map((account) => ({
        id: account.id,
        connectorId: account.connectorId,
        status: account.status,
        freshnessStatus: account.freshnessStatus,
        coverageStartAt: account.coverageStartAt,
        coverageEndAt: account.coverageEndAt,
        coverageCompleteness: account.coverageCompleteness,
        lastSyncedAt: account.lastSyncedAt,
        nextSyncAt: account.nextSyncAt,
        latestRunStatus: account.latestRunStatus,
        evidenceCount: account.evidenceCount,
      })),
    },
  }, requestId);
}

function withRequestId(response: Response, requestId: string) {
  response.headers.set("x-request-id", requestId);
  return response;
}
