import assert from "node:assert/strict";
import test from "node:test";

import {
  RecoveryServiceError,
  getRecoveryMutationPreconditions,
  normalizeCorrectionRequest,
  normalizeDecisionRequest,
  normalizeEvidenceRequest,
  normalizeForwardedEmailMaterializationRequest,
  recoveryFailureResponse,
} from "../src/lib/server/recovery-api";

test("Recovery mutations require an idempotency key and an exactly quoted workspace version", () => {
  const request = new Request("https://vognary.test/api/workspaces/current/evidence", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "recovery-request-0001",
      "if-match": '"workspace:4"',
    },
  });
  assert.deepEqual(getRecoveryMutationPreconditions(request), {
    idempotencyKey: "recovery-request-0001",
    expectedVersion: 4,
  });

  for (const invalid of ["workspace:4", "W/\"workspace:4\"", '"workspace:-1"', '"workspace:04"']) {
    const bad = new Request(request.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "recovery-request-0001",
        "if-match": invalid,
      },
    });
    assert.throws(() => getRecoveryMutationPreconditions(bad), /quoted If-Match/i);
  }
});

test("Recovery evidence, correction, and decision bodies are strict and bounded", () => {
  assert.deepEqual(normalizeEvidenceRequest({
    kind: "RECEIPT_PASTE",
    receipts: [{ clientRef: "receipt-1", text: "OpenAI subscription INR 1,999 renews 6 September 2026" }],
  }).kind, "RECEIPT_PASTE");
  assert.throws(() => normalizeEvidenceRequest({ kind: "RECEIPT_PASTE", receipts: [], extra: true }), /field extra/i);
  assert.throws(() => normalizeEvidenceRequest({ kind: "CSV_IMPORT", sources: [{ clientRef: "csv-1", name: "x.csv", text: "" }] }), /text/i);
  assert.throws(() => normalizeEvidenceRequest({ kind: "FORWARDED_EMAIL", receipts: [{ clientRef: "provider-1", text: "OpenAI INR 1,999" }] }), /kind/i);
  assert.deepEqual(normalizeForwardedEmailMaterializationRequest({
    kind: "FORWARDED_EMAIL",
    receipts: [{ clientRef: "provider-1", text: "OpenAI subscription INR 1,999 renews 6 September 2026" }],
  }), {
    kind: "FORWARDED_EMAIL",
    receipts: [{ clientRef: "provider-1", text: "OpenAI subscription INR 1,999 renews 6 September 2026" }],
  });
  assert.throws(() => normalizeForwardedEmailMaterializationRequest({ kind: "FORWARDED_EMAIL", receipts: [], extra: true }), /field extra/i);

  assert.deepEqual(normalizeCorrectionRequest({
    patch: { field: "CADENCE", value: { cadence: "MONTHLY" } },
    reason: "Invoice states monthly billing.",
  }), {
    patch: { field: "CADENCE", value: { cadence: "MONTHLY" } },
    reason: "Invoice states monthly billing.",
  });
  assert.throws(() => normalizeCorrectionRequest({ patch: { field: "AMOUNT", value: { amountMinor: -1 } } }), /amountMinor/i);
  assert.throws(() => normalizeCorrectionRequest({ patch: { field: "AMOUNT", value: { amountMinor: "9223372036854775808" } } }), /PostgreSQL bigint/i);
  assert.deepEqual(normalizeCorrectionRequest({ patch: { field: "AMOUNT", value: { amountMinor: "9007199254740993" } } }), {
    patch: { field: "AMOUNT", value: { amountMinor: "9007199254740993" } },
  });
  assert.deepEqual(normalizeDecisionRequest({ commitmentId: "2f626050-70f8-4cae-902d-caa9223cbebe", decision: "INVESTIGATE" }), {
    commitmentId: "2f626050-70f8-4cae-902d-caa9223cbebe",
    decision: "INVESTIGATE",
  });
  for (const decision of ["KEEP", "MONITOR", "DOWNGRADE", "CANCEL", "INVESTIGATE"] as const) {
    assert.equal(normalizeDecisionRequest({ commitmentId: "2f626050-70f8-4cae-902d-caa9223cbebe", decision }).decision, decision);
  }
});

test("Recovery failures expose safe contract errors and never raw exception text", async () => {
  const response = recoveryFailureResponse(
    new RecoveryServiceError("DATABASE_UNAVAILABLE", "postgres://user:secret@db/private failed", { retryable: true }),
    "request-safe",
  );
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.deepEqual(payload, {
    error: {
      code: "DATABASE_UNAVAILABLE",
      message: "Recovery storage is temporarily unavailable.",
      retryable: true,
      requestId: "request-safe",
    },
  });
  assert.doesNotMatch(JSON.stringify(payload), /postgres|secret|private/i);

  const unavailable = recoveryFailureResponse(
    new RecoveryServiceError("FEATURE_UNAVAILABLE", "RESEND_RECEIVING_API_KEY is missing"),
    "request-unavailable",
  );
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), {
    error: {
      code: "FEATURE_UNAVAILABLE",
      message: "This Recovery feature is not available for this deployment.",
      retryable: false,
      requestId: "request-unavailable",
    },
  });
});
