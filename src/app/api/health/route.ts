import { NextResponse } from "next/server";
import { getConnectorSyncSummary } from "@/lib/connectors";
import { listConnectorAdapters } from "@/lib/connectors/adapter-registry";
import { isDatabaseConfigured } from "@/lib/server/database";
import { checkSessionConfiguration } from "@/lib/server/session";
import { checkTokenVaultConfiguration } from "@/lib/server/token-vault";

export const dynamic = "force-dynamic";

export function GET() {
  const connectorSyncSummary = getConnectorSyncSummary();
  const tokenVault = checkTokenVaultConfiguration();
  const connectorAdapters = listConnectorAdapters();
  const session = checkSessionConfiguration();

  return NextResponse.json({
    service: "vognary-web",
    status: "ok",
    mode: "connector-first-recurring-finance",
    timestamp: new Date().toISOString(),
    components: {
      web: "ready",
      auditEngine: "ready",
      statementIngestion: "ready",
      auditApi: "ready",
      pdfIngestion: "ready-beta",
      manualCommitments: "ready",
      reportExport: "ready",
      receiptParser: "ready-beta",
      waitlist: process.env.WAITLIST_WEBHOOK_URL ? "configured" : "preview-not-persisted",
      connectorRegistry: "ready",
      connectorRuntime: "ready",
      connectorStartApi: "ready",
      connectorSyncPlanner: "ready",
      directAdapterRegistry: connectorAdapters.length > 0 ? "ready" : "not-configured",
      directAdapterTargets: connectorAdapters.length,
      apiRateLimiting: "ready-in-memory",
      redisRateLimiting: process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL ? "env-configured-not-wired" : "not-configured",
      gmailOAuthStateProtection: "ready",
      leadPersistence: process.env.AUDIT_INTAKE_WEBHOOK_URL || process.env.WAITLIST_WEBHOOK_URL ? "configured" : "not-configured",
      monitoring: process.env.SENTRY_DSN || process.env.AXIOM_TOKEN || process.env.BETTER_STACK_SOURCE_TOKEN ? "env-configured-needs-sdk" : "not-configured",
      backups: process.env.BACKUP_STORAGE_BUCKET || process.env.S3_BUCKET || process.env.R2_BUCKET ? "env-configured-needs-storage-wiring" : "not-configured",
      identityProvider: process.env.CLERK_SECRET_KEY || process.env.RESEND_API_KEY || process.env.AUTH_PROVIDER ? "env-configured-needs-login-wiring" : "not-configured",
      sessionCookies: session.status,
      workspaceAuthorization: isDatabaseConfigured() && session.status === "ready" ? "primitives-ready-no-login" : "not-configured",
      connectorTargets: connectorSyncSummary.total,
      realtimeCapableTargets: connectorSyncSummary.realtimeCapable,
      tokenVault: tokenVault.status,
      syncScheduler: process.env.INTERNAL_SYNC_SECRET ? "internal-api-configured" : "ready-needs-internal-secret",
      internalSyncJobApi: process.env.INTERNAL_SYNC_SECRET ? "configured" : "ready-needs-secret",
      webhookIngestion: process.env.CONNECTOR_WEBHOOK_SECRET ? "configured" : "ready-needs-secret",
      connectorTokenStore: isDatabaseConfigured() && tokenVault.status === "ready" ? "configured" : "not-configured",
      checkout: process.env.PAYMENT_LINK_FOUNDER_PRO ? "configured" : "ready-with-payment-link-env",
      persistentStorage: "not-configured",
      gmailReceipts: process.env.GOOGLE_CLIENT_ID ? "configured" : "not-configured",
      cloudSaasConnectors: "planned-with-contracts",
      accountAggregator: "not-configured",
      upiMandates: "not-configured",
    },
    connectorSyncSummary,
    productionBoundary: "Ready for stateless audits and connector readiness planning. Persistent connected-account sync requires auth, encrypted token storage, privacy/legal review, and approved provider integrations.",
  });
}