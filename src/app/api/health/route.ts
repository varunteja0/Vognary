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
      gmailOAuthStateProtection: "ready",
      sessionCookies: session.status,
      workspaceAuthorization: isDatabaseConfigured() && session.status === "ready" ? "configured" : "not-configured",
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