import { readFile, mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import {
  decryptFile,
  parseBackupEncryptionKey,
  postgresConnectionEnv,
  redactDatabaseUrl,
  requireEnv,
  runPostgresCommand,
} from "./lib/postgres-backup-utils.mjs";
import {
  readRecoveryBackupVerification,
  recoveryBackupVerificationMatches,
  requiredRecoveryTablesForProfile,
  requiredAutopilotAuditCountKeys,
} from "./lib/recovery-backup-verification.mjs";

const { Pool } = pg;

if (process.argv.includes("--help")) {
  console.log(`Restore an encrypted Vognary PostgreSQL backup into a disposable database and verify core tables.\n\nRequired env:\n  RESTORE_DATABASE_URL             Disposable target database. This script runs pg_restore --clean.\n  RESTORE_CONFIRM_DISPOSABLE=true Safety confirmation. Never point this at production.\n  BACKUP_ENCRYPTION_KEY           32-byte base64url or hex AES-256-GCM key\n\nUsage:\n  RESTORE_DATABASE_URL='postgres://disposable...' RESTORE_CONFIRM_DISPOSABLE=true BACKUP_ENCRYPTION_KEY='...' npm run backup:restore-drill -- backups/postgres/<backup>.manifest.json`);
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const input = process.argv.slice(2).find((arg) => !arg.startsWith("-"));
if (!input) throw new Error("A backup manifest path or .dump.enc path is required. Run with --help for usage.");

const restoreDatabaseUrl = requireEnv("RESTORE_DATABASE_URL");
if (process.env.RESTORE_CONFIRM_DISPOSABLE !== "true") {
  throw new Error("Set RESTORE_CONFIRM_DISPOSABLE=true after verifying RESTORE_DATABASE_URL points to a disposable drill database.");
}
if (process.env.DATABASE_URL?.trim() && process.env.DATABASE_URL.trim() === restoreDatabaseUrl) {
  throw new Error("RESTORE_DATABASE_URL must not equal DATABASE_URL.");
}

const backupKey = parseBackupEncryptionKey(process.env.BACKUP_ENCRYPTION_KEY);
const restoreConnectionEnv = postgresConnectionEnv(restoreDatabaseUrl);
const { manifestPath, encryptedDumpPath, manifest } = await resolveBackupInput(input);
const tempDir = await mkdtemp(path.join(os.tmpdir(), "vognary-pg-restore-"));
const plainDumpPath = path.join(tempDir, path.basename(encryptedDumpPath, ".enc"));

try {
  const decrypted = await decryptFile({
    inputPath: encryptedDumpPath,
    outputPath: plainDumpPath,
    key: backupKey,
    encryption: manifest.encryption,
  });

  if (decrypted.plaintextSha256 !== manifest.dump?.plaintextSha256) {
    throw new Error("Decrypted backup checksum does not match the manifest.");
  }

  await runPostgresCommand("pg_restore", [
    "--dbname",
    restoreConnectionEnv.PGDATABASE,
    "--clean",
    "--if-exists",
    "--no-owner",
    "--no-acl",
    "--exit-on-error",
    plainDumpPath,
  ], {
    env: {
      ...process.env,
      ...restoreConnectionEnv,
      PGSSLMODE: process.env.RESTORE_POSTGRES_SSL === "true" || process.env.POSTGRES_SSL === "true" ? "require" : process.env.PGSSLMODE,
    },
    volumes: [{ hostPath: tempDir, containerPath: "/backup" }],
  });

  const verification = await verifyRestoredSchema(restoreDatabaseUrl);
  if (!manifest.verification?.recoveryWorkspaceCounts) {
    throw new Error("Backup manifest is missing Recovery source counts.");
  }
  if (!recoveryBackupVerificationMatches(manifest.verification, verification)) {
    throw new Error("Recovery restore counts do not match the backup manifest.");
  }
  console.log(JSON.stringify({
    status: "restore-drill-passed",
    manifest: path.relative(root, manifestPath).split(path.sep).join("/"),
    encryptedDump: path.relative(root, encryptedDumpPath).split(path.sep).join("/"),
    targetDatabase: redactDatabaseUrl(restoreDatabaseUrl),
    plaintextBytes: decrypted.plaintextBytes,
    plaintextSha256: decrypted.plaintextSha256,
    verification,
    next: "Record this drill externally, upload the encrypted dump to durable storage, then set BACKUP_RESTORE_DRILL_STATUS=passed in production only after the storage copy is confirmed.",
  }, null, 2));
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

async function resolveBackupInput(inputPath) {
  const absoluteInput = path.resolve(process.cwd(), inputPath);
  const manifestPath = absoluteInput.endsWith(".manifest.json")
    ? absoluteInput
    : absoluteInput.replace(/\.dump\.enc$/i, ".manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  if (manifest.version !== "v1" || manifest.service !== "vognary-web") {
    throw new Error("Selected manifest is not a Vognary PostgreSQL backup manifest.");
  }

  const encryptedDumpPath = absoluteInput.endsWith(".dump.enc")
    ? absoluteInput
    : path.resolve(path.dirname(manifestPath), manifest.files?.encryptedDumpFile || path.basename(manifest.files?.encryptedDump || ""));

  return { manifestPath, encryptedDumpPath, manifest };
}

async function verifyRestoredSchema(connectionString) {
  const pool = new Pool({
    connectionString,
    ssl: process.env.RESTORE_POSTGRES_SSL === "true" || process.env.POSTGRES_SSL === "true" ? {
      ca: process.env.POSTGRES_CA_CERT || undefined,
      rejectUnauthorized: process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED !== "false",
    } : undefined,
  });

  try {
    const requiredTables = [
      "users",
      "workspaces",
      "connected_accounts",
      "connector_token_refs",
      "private_audit_leads",
      "connector_evidence",
      ...requiredRecoveryTablesForProfile(manifest.verification?.profile),
    ];
    const result = await pool.query(
      `select table_name
       from information_schema.tables
       where table_schema = 'public' and table_name = any($1::text[])
       order by table_name`,
      [requiredTables],
    );
    const restoredTables = new Set(result.rows.map((row) => row.table_name));
    const missingTables = requiredTables.filter((tableName) => !restoredTables.has(tableName));
    if (missingTables.length) throw new Error(`Restore drill missing core tables: ${missingTables.join(", ")}`);

    const recoveryVerification = await readRecoveryBackupVerification(pool, manifest.verification?.profile);
    if (manifest.verification?.profile === "current") {
      const missingAuditCounts = requiredAutopilotAuditCountKeys.filter(
        (key) => recoveryVerification.recoveryWorkspaceCounts?.[key] == null,
      );
      if (missingAuditCounts.length) {
        throw new Error(`Restore drill missing audit table counts: ${missingAuditCounts.join(", ")}`);
      }
    }

    return {
      coreTablesPresent: requiredTables,
      ...recoveryVerification,
    };
  } finally {
    await pool.end();
  }
}