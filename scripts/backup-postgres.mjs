import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { backupObjectKey, getBackupStorageConfig, uploadBackupObject } from "./lib/backup-storage.mjs";
import {
  encryptFile,
  parseBackupEncryptionKey,
  postgresConnectionEnv,
  redactDatabaseUrl,
  relativeFromRoot,
  requireEnv,
  runPostgresCommand,
  sanitizeLabel,
  timestampLabel,
} from "./lib/postgres-backup-utils.mjs";

if (process.argv.includes("--help")) {
  console.log(`Create an encrypted PostgreSQL dump for Vognary.\n\nRequired env:\n  DATABASE_URL\n  BACKUP_ENCRYPTION_KEY  32-byte base64url or hex AES-256-GCM key\n\nOptional env:\n  POSTGRES_SSL=true\n  BACKUP_DIR=backups/postgres\n  BACKUP_LABEL=manual-prod-drill\n  BACKUP_STORAGE_BUCKET | S3_BUCKET | R2_BUCKET\n  BACKUP_STORAGE_REGION | AWS_REGION\n  BACKUP_STORAGE_ENDPOINT for R2/S3-compatible storage\n  BACKUP_STORAGE_ACCESS_KEY_ID | AWS_ACCESS_KEY_ID\n  BACKUP_STORAGE_SECRET_ACCESS_KEY | AWS_SECRET_ACCESS_KEY\n\nExample:\n  DATABASE_URL='postgres://...' BACKUP_ENCRYPTION_KEY='...' npm run backup:postgres`);
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const databaseUrl = requireEnv("DATABASE_URL");
const backupKey = parseBackupEncryptionKey(process.env.BACKUP_ENCRYPTION_KEY);
const backupDir = path.resolve(root, process.env.BACKUP_DIR || "backups/postgres");
const createdAt = new Date().toISOString();
const label = sanitizeLabel(process.env.BACKUP_LABEL || `vognary-postgres-${timestampLabel()}`);
const tempDir = await mkdtemp(path.join(os.tmpdir(), "vognary-pg-backup-"));
const plainDumpPath = path.join(tempDir, `${label}.dump`);
const encryptedDumpPath = path.join(backupDir, `${label}.dump.enc`);
const manifestPath = path.join(backupDir, `${label}.manifest.json`);

try {
  await runPostgresCommand("pg_dump", [
    "--format=custom",
    "--no-owner",
    "--no-acl",
    "--file",
    plainDumpPath,
  ], {
    env: {
      ...process.env,
      ...postgresConnectionEnv(databaseUrl),
      PGSSLMODE: process.env.POSTGRES_SSL === "true" ? "require" : process.env.PGSSLMODE,
    },
    volumes: [{ hostPath: tempDir, containerPath: "/backup" }],
  });

  const associatedData = `vognary-postgres-backup:${label}:${createdAt}`;
  const encryption = await encryptFile({
    inputPath: plainDumpPath,
    outputPath: encryptedDumpPath,
    key: backupKey,
    associatedData,
  });

  const storageConfig = getBackupStorageConfig();
  const storageBucket = storageConfig.bucket || null;
  const dumpObjectKey = storageConfig.ready ? backupObjectKey(storageConfig, encryptedDumpPath) : null;
  const manifestObjectKey = storageConfig.ready ? backupObjectKey(storageConfig, manifestPath) : null;
  const manifest = {
    version: "v1",
    service: "vognary-web",
    createdAt,
    label,
    sourceDatabase: redactDatabaseUrl(databaseUrl),
    dump: {
      tool: "pg_dump",
      format: "custom",
      plaintextBytes: encryption.plaintextBytes,
      plaintextSha256: encryption.plaintextSha256,
    },
    encryption: {
      algorithm: encryption.algorithm,
      associatedData: encryption.associatedData,
      iv: encryption.iv,
      tag: encryption.tag,
      keyFingerprint: encryption.keyFingerprint,
    },
    files: {
      encryptedDump: relativeFromRoot(root, encryptedDumpPath),
      encryptedDumpFile: path.basename(encryptedDumpPath),
      manifest: relativeFromRoot(root, manifestPath),
    },
    storage: {
      bucket: storageBucket,
      provider: storageConfig.provider,
      region: storageConfig.region || null,
      prefix: storageConfig.prefix,
      status: storageConfig.ready ? "upload-pending" : storageBucket ? "encrypted-dump-created-upload-required" : "local-encrypted-dump-only",
      missing: storageConfig.ready ? [] : storageConfig.missing,
      objects: dumpObjectKey && manifestObjectKey ? {
        encryptedDump: dumpObjectKey,
        manifest: manifestObjectKey,
      } : undefined,
    },
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

  let uploadResults = [];
  if (storageConfig.ready && dumpObjectKey && manifestObjectKey) {
    const dumpUpload = await uploadBackupObject(storageConfig, {
      filePath: encryptedDumpPath,
      objectKey: dumpObjectKey,
      contentType: "application/octet-stream",
    });
    manifest.storage.status = "uploaded";
    manifest.storage.uploadedAt = new Date().toISOString();
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    const manifestUpload = await uploadBackupObject(storageConfig, {
      filePath: manifestPath,
      objectKey: manifestObjectKey,
      contentType: "application/json",
    });
    uploadResults = [dumpUpload, manifestUpload];
  }

  console.log(JSON.stringify({
    status: "ok",
    encryptedDump: manifest.files.encryptedDump,
    manifest: manifest.files.manifest,
    plaintextBytes: manifest.dump.plaintextBytes,
    plaintextSha256: manifest.dump.plaintextSha256,
    keyFingerprint: manifest.encryption.keyFingerprint,
    storage: manifest.storage,
    uploads: uploadResults,
    next: "Run backup:restore-drill against a disposable RESTORE_DATABASE_URL before setting BACKUP_RESTORE_DRILL_STATUS=passed.",
  }, null, 2));
} finally {
  await rm(tempDir, { recursive: true, force: true });
}