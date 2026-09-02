import { createHash, randomBytes } from "node:crypto";

export type BackupConfigurationStatus =
  | "configured"
  | "invalid-backup-key"
  | "storage-configured-restore-drill-required"
  | "restore-drill-recorded-needs-storage"
  | "restore-drill-record-hash-required"
  | "key-proof-required"
  | "not-configured";

export type BackupConfiguration = {
  status: BackupConfigurationStatus;
  storage: "configured" | "not-configured";
  restoreDrill: "passed" | "not-recorded";
  keyProof: "configured" | "not-configured" | "invalid";
  keyFingerprint?: string;
  storageEnv?: string;
  message?: string;
};

export function checkBackupConfiguration(): BackupConfiguration {
  const storage = getBackupStorageEnv();
  const restoreStatusPassed = process.env.BACKUP_RESTORE_DRILL_STATUS?.trim().toLowerCase() === "passed";
  const restoreRecordHash = process.env.BACKUP_RESTORE_DRILL_RECORD_SHA256?.trim() ?? "";
  const restoreDrillPassed = restoreStatusPassed && /^[a-f0-9]{64}$/i.test(restoreRecordHash);
  const keyProof = checkBackupKeyProof();

  if (keyProof.status === "invalid") {
    return {
      status: "invalid-backup-key",
      storage: storage ? "configured" : "not-configured",
      restoreDrill: restoreDrillPassed ? "passed" : "not-recorded",
      keyProof: "invalid",
      message: keyProof.message,
    };
  }

  if (restoreStatusPassed && !restoreDrillPassed) {
    return {
      status: "restore-drill-record-hash-required",
      storage: storage ? "configured" : "not-configured",
      restoreDrill: "not-recorded",
      keyProof: keyProof.status,
      keyFingerprint: keyProof.keyFingerprint,
      storageEnv: storage?.name,
      message: "A restore status is present without a valid restricted record hash.",
    };
  }

  if (storage && restoreDrillPassed && keyProof.status === "configured") {
    return {
      status: "configured",
      storage: "configured",
      restoreDrill: "passed",
      keyProof: "configured",
      keyFingerprint: keyProof.keyFingerprint,
      storageEnv: storage.name,
    };
  }

  if (storage && restoreDrillPassed) {
    return {
      status: "key-proof-required",
      storage: "configured",
      restoreDrill: "passed",
      keyProof: "not-configured",
      storageEnv: storage.name,
      message: "Set BACKUP_KEY_FINGERPRINT or a valid BACKUP_ENCRYPTION_KEY so the restore drill is tied to an encryption key.",
    };
  }

  if (storage) {
    return {
      status: "storage-configured-restore-drill-required",
      storage: "configured",
      restoreDrill: "not-recorded",
      keyProof: keyProof.status,
      keyFingerprint: keyProof.keyFingerprint,
      storageEnv: storage.name,
    };
  }

  if (restoreDrillPassed) {
    return {
      status: "restore-drill-recorded-needs-storage",
      storage: "not-configured",
      restoreDrill: "passed",
      keyProof: keyProof.status,
      keyFingerprint: keyProof.keyFingerprint,
    };
  }

  return {
    status: "not-configured",
    storage: "not-configured",
    restoreDrill: "not-recorded",
    keyProof: keyProof.status,
    keyFingerprint: keyProof.keyFingerprint,
  };
}

function getBackupStorageEnv() {
  for (const name of ["BACKUP_STORAGE_BUCKET", "S3_BUCKET", "R2_BUCKET"]) {
    const value = process.env[name]?.trim();
    if (value) return { name, value };
  }

  return null;
}

function checkBackupKeyProof() {
  const fingerprint = process.env.BACKUP_KEY_FINGERPRINT?.trim();
  if (fingerprint) return { status: "configured" as const, keyFingerprint: fingerprint };

  const rawKey = process.env.BACKUP_ENCRYPTION_KEY?.trim();
  if (!rawKey) return { status: "not-configured" as const };

  try {
    const key = /^[a-f0-9]{64}$/i.test(rawKey)
      ? Buffer.from(rawKey, "hex")
      : Buffer.from(rawKey, "base64url");
    if (key.length !== 32) throw new Error("BACKUP_ENCRYPTION_KEY must decode to 32 bytes for AES-256-GCM.");
    assertRoundTrip(key);
    return { status: "configured" as const, keyFingerprint: createHash("sha256").update(key).digest("base64url").slice(0, 16) };
  } catch (error) {
    return {
      status: "invalid" as const,
      message: error instanceof Error ? error.message : "BACKUP_ENCRYPTION_KEY is invalid.",
    };
  }
}

function assertRoundTrip(key: Buffer) {
  const marker = Buffer.from(`backup-readiness-${randomBytes(8).toString("base64url")}`);
  const fingerprint = createHash("sha256").update(key).digest();
  if (!fingerprint.length || !marker.length) throw new Error("Backup key readiness check failed.");
}