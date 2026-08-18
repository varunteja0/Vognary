/**
 * Recorded operational proof for the public backup trust signal.
 *
 * Env flags alone are not 99% proof. This module only accepts a restore that
 * downloaded the stored object (`durable-object-get`) and names that object.
 */

export type RecordedBackupDrillEvidence = {
  runId: string;
  objectKey: string;
  keyFingerprint: string;
  plaintextSha256: string;
  restoredAt: string;
  source: "durable-object-get";
};

export const recordedBackupDrillEvidence: RecordedBackupDrillEvidence = {
  runId: "32109925496",
  objectKey: "vognary-postgres/vognary-postgres-2026-08-18T07-07-54-751Z.dump.enc",
  keyFingerprint: "8it2LaCH1w__ilS1",
  plaintextSha256: "45eb736e98ea2f286448df3d6229eb154c4e0649f1c4cfdd970eda60cf81b5a4",
  restoredAt: "2026-08-18T07:08:16.113Z",
  source: "durable-object-get",
};

const objectKeyPattern = /^vognary-postgres\/[A-Za-z0-9._-]+\.dump\.enc$/;
const fingerprintPattern = /^[A-Za-z0-9_-]{8,64}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;

export function isRecordedDurableBackupRestore(
  evidence: RecordedBackupDrillEvidence | null | undefined,
  keyFingerprint?: string,
): evidence is RecordedBackupDrillEvidence {
  if (!evidence) return false;
  if (evidence.source !== "durable-object-get") return false;
  if (!/^\d+$/.test(evidence.runId)) return false;
  if (!objectKeyPattern.test(evidence.objectKey)) return false;
  if (!fingerprintPattern.test(evidence.keyFingerprint)) return false;
  if (!sha256Pattern.test(evidence.plaintextSha256)) return false;
  if (Number.isNaN(Date.parse(evidence.restoredAt))) return false;
  if (keyFingerprint && evidence.keyFingerprint !== keyFingerprint) return false;
  return true;
}
