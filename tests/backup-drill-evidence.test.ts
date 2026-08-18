import assert from "node:assert/strict";
import test from "node:test";
import {
  isRecordedDurableBackupRestore,
  recordedBackupDrillEvidence,
} from "../src/lib/server/backup-drill-evidence";

test("recorded backup evidence names a durable-object GET, not an env flag", () => {
  assert.equal(recordedBackupDrillEvidence.source, "durable-object-get");
  assert.equal(isRecordedDurableBackupRestore(recordedBackupDrillEvidence, recordedBackupDrillEvidence.keyFingerprint), true);
  assert.equal(isRecordedDurableBackupRestore(recordedBackupDrillEvidence, "other-fingerprint"), false);
  assert.equal(
    isRecordedDurableBackupRestore({
      ...recordedBackupDrillEvidence,
      objectKey: "not-an-object",
    }),
    false,
  );
});
