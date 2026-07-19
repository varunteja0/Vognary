import { getConnectorSummary, getConnectorSyncSummary } from "@/lib/connectors";
import { publicOffer } from "@/lib/billing";
import { getRateLimitBackendStatus } from "@/lib/rate-limit";
import { listConnectorAdapters } from "@/lib/connectors/adapter-registry";
import { getPartnerRailsMissingProductionRails, getPartnerRailsStatus, getPartnerRailStatuses } from "@/lib/partner-rails";
import { checkBackupConfiguration } from "@/lib/server/backup-readiness";
import { getBillingCheckoutConfiguration } from "@/lib/server/billing-provider";
import { checkDatabaseConnection } from "@/lib/server/database";
import { checkFeatureReadiness, getUnconfiguredFeatureReadiness } from "@/lib/server/feature-readiness";
import { checkGoogleAuthConfiguration } from "@/lib/server/google-auth";
import { isLeadDatabaseConfigured } from "@/lib/server/lead-store";
import { checkMagicLinkConfiguration } from "@/lib/server/magic-link-auth";
import { getMonitoringBackendStatus } from "@/lib/server/monitoring";
import { checkRenewalAlertEmailConfiguration } from "@/lib/server/renewal-alert-mailer";
import { checkSessionConfiguration } from "@/lib/server/session";
import { checkTokenVaultConfiguration } from "@/lib/server/token-vault";
import { requireInternalSecret } from "@/lib/server/internal-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    const unauthorized = requireInternalSecret(request);
    if (unauthorized) return unauthorized;
  }

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
  const backups = checkBackupConfiguration();
  const features = database.status === "ready" ? await checkFeatureReadiness() : getUnconfiguredFeatureReadiness();
  const renewalAlertEmail = checkRenewalAlertEmailConfiguration();
  const schemaDegraded = database.status === "ready" && features.schema.status !== "ready";
  const coreConnectorLaunch = getCoreConnectorLaunchStatus({
    databaseReady: database.status === "ready",
    tokenVaultReady: tokenVault.status === "ready",
  });

  return Response.json({
    service: "vognary-web",
    status: database.status === "error" || schemaDegraded ? "degraded" : "ok",
    stage: "recurring-ledger-with-opt-in-automation-and-read-only-platform-api",
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
    capabilities: features,
    hardening: {
      apiRateLimiting: getApiRateLimitStatus(rateLimitBackend),
      sharedRateLimiting: getSharedRateLimitStatus(rateLimitBackend),
      redisRateLimiting: getRedisRateLimitStatus(rateLimitBackend),
      oauthStateValidation: "ready",
      securityHeaders: "configured",
      leadPersistence: getLeadPersistenceStatus(),
      payments: getPaymentStatus(features.billing),
      monitoring: getMonitoringStatus(monitoringBackend),
      backups: backups.status,
      backupReadiness: backups,
      identityProvider: getIdentityProviderStatus(magicLink, googleAuth),
      partnerRails: getPartnerRailsStatus(),
      partnerRailStatuses: getPartnerRailStatuses(),
      partnerRailsMissingProduction: getPartnerRailsMissingProductionRails(),
      coreConnectorLaunch: coreConnectorLaunch.status,
      coreConnectorLaunchMissing: coreConnectorLaunch.missing,
      sessionCookies: session.status,
      workspaceAuthorization: database.status === "ready" && session.status === "ready" ? "primitives-ready-no-login" : "not-ready",
      persistentTokenVault: tokenVault.status,
      connectorTokenStore: database.status === "ready" && tokenVault.status === "ready" ? "ready" : "not-ready",
      directAdapterRegistry: connectorAdapters.length > 0 ? "ready" : "not-configured",
      internalSyncJobApi: process.env.INTERNAL_SYNC_SECRET ? "configured" : "ready-needs-secret",
      syncWorkers: getSyncWorkerStatus(features.syncWorkers),
      privacyLifecycle: getPrivacyLifecycleStatus(features.privacyLifecycle),
      retentionScheduler: getRetentionSchedulerStatus(features.privacyLifecycle),
      renewalAlerts: getRenewalAlertStatus(features.renewalAlerts, renewalAlertEmail),
      renewalAlertEmail: renewalAlertEmail.status === "ready" ? "configured" : `missing-${renewalAlertEmail.missing.join("-")}`,
      commitmentDecisions: features.commitmentDecisions.status,
      platformApi: getPlatformApiStatus(features.platformApi, rateLimitBackend),
      webhookIngestion: process.env.CONNECTOR_WEBHOOK_SECRET ? "configured" : "ready-needs-secret",
    },
  }, { headers: { "cache-control": "no-store" } });
}

function getCoreConnectorLaunchStatus(input: { databaseReady: boolean; tokenVaultReady: boolean }) {
  const missing = [
    input.databaseReady ? null : "DATABASE_URL",
    input.tokenVaultReady ? null : "TOKEN_ENCRYPTION_KEY",
    process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_AUTH_CLIENT_ID ? null : "GOOGLE_CLIENT_ID or GOOGLE_AUTH_CLIENT_ID",
    process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_AUTH_CLIENT_SECRET ? null : "GOOGLE_CLIENT_SECRET or GOOGLE_AUTH_CLIENT_SECRET",
    process.env.GOOGLE_REDIRECT_URI?.trim() ? null : "GOOGLE_REDIRECT_URI",
    process.env.GOOGLE_OAUTH_VERIFICATION_COMPLETE === "true" ? null : "GOOGLE_OAUTH_VERIFICATION_COMPLETE=true",
    process.env.SETU_AA_CLIENT_ID?.trim() ? null : "SETU_AA_CLIENT_ID",
    process.env.SETU_AA_CLIENT_SECRET?.trim() ? null : "SETU_AA_CLIENT_SECRET",
    process.env.SETU_AA_PRODUCT_INSTANCE_ID?.trim() ? null : "SETU_AA_PRODUCT_INSTANCE_ID",
    process.env.ACCOUNT_AGGREGATOR_PARTNER_STATUS?.trim() === "production-live" ? null : "ACCOUNT_AGGREGATOR_PARTNER_STATUS=production-live",
    isApprovedProductionSetuUrl(process.env.SETU_AA_BASE_URL) ? null : "SETU_AA_BASE_URL (approved production FIU endpoint)",
  ].filter((value): value is string => Boolean(value));
  return {
    status: missing.length ? "activation-pending" as const : "production-live" as const,
    missing: [...new Set(missing)],
  };
}

function isApprovedProductionSetuUrl(value: string | undefined) {
  if (!value?.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !/sandbox/i.test(`${url.hostname}${url.pathname}`);
  } catch {
    return false;
  }
}

function getApiRateLimitStatus(rateLimitBackend: ReturnType<typeof getRateLimitBackendStatus>) {
  if (rateLimitBackend === "upstash-rest") return "shared-upstash";
  if (rateLimitBackend === "postgres") return "shared-postgres";
  if (rateLimitBackend === "shared-required-not-configured") return "blocked-shared-backend-required";
  return "in-memory";
}

function getSharedRateLimitStatus(rateLimitBackend: ReturnType<typeof getRateLimitBackendStatus>) {
  if (rateLimitBackend === "upstash-rest") return "configured-upstash-rest";
  if (rateLimitBackend === "postgres") return "configured-postgres";
  if (rateLimitBackend === "upstash-missing-token") return "missing-upstash-token";
  if (rateLimitBackend === "redis-url-configured-not-wired") return "redis-url-configured-not-wired";
  if (rateLimitBackend === "shared-required-not-configured") return "required-not-configured";
  return "not-configured";
}

function getRedisRateLimitStatus(rateLimitBackend: ReturnType<typeof getRateLimitBackendStatus>) {
  if (rateLimitBackend === "upstash-rest") return "configured";
  if (rateLimitBackend === "postgres") return "not-configured-postgres-active";
  if (rateLimitBackend === "upstash-missing-token") return "missing-upstash-token";
  if (rateLimitBackend === "redis-url-configured-not-wired") return "redis-url-configured-not-wired";
  if (rateLimitBackend === "shared-required-not-configured") return "required-not-configured";
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

function getLeadPersistenceStatus() {
  if (isLeadDatabaseConfigured()) return "configured-database";
  if (process.env.AUDIT_INTAKE_WEBHOOK_URL || process.env.WAITLIST_WEBHOOK_URL) return "configured-webhook";
  return "not-configured";
}

function getPaymentStatus(feature: { status: string; assistedAuditOrders: number | null; lastPaidAt: string | null }) {
  if (feature.status === "migration-pending" || feature.status === "migration-ledger-unavailable" || feature.status === "schema-query-failed") return feature.status;
  const configuration = getBillingCheckoutConfiguration(publicOffer.plan);
  if (configuration.status !== "ready") return "not-configured";
  if (feature.assistedAuditOrders && feature.assistedAuditOrders > 0 && feature.lastPaidAt) return "settlement-observed";
  if (feature.lastPaidAt) return "payment-observed-no-assisted-audit-order";
  return "tracked-checkout-ready-settlement-unproven";
}

function getSyncWorkerStatus(feature: { status: string; lastCronEvidenceAt: string | null }) {
  if (feature.status === "migration-pending" || feature.status === "migration-ledger-unavailable" || feature.status === "schema-query-failed") return feature.status;
  if (process.env.SYNC_SCHEDULER_STATUS === "production-live" && process.env.CRON_SECRET && feature.lastCronEvidenceAt) return "operator-attested-production-live";
  if (process.env.SYNC_SCHEDULER_STATUS === "production-live" && !feature.lastCronEvidenceAt) return "invalid-attestation-no-cron-evidence";
  if (process.env.SYNC_SCHEDULER_STATUS === "production-live") return "invalid-attestation-missing-cron-secret";
  if (feature.lastCronEvidenceAt) return "cron-evidence-observed-deployment-schedule-unverified";
  if (process.env.CRON_SECRET) return "cron-secret-configured-deployment-schedule-unverified";
  return "cron-route-ready-needs-secret";
}

function getPrivacyLifecycleStatus(feature: { status: string }) {
  return feature.status;
}

function getRetentionSchedulerStatus(feature: { status: string; lastEnforcedAt: string | null }) {
  if (feature.status === "migration-pending" || feature.status === "migration-ledger-unavailable" || feature.status === "schema-query-failed") return feature.status;
  if (process.env.RETENTION_SCHEDULER_STATUS === "production-live" && feature.lastEnforcedAt) return "operator-attested-production-live";
  if (process.env.RETENTION_SCHEDULER_STATUS === "production-live") return "invalid-attestation-no-enforced-run-observed";
  if (feature.lastEnforcedAt) return "last-run-observed-deployment-schedule-unverified";
  if (process.env.CRON_SECRET) return "cron-secret-configured-deployment-schedule-unverified";
  return "cron-route-ready-needs-secret";
}

function getRenewalAlertStatus(
  feature: { status: string; lastSentAt: string | null },
  email: ReturnType<typeof checkRenewalAlertEmailConfiguration>,
) {
  if (feature.status === "migration-pending" || feature.status === "migration-ledger-unavailable" || feature.status === "schema-query-failed") return feature.status;
  if (email.status !== "ready") return "schema-ready-email-not-configured";
  if (!process.env.CRON_SECRET) return "email-ready-cron-secret-missing";
  if (process.env.RENEWAL_ALERT_DELIVERY_STATUS === "production-live" && feature.lastSentAt) return "operator-attested-production-live";
  if (process.env.RENEWAL_ALERT_DELIVERY_STATUS === "production-live") return "invalid-attestation-no-delivery-observed";
  if (feature.lastSentAt) return "delivery-observed-deployment-schedule-unverified";
  return "worker-configured-delivery-unproven";
}

function getPlatformApiStatus(
  feature: { status: string },
  rateLimitBackend: ReturnType<typeof getRateLimitBackendStatus>,
) {
  if (feature.status === "migration-pending" || feature.status === "migration-ledger-unavailable" || feature.status === "schema-query-failed") return feature.status;
  if (rateLimitBackend !== "upstash-rest" && rateLimitBackend !== "postgres") return "schema-ready-shared-rate-limit-required";
  return feature.status;
}
