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
      redisRateLimiting: process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL ? "env-configured-not-wired" : "not-configured",
      oauthStateValidation: "ready",
      securityHeaders: "configured",
      leadPersistence: process.env.AUDIT_INTAKE_WEBHOOK_URL || process.env.WAITLIST_WEBHOOK_URL ? "configured" : "not-configured",
      payments: process.env.PAYMENT_LINK_FOUNDER_PRO ? "configured" : "not-configured",
      monitoring: process.env.SENTRY_DSN || process.env.AXIOM_TOKEN || process.env.BETTER_STACK_SOURCE_TOKEN ? "env-configured-needs-sdk" : "not-configured",
      backups: process.env.BACKUP_STORAGE_BUCKET || process.env.S3_BUCKET || process.env.R2_BUCKET ? "env-configured-needs-storage-wiring" : "not-configured",
      identityProvider: process.env.CLERK_SECRET_KEY || process.env.RESEND_API_KEY || process.env.AUTH_PROVIDER ? "env-configured-needs-login-wiring" : "not-configured",
      partnerRails: process.env.ACCOUNT_AGGREGATOR_PARTNER_STATUS || process.env.UPI_MANDATE_PARTNER_STATUS || process.env.CARD_MANDATE_PARTNER_STATUS ? "partner-status-recorded" : "not-configured",
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
