import { publicOffer } from "@/lib/billing";
import { getRateLimitBackendStatus } from "@/lib/rate-limit";
import { checkBackupConfiguration } from "@/lib/server/backup-readiness";
import { getBillingCheckoutConfiguration } from "@/lib/server/billing-provider";
import { checkDatabaseConnection } from "@/lib/server/database";
import { checkFeatureReadiness, getUnconfiguredFeatureReadiness } from "@/lib/server/feature-readiness";
import { checkGoogleAuthConfiguration } from "@/lib/server/google-auth";
import { isLeadDatabaseConfigured } from "@/lib/server/lead-store";
import { getMonitoringBackendStatus } from "@/lib/server/monitoring";
import { checkRenewalAlertEmailConfiguration } from "@/lib/server/renewal-alert-mailer";
import { isOperationalSecretValid } from "@/lib/server/internal-auth";
import { getReceiptInboxLaunchReadiness } from "@/lib/server/recovery-inbound-store";
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
  const rateLimitBackend = getRateLimitBackendStatus();
  const monitoringBackend = getMonitoringBackendStatus();
  const googleAuth = checkGoogleAuthConfiguration();
  const backups = checkBackupConfiguration();
  const features = database.status === "ready" ? await checkFeatureReadiness() : getUnconfiguredFeatureReadiness();
  const renewalAlertEmail = checkRenewalAlertEmailConfiguration();
  const schemaDegraded = database.status === "ready" && features.schema.status !== "ready";
  const receiptInboxLaunch = getReceiptInboxLaunchReadiness();
  const receiptInboxMigrationsReady = features.schema.applied?.includes("0053_phase_a_receipt_activation") === true;

  return Response.json({
    service: "vognary-web",
    status: database.status === "error" || schemaDegraded ? "degraded" : "ok",
    stage: "recovery-receipt-forwarding",
    timestamp: new Date().toISOString(),
    database,
    tokenVault,
    auth: {
      session,
      workspaceAuthorization: database.status === "ready" && session.status === "ready" ? "primitives-ready-no-login" : "not-ready",
    },
    capabilities: {
      schema: features.schema,
      recoveryV1: features.recoveryV1,
      autopilot: features.autopilot,
      privacyLifecycle: features.privacyLifecycle,
      renewalAlerts: features.renewalAlerts,
      commitmentDecisions: features.commitmentDecisions,
      platformApi: features.platformApi,
    },
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
      identityProvider: getIdentityProviderStatus(googleAuth),
      receiptInbox: receiptInboxLaunch.status === "ready" && receiptInboxMigrationsReady
        ? "operator-attested-production-live"
        : "activation-pending",
      receiptInboxMissing: [
        ...receiptInboxLaunch.missing,
        ...(receiptInboxMigrationsReady ? [] : ["migration 0053_phase_a_receipt_activation"]),
      ],
      sessionCookies: session.status,
      workspaceAuthorization: database.status === "ready" && session.status === "ready" ? "primitives-ready-no-login" : "not-ready",
      persistentTokenVault: tokenVault.status,
      privacyLifecycle: getPrivacyLifecycleStatus(features.privacyLifecycle),
      retentionScheduler: getRetentionSchedulerStatus(features.privacyLifecycle),
      renewalAlerts: getRenewalAlertStatus(features.renewalAlerts, renewalAlertEmail),
      renewalAlertEmail: renewalAlertEmail.status === "ready" ? "configured" : `missing-${renewalAlertEmail.missing.join("-")}`,
      commitmentDecisions: features.commitmentDecisions.status,
      platformApi: getPlatformApiStatus(features.platformApi, rateLimitBackend),
      recoveryV1: features.recoveryV1.status,
    },
  }, { headers: { "cache-control": "no-store" } });
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

function getIdentityProviderStatus(googleAuth: ReturnType<typeof checkGoogleAuthConfiguration>) {
  if (googleAuth.status === "ready") return "google-ready";
  if (process.env.GOOGLE_AUTH_CLIENT_ID || process.env.GOOGLE_AUTH_CLIENT_SECRET) return `google-missing-${googleAuth.missing.join("-")}`;
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

function getPrivacyLifecycleStatus(feature: { status: string }) {
  return feature.status;
}

function getRetentionSchedulerStatus(feature: { status: string; lastEnforcedAt: string | null }) {
  if (feature.status === "migration-pending" || feature.status === "migration-ledger-unavailable" || feature.status === "schema-query-failed") return feature.status;
  if (process.env.RETENTION_SCHEDULER_STATUS === "production-live" && feature.lastEnforcedAt) return "operator-attested-production-live";
  if (process.env.RETENTION_SCHEDULER_STATUS === "production-live") return "invalid-attestation-no-enforced-run-observed";
  if (feature.lastEnforcedAt) return "last-run-observed-deployment-schedule-unverified";
  if (isOperationalSecretValid(process.env.CRON_SECRET)) return "cron-secret-configured-deployment-schedule-unverified";
  return "cron-route-ready-needs-secret";
}

function getRenewalAlertStatus(
  feature: { status: string; lastSentAt: string | null },
  email: ReturnType<typeof checkRenewalAlertEmailConfiguration>,
) {
  if (feature.status === "migration-pending" || feature.status === "migration-ledger-unavailable" || feature.status === "schema-query-failed") return feature.status;
  if (email.status !== "ready") return "schema-ready-email-not-configured";
  if (!isOperationalSecretValid(process.env.CRON_SECRET)) return "email-ready-cron-secret-missing";
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
