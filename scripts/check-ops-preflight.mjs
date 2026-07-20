import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parseBackupEncryptionKey, fingerprintKey, hasPostgresClientTool, isDockerUsable } from "./lib/postgres-backup-utils.mjs";
import { getBackupStorageConfig } from "./lib/backup-storage.mjs";

for (const file of [".env.local", ".env"]) loadEnvFile(file);

const args = process.argv.slice(2);
const reportOnly = args.includes("--report-only");
const urlArg = args.find((arg) => arg.startsWith("http://") || arg.startsWith("https://"));

if (args.includes("--help")) {
  console.log(`Check local and production operational prerequisites without printing secrets.\n\nUsage:\n  npm run ops:preflight -- --report-only https://www.vognary.com\n  npm run ops:preflight -- https://www.vognary.com\n\nDefault exits non-zero when P0 prerequisites are missing. Use --report-only for an evidence report.`);
  process.exit(0);
}

const storage = getBackupStorageConfig();
const backupKey = checkBackupKey();
const checks = [
  postgresToolCheck("pg_dump"),
  postgresToolCheck("pg_restore"),
  envCheck("DATABASE_URL"),
  { id: "backup-key", label: "Backup encryption key", ready: backupKey.ready, missing: backupKey.ready ? [] : ["BACKUP_ENCRYPTION_KEY"], detail: backupKey.detail },
  { id: "backup-storage-upload", label: "Encrypted backup object storage upload", ready: storage.ready, missing: storage.missing },
  envCheck("BACKUP_RESTORE_DRILL_STATUS", (value) => value.trim().toLowerCase() === "passed", "BACKUP_RESTORE_DRILL_STATUS=passed"),
  anyEnvCheck("monitoring", "Monitoring delivery backend", ["SENTRY_DSN", "BETTER_STACK_SOURCE_TOKEN"]),
  envCheck("INTERNAL_SYNC_SECRET"),
  envCheck("CRON_SECRET"),
  envCheck("SYNC_SCHEDULER_STATUS", (value) => value.trim() === "production-live", "SYNC_SCHEDULER_STATUS=production-live"),
  envCheck("RENEWAL_ALERT_DELIVERY_STATUS", (value) => value.trim() === "production-live", "RENEWAL_ALERT_DELIVERY_STATUS=production-live"),
  envCheck("RETENTION_SCHEDULER_STATUS", (value) => value.trim() === "production-live", "RETENTION_SCHEDULER_STATUS=production-live"),
];

const production = urlArg ? await readProductionReadiness(urlArg) : undefined;
const ready = checks.every((check) => check.ready) && (!production || production.ready);

console.log(JSON.stringify({
  status: ready ? "ready" : "blocked",
  checkedAt: new Date().toISOString(),
  checks,
  production,
}, null, 2));

if (!reportOnly && !ready) process.exit(1);

function postgresToolCheck(command) {
  const direct = commandExists(command);
  const dockerInstalled = commandExists("docker");
  const dockerUsable = isDockerUsable();
  return {
    id: command,
    label: `${command} available directly or through usable Docker fallback`,
    ready: hasPostgresClientTool(command),
    missing: direct || dockerUsable ? [] : [command, dockerInstalled ? "running Docker daemon" : "docker"],
    detail: { direct, dockerInstalled, dockerFallback: !direct && dockerUsable },
  };
}

function commandExists(command) {
  return spawnSync("which", [command], { stdio: "ignore" }).status === 0;
}

function envCheck(name, predicate = (value) => value.trim().length > 0, expected = name) {
  const value = process.env[name] ?? "";
  const ready = Boolean(value && predicate(value));
  return { id: name, label: expected, ready, missing: ready ? [] : [expected] };
}

function anyEnvCheck(id, label, names) {
  const ready = names.some((name) => process.env[name]?.trim());
  return { id, label, ready, missing: ready ? [] : [`one of: ${names.join(" | ")}`] };
}

function checkBackupKey() {
  try {
    const key = parseBackupEncryptionKey(process.env.BACKUP_ENCRYPTION_KEY);
    return { ready: true, detail: { keyFingerprint: fingerprintKey(key) } };
  } catch (error) {
    return { ready: false, detail: { message: error instanceof Error ? error.message : "Backup key is invalid." } };
  }
}

async function readProductionReadiness(baseUrl) {
  try {
    const targetInternalSecret = process.env.PRODUCTION_INTERNAL_SYNC_SECRET?.trim()
      || process.env.INTERNAL_SYNC_SECRET?.trim()
      || "";
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/readiness`, {
      headers: { authorization: `Bearer ${targetInternalSecret}` },
      signal: AbortSignal.timeout(8000),
    });
    const payload = await response.json();
    if (response.status === 401) {
      return {
        baseUrl,
        httpStatus: response.status,
        ready: false,
        error: "Production readiness authentication failed. The operator secret does not match the deployed INTERNAL_SYNC_SECRET.",
        blocked: ["readinessAuthentication"],
      };
    }
    const hardening = payload.hardening ?? {};
    const capabilityQueriesReady = [
      payload.capabilities?.privacyLifecycle,
      payload.capabilities?.renewalAlerts,
      payload.capabilities?.commitmentDecisions,
      payload.capabilities?.platformApi,
    ].every((capability) => capability?.status && capability.status !== "schema-query-failed");
    const sharedRateLimitingReady = typeof hardening.sharedRateLimiting === "string"
      ? hardening.sharedRateLimiting.startsWith("configured-")
      : hardening.redisRateLimiting === "configured";
    const blocked = [
      sharedRateLimitingReady ? null : "sharedRateLimiting",
      typeof hardening.monitoring === "string" && hardening.monitoring.startsWith("configured-") ? null : "monitoring",
      hardening.backups === "configured" ? null : "backups",
      hardening.syncWorkers === "operator-attested-production-live" ? null : "syncWorkers",
      payload.capabilities?.schema?.status === "ready" ? null : "featureMigrations",
      capabilityQueriesReady ? null : "featureCapabilityQueries",
      hardening.retentionScheduler === "operator-attested-production-live" ? null : "retentionScheduler",
      hardening.renewalAlerts === "operator-attested-production-live" ? null : "renewalAlerts",
      hardening.platformApi === "schema-ready-shared-rate-limit-required" ? "platformApi" : null,
    ].filter(Boolean);

    return {
      baseUrl,
      httpStatus: response.status,
      ready: response.ok && blocked.length === 0,
      hardening: {
        sharedRateLimiting: hardening.sharedRateLimiting,
        redisRateLimiting: hardening.redisRateLimiting,
        monitoring: hardening.monitoring,
        backups: hardening.backups,
        syncWorkers: hardening.syncWorkers,
        retentionScheduler: hardening.retentionScheduler,
        renewalAlerts: hardening.renewalAlerts,
        platformApi: hardening.platformApi,
      },
      capabilities: payload.capabilities,
      blocked,
    };
  } catch (error) {
    return {
      baseUrl,
      ready: false,
      error: error instanceof Error ? error.message : "Production readiness request failed.",
    };
  }
}

function loadEnvFile(file) {
  if (!existsSync(file)) return;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const raw = trimmed.slice(separator + 1).trim();
    if (!key || process.env[key]) continue;
    process.env[key] = raw.replace(/^['"]|['"]$/g, "");
  }
}
