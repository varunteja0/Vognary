import assert from "node:assert/strict";
import test from "node:test";

import { recoveryEvidenceFingerprint } from "../src/lib/recovery/evidence-fingerprint";

const receipt = {
  sourceId: "paste-source",
  evidenceKind: "RECEIPT" as const,
  rowNumber: 1,
  normalizedMerchant: "OpenAI",
  amountMinor: "199900",
  currency: "INR",
  evidenceDate: "2026-07-06",
  direction: null,
  cadenceHint: "MONTHLY",
  nextExpectedDate: "2026-08-06",
};

test("receipt fingerprints ignore channel identity but preserve financial fact changes", () => {
  const pasted = recoveryEvidenceFingerprint(receipt);
  const forwarded = recoveryEvidenceFingerprint({ ...receipt, sourceId: "forwarded-source", rowNumber: 4 });
  const nextRenewal = recoveryEvidenceFingerprint({ ...receipt, evidenceDate: "2026-08-06", nextExpectedDate: "2026-09-06" });
  assert.equal(forwarded, pasted);
  assert.notEqual(nextRenewal, pasted);
});

test("transaction fingerprints preserve source row identity", () => {
  const first = recoveryEvidenceFingerprint({ ...receipt, evidenceKind: "TRANSACTION", direction: "debit" });
  const second = recoveryEvidenceFingerprint({ ...receipt, evidenceKind: "TRANSACTION", direction: "debit", rowNumber: 2 });
  assert.notEqual(first, second);
});