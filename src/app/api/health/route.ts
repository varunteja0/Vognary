import { NextResponse } from "next/server";
import { getRateLimitBackendStatus } from "@/lib/rate-limit";
import { getConnectorSyncSummary } from "@/lib/connectors";
import { listConnectorAdapters } from "@/lib/connectors/adapter-registry";
import { isDatabaseConfigured } from "@/lib/server/database";
import { checkGoogleAuthConfiguration } from "@/lib/server/google-auth";
import { isLeadDatabaseConfigured } from "@/lib/server/lead-store";
import { checkMagicLinkConfiguration } from "@/lib/server/magic-link-auth";
import { getMonitoringBackendStatus } from "@/lib/server/monitoring";
import { checkSessionConfiguration } from "@/lib/server/session";
import { checkTokenVaultConfiguration } from "@/lib/server/token-vault";

export const dynamic = "force-dynamic";

export function GET() {
  const connectorSyncSummary = getConnectorSyncSummary();
  const tokenVault = checkTokenVaultConfiguration();
  const connectorAdapters = listConnectorAdapters();
  const session = checkSessionConfiguration();
  const rateLimitBackend = getRateLimitBackendStatus();
  const monitoringBackend = getMonitoringBackendStatus();
  const magicLink = checkMagicLinkConfiguration();
  const googleAuth = checkGoogleAuthConfiguration();

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
      waitlist: getLeadPersistenceStatus(),
      connectorRegistry: "ready",
      connectorRuntime: "ready",
      connectorStartApi: "ready",
      connectorSyncPlanner: "ready",
      directAdapterRegistry: connectorAdapters.length > 0 ? "ready" : "not-configured",
      directAdapterTargets: connectorAdapters.length,
      apiRateLimiting: rateLimitBackend === "upstash-rest" ? "ready-shared-upstash" : "ready-in-memory",
      redisRateLimiting: getRedisRateLimitStatus(rateLimitBackend),
      gmailOAuthStateProtection: "ready",
      leadPersistence: getLeadPersistenceStatus(),
      monitoring: getMonitoringStatus(monitoringBackend),
      backups: getBackupStatus(),
      identityProvider: getIdentityProviderStatus(magicLink, googleAuth),
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
      accountAggregator: normalizePartnerRailStatus(process.env.ACCOUNT_AGGREGATOR_PARTNER_STATUS) ?? "not-configured",
      upiMandates: normalizePartnerRailStatus(process.env.UPI_MANDATE_PARTNER_STATUS) ?? "not-configured",
      cardMandates: normalizePartnerRailStatus(process.env.CARD_MANDATE_PARTNER_STATUS) ?? "not-configured",
    },
    connectorSyncSummary,
    productionBoundary: "Ready for stateless audits and connector readiness planning. Persistent connected-account sync requires auth, encrypted token storage, privacy/legal review, and approved provider integrations.",
  });
}

function getRedisRateLimitStatus(rateLimitBackend: ReturnType<typeof getRateLimitBackendStatus>) {
  if (rateLimitBackend === "upstash-rest") return "configured";
  if (rateLimitBackend === "upstash-missing-token") return "missing-upstash-token";
  if (rateLimitBackend === "redis-url-configured-not-wired") return "redis-url-configured-not-wired";
  return "not-configured";
}

function getMonitoringStatus(monitoringBackend: ReturnType<typeof getMonitoringBackendStatus>) {
  if (monitoringBackend === "sentry") return "configured-sentry-server-errors";
  if (monitoringBackend === "better-stack") return "configured-better-stack-server-errors";
  if (monitoringBackend === "axiom-token-configured-needs-dataset") return "axiom-token-configured-needs-dataset";
  return "not-configured";
}

function getIdentityProviderStatus(magicLink: ReturnType<typeof checkMagicLinkConfiguration>, googleAuth: ReturnType<typeof checkGoogleAuthConfiguration>) {
  if (googleAuth.status === "ready") return "google-ready";
  if (magicLink.status === "ready") return "magic-link-ready";
  if (process.env.GOOGLE_AUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_AUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET) return `google-missing-${googleAuth.missing.join("-")}`;
  if (process.env.RESEND_API_KEY || process.env.RESEND_FROM_EMAIL) return `magic-link-missing-${magicLink.missing.join("-")}`;
  if (process.env.CLERK_SECRET_KEY) return "clerk-configured-needs-adapter";
  if (process.env.AUTH_PROVIDER) return "provider-configured-needs-adapter";
  return "not-configured";
}

function getBackupStatus() {
  const hasStorage = Boolean(process.env.BACKUP_STORAGE_BUCKET || process.env.S3_BUCKET || process.env.R2_BUCKET);
  const restoreDrillPassed = process.env.BACKUP_RESTORE_DRILL_STATUS?.trim().toLowerCase() === "passed";
  if (hasStorage && restoreDrillPassed) return "configured";
  if (hasStorage) return "storage-configured-restore-drill-required";
  if (restoreDrillPassed) return "restore-drill-recorded-needs-storage";
  return "not-configured";
}

function getLeadPersistenceStatus() {
  if (isLeadDatabaseConfigured()) return "configured-database";
  if (process.env.AUDIT_INTAKE_WEBHOOK_URL || process.env.WAITLIST_WEBHOOK_URL) return "configured-webhook";
  return "not-configured";
}

function normalizePartnerRailStatus(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}