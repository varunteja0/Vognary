import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { sourceTypes } from "../src/lib/recovery/contracts";
import {
  activeRecoveryCaptureSourceTypes,
  assertActiveRecoveryCapture,
  boundedExcerpt,
  buildRecoveryIngestionEnvelope,
  gmailOauthCaptureBlockReason,
  isActiveRecoveryCaptureSource,
  isReservedRecoveryCaptureSource,
  provenanceForSourceType,
  RecoveryCaptureNotReadyError,
  reservedRecoveryCaptureSourceTypes,
} from "../src/lib/recovery/ingestion-envelope";

test("every Recovery source is either an active capture path or an explicitly reserved fail-closed rail", () => {
  assert.deepEqual(activeRecoveryCaptureSourceTypes, ["RECEIPT_PASTE", "CSV_IMPORT", "FORWARDED_EMAIL"]);
  assert.deepEqual(reservedRecoveryCaptureSourceTypes, ["GMAIL_OAUTH"]);
  assert.deepEqual(
    [...activeRecoveryCaptureSourceTypes, ...reservedRecoveryCaptureSourceTypes],
    [...sourceTypes],
  );
  for (const sourceType of activeRecoveryCaptureSourceTypes) {
    assert.equal(isActiveRecoveryCaptureSource(sourceType), true);
    assert.doesNotThrow(() => assertActiveRecoveryCapture(sourceType));
  }
  assert.equal(provenanceForSourceType("RECEIPT_PASTE"), "USER_SUBMITTED");
  assert.equal(provenanceForSourceType("CSV_IMPORT"), "USER_SUBMITTED");
  assert.equal(provenanceForSourceType("FORWARDED_EMAIL"), "PROVIDER_RECEIVED");
  assert.equal(provenanceForSourceType("GMAIL_OAUTH"), "PROVIDER_RECEIVED");
});

test("Gmail OAuth cannot enter Recovery ingestion even when Google verification env is present", () => {
  assert.equal(isReservedRecoveryCaptureSource("GMAIL_OAUTH"), true);
  assert.throws(
    () => assertActiveRecoveryCapture("GMAIL_OAUTH"),
    (error: unknown) => {
      assert.ok(error instanceof RecoveryCaptureNotReadyError);
      assert.equal(error.sourceType, "GMAIL_OAUTH");
      assert.match(error.message, /restricted-scope verification/i);
      assert.match(error.message, /must not be revived/i);
      return true;
    },
  );
  assert.throws(
    () => buildRecoveryIngestionEnvelope({
      workspaceId: "workspace-1",
      sourceType: "GMAIL_OAUTH",
      idempotencyKey: "gmail-1",
      requestHash: "hash-1",
      capturedAt: "2026-08-13T00:00:00.000Z",
    }),
    RecoveryCaptureNotReadyError,
  );
  process.env.GOOGLE_OAUTH_VERIFICATION_COMPLETE = "true";
  assert.throws(() => assertActiveRecoveryCapture("GMAIL_OAUTH"), RecoveryCaptureNotReadyError);
  delete process.env.GOOGLE_OAUTH_VERIFICATION_COMPLETE;
  assert.match(gmailOauthCaptureBlockReason(), /living-ledger Gmail adapter must not be revived/i);
});

test("active capture envelopes are equivalent across paste, CSV, and forwarded email", () => {
  const capturedAt = "2026-08-13T12:00:00.000Z";
  const paste = buildRecoveryIngestionEnvelope({
    workspaceId: "workspace-1",
    sourceType: "RECEIPT_PASTE",
    idempotencyKey: "paste-1",
    requestHash: "hash-paste",
    capturedAt,
  });
  const csv = buildRecoveryIngestionEnvelope({
    workspaceId: "workspace-1",
    sourceType: "CSV_IMPORT",
    idempotencyKey: "csv-1",
    requestHash: "hash-csv",
    capturedAt,
    coverageStart: "2026-01-01",
    coverageEnd: "2026-06-30",
  });
  const forwarded = buildRecoveryIngestionEnvelope({
    workspaceId: "workspace-1",
    sourceType: "FORWARDED_EMAIL",
    idempotencyKey: "forward-1",
    requestHash: "hash-forward",
    capturedAt,
    consentReference: "inbound-event-1",
  });
  assert.equal(paste.provenanceKind, "USER_SUBMITTED");
  assert.equal(csv.provenanceKind, "USER_SUBMITTED");
  assert.equal(forwarded.provenanceKind, "PROVIDER_RECEIVED");
  assert.equal(paste.workspaceId, csv.workspaceId);
  assert.equal(csv.coverageStart, "2026-01-01");
  assert.equal(forwarded.consentReference, "inbound-event-1");
  assert.equal(boundedExcerpt("short"), "short");
  assert.equal(boundedExcerpt("x".repeat(501)).length, 500);
});

test("legacy connector sync never materializes into the living ledger", () => {
  const runner = readFileSync("src/lib/server/connector-sync-runner.ts", "utf8");
  const ledger = readFileSync("src/lib/server/living-ledger-store.ts", "utf8");
  const syncStore = readFileSync("src/lib/server/sync-job-store.ts", "utf8");
  const recoveryStore = readFileSync("src/lib/server/recovery-store.ts", "utf8");
  assert.match(runner, /LEGACY_LEDGER_WRITE_FROZEN/);
  assert.doesNotMatch(runner, /materializeConnectorBatch\(/);
  assert.doesNotMatch(runner, /persistConnectorEvidenceBatch\(/);
  assert.match(ledger, /refuseLegacyLedgerWrite\(\)/);
  assert.match(syncStore, /refuseLegacyLedgerWrite\(\)/);
  assert.match(recoveryStore, /buildRecoveryIngestionEnvelope\(/);
  assert.match(recoveryStore, /RecoveryCaptureNotReadyError/);
  const submit = recoveryStore.slice(
    recoveryStore.indexOf("export async function submitRecoveryEvidence"),
    recoveryStore.indexOf("export async function createRecoveryCorrection"),
  );
  const forwarded = recoveryStore.slice(
    recoveryStore.indexOf("export async function materializeForwardedEmailEvidence"),
    recoveryStore.indexOf("export async function submitRecoveryEvidence"),
  );
  for (const [name, source] of [["submit", submit], ["forwarded", forwarded]] as const) {
    const envelopeAt = source.indexOf("buildRecoveryIngestionEnvelope");
    const clientAt = source.indexOf("getDatabasePool().connect()");
    assert.ok(envelopeAt >= 0 && clientAt > envelopeAt, `${name} must construct the envelope before acquiring a PostgreSQL client`);
    assert.match(source, /envelope\.sourceType/);
    assert.match(source, /envelope\.idempotencyKey/);
    assert.match(source, /envelope\.requestHash/);
    assert.match(source, /envelope\.capturedAt/);
  }
  assert.match(forwarded, /envelope\.consentReference/);
  const persist = recoveryStore.slice(recoveryStore.indexOf("async function persistSubmissionSources"));
  assert.match(persist, /input\.envelope\.sourceType/);
  assert.match(persist, /input\.envelope\.provenanceKind/);
  assert.match(persist, /input\.envelope\.capturedAt/);
  assert.match(persist, /input\.envelope\.coverageStart/);
  assert.match(persist, /input\.envelope\.coverageEnd/);
});
