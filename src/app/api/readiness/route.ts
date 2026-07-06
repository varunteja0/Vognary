import { getConnectorSummary, getConnectorSyncSummary } from "@/lib/connectors";
import { getRateLimitBackendStatus } from "@/lib/rate-limit";
import { listConnectorAdapters } from "@/lib/connectors/adapter-registry";
import { checkDatabaseConnection } from "@/lib/server/database";
import { checkGoogleAuthConfiguration } from "@/lib/server/google-auth";
import { isLeadDatabaseConfigured } from "@/lib/server/lead-store";
import { checkMagicLinkConfiguration } from "@/lib/server/magic-link-auth";
import { getMonitoringBackendStatus } from "@/lib/server/monitoring";
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
  const rateLimitBackend = getRateLimitBackendStatus();
  const monitoringBackend = getMonitoringBackendStatus();
  const magicLink = checkMagicLinkConfiguration();
  const googleAuth = checkGoogleAuthConfiguration();

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
      apiRateLimiting: rateLimitBackend === "upstash-rest" ? "shared-upstash" : "in-memory",
      redisRateLimiting: getRedisRateLimitStatus(rateLimitBackend),
      oauthStateValidation: "ready",
      securityHeaders: "configured",
      leadPersistence: getLeadPersistenceStatus(),
      payments: process.env.PAYMENT_LINK_FOUNDER_PRO ? "configured" : "not-configured",
      monitoring: getMonitoringStatus(monitoringBackend),
      backups: getBackupStatus(),
      identityProvider: getIdentityProviderStatus(magicLink, googleAuth),
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
