import { getConnectorSummary, getConnectorSyncSummary } from "@/lib/connectors";
import { listConnectorAdapters } from "@/lib/connectors/adapter-registry";
import { checkDatabaseConnection } from "@/lib/server/database";
import { checkSessionConfiguration } from "@/lib/server/session";
import { checkTokenVaultConfiguration } from "@/lib/server/token-vault";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const database = await checkDatabaseConnection();
  const tokenVault = checkTokenVaultConfiguration();
  const session = checkSessionConfiguration();
  const connectorSummary = getConnectorSummary();
  const connectorSyncSummary = getConnectorSyncSummary();
  const connectorAdapters = listConnectorAdapters();

  return Response.json({
    service: "vognary-web",
    status: database.status === "error" ? "degraded" : "ok",
    stage: "stateless-audit-plus-connector-control-plane",
    timestamp: new Date().toISOString(),
    database,
    tokenVault,
    auth: {
      session,
      workspaceAuthorization: database.status === "ready" && session.status === "ready" ? "primitives-ready-no-login" : "not-ready",
    },
    connectors: {
      summary: connectorSummary,
      syncSummary: connectorSyncSummary,
      adapters: connectorAdapters,
    },
    hardening: {
      apiRateLimiting: "in-memory",
      oauthStateValidation: "ready",
      securityHeaders: "configured",
      sessionCookies: session.status,
      workspaceAuthorization: database.status === "ready" && session.status === "ready" ? "primitives-ready-no-login" : "not-ready",
      persistentTokenVault: tokenVault.status,
      connectorTokenStore: database.status === "ready" && tokenVault.status === "ready" ? "ready" : "not-ready",
      directAdapterRegistry: connectorAdapters.length > 0 ? "ready" : "not-configured",
      internalSyncJobApi: process.env.INTERNAL_SYNC_SECRET ? "configured" : "ready-needs-secret",
      syncWorkers: "internal-runner-ready-no-daemon",
      webhookIngestion: process.env.CONNECTOR_WEBHOOK_SECRET ? "configured" : "ready-needs-secret",
    },
  });
}
