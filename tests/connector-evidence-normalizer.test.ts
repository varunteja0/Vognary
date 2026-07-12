import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalizeConnectorEvidence,
  defaultNextSyncAt,
  normalizeMerchantKey,
  normalizeConnectorSyncResult,
} from "@/lib/connector-evidence-normalizer";
import type { ConnectorEvidence } from "@/lib/connector-runtime";

const monthlyReceipt: ConnectorEvidence = {
  connectorId: "gmail-readonly",
  externalId: "gmail-message:abc:receipt-0-openai",
  provider: "gmail",
  observedAt: "2026-07-11T23:30:00+05:30",
  evidenceType: "receipt",
  merchantRaw: "  OpenAI   Plus ",
  amount: 20,
  currency: "usd",
  category: "AI tools",
  cadenceHint: "monthly",
  confidence: 81.4,
};

test("canonical receipt becomes a currency-safe transaction and recurring commitment", () => {
  const observation = canonicalizeConnectorEvidence(monthlyReceipt);

  assert.equal(observation.observedAt, "2026-07-11T18:00:00.000Z");
  assert.equal(observation.transactionDate, "2026-07-11");
  assert.equal(observation.merchant, "OpenAI Plus");
  assert.equal(observation.normalizedMerchant, "openai plus");
  assert.equal(observation.currency, "USD");
  assert.equal(observation.nextExpectedDate, "2026-08-11");
  assert.equal(observation.monthlyCost, 20);
  assert.equal(observation.annualCost, 240);
  assert.equal(observation.confidence, 81);
  assert.equal(observation.materializeTransaction, true);
  assert.equal(observation.materializeCommitment, true);
  assert.equal(observation.materializeUsage, false);
});

test("provider cost buckets stay transactional and usage-linked without inventing a subscription", () => {
  const observation = canonicalizeConnectorEvidence({
    connectorId: "openai-costs",
    externalId: "openai-cost:bucket-1",
    provider: "openai",
    observedAt: "2026-07-11T00:00:00.000Z",
    evidenceType: "cost",
    merchantRaw: "OpenAI API usage",
    amount: 42.25,
    currency: "USD",
    cadenceHint: "usage-window",
    confidence: 96,
  });

  assert.equal(observation.materializeTransaction, true);
  assert.equal(observation.materializeUsage, true);
  assert.equal(observation.materializeCommitment, false);
  assert.equal(observation.frequency, "irregular");
  assert.equal(observation.currency, "USD");
});

test("inferred monthly renewal dates clamp at month end", () => {
  const observation = canonicalizeConnectorEvidence({
    ...monthlyReceipt,
    externalId: "gmail-message:month-end:receipt:0",
    observedAt: "2027-01-31T00:00:00.000Z",
  });

  assert.equal(observation.nextExpectedDate, "2027-02-28");
});

test("merchant keys preserve non-Latin provider names", () => {
  assert.equal(normalizeMerchantKey("  भारत संचार निगम लिमिटेड  "), "भारत संचार निगम लिमिटेड");
});

test("sync normalization de-duplicates retries by stable external id and preserves cursor/coverage", () => {
  const normalized = normalizeConnectorSyncResult({
    evidence: [monthlyReceipt, { ...monthlyReceipt, amount: 25, confidence: 90 }],
    nextCursorState: { historyId: "9001" },
    coverage: {
      startAt: "2026-01-01T00:00:00.000Z",
      endAt: "2026-07-11T18:00:00.000Z",
      completeness: "partial",
    },
    continuation: true,
  }, {
    connectorId: "gmail-readonly",
    syncMode: "polling",
    startedAt: "2026-07-11T18:00:00.000Z",
    cursorState: { historyId: "old" },
  });

  assert.equal(normalized.evidence.length, 1);
  assert.equal(normalized.observations[0]?.amount, 25);
  assert.deepEqual(normalized.nextCursorState, { historyId: "9001" });
  assert.equal(normalized.coverage.startAt, "2026-01-01T00:00:00.000Z");
  assert.equal(normalized.nextSyncAt, "2026-07-11T19:00:00.000Z");
  assert.equal(normalized.continuation, true);
});

test("adapters without a new cursor retain the prior cursor and get mode-specific schedules", () => {
  const normalized = normalizeConnectorSyncResult([monthlyReceipt], {
    connectorId: "gmail-readonly",
    syncMode: "scheduled",
    startedAt: "2026-07-11T00:00:00.000Z",
    cursorState: { page: 4 },
  });

  assert.deepEqual(normalized.nextCursorState, { page: 4 });
  assert.equal(normalized.nextSyncAt, "2026-07-12T00:00:00.000Z");
  assert.equal(defaultNextSyncAt("manual", "2026-07-11T00:00:00.000Z"), null);
});

test("connector identity mismatches and empty external ids fail closed", () => {
  assert.throws(() => normalizeConnectorSyncResult([{ ...monthlyReceipt, connectorId: "openai-costs" }], {
    connectorId: "gmail-readonly",
    syncMode: "polling",
    startedAt: "2026-07-11T00:00:00.000Z",
  }), /belongs to openai-costs/);

  assert.throws(() => canonicalizeConnectorEvidence({ ...monthlyReceipt, externalId: " " }), /stable external id/);
});
