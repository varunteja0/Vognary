import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { normalizeProductEvent, productEventNames, type ProductEventInput } from "@/lib/product-events";
import { POST as postProductEvent } from "../src/app/api/product-events/route";

test("product events accept only bounded operational metrics", () => {
  const event = normalizeProductEvent({
    workspaceId: "123e4567-e89b-42d3-a456-426614174000",
    eventName: "connector.sync.succeeded",
    occurredAt: "2026-07-11T00:00:00.000Z",
    source: "sync-runner",
    status: "succeeded",
    durationMs: 1250,
    metrics: {
      recordsSeen: 12,
      evidenceWritten: 10,
      transactionsWritten: 4,
    },
  });

  assert.equal(event.workspaceId, "123e4567-e89b-42d3-a456-426614174000");
  assert.equal(event.occurredAt, "2026-07-11T00:00:00.000Z");
  assert.deepEqual(event.metrics, { recordsSeen: 12, evidenceWritten: 10, transactionsWritten: 4 });
});

test("consented product experience events use an allowlisted source and numeric counts only", () => {
  const event = normalizeProductEvent({
    userId: "123e4567-e89b-42d3-a456-426614174001",
    eventName: "workspace.activated",
    source: "product-ui",
    status: "succeeded",
    metrics: { commitmentsTouched: 7, evidenceWritten: 14 },
  });

  assert.equal(event.eventName, "workspace.activated");
  assert.equal(event.source, "product-ui");
  assert.deepEqual(event.metrics, { commitmentsTouched: 7, evidenceWritten: 14 });
});

test("first-10 receipt experiment milestones stay privacy-safe and bounded", () => {
  const milestones = [
    "receipt_setup.started",
    "receipt_setup.completed",
    "receipt_forwarding.verified",
    "receipt_backfill.completed",
    "commitments.detected",
    "correction.recorded",
    "source.health_observed",
    "workspace.returned",
  ] as const;

  for (const eventName of milestones) {
    const event = normalizeProductEvent({
      workspaceId: "123e4567-e89b-42d3-a456-426614174000",
      userId: "123e4567-e89b-42d3-a456-426614174001",
      eventName,
      source: "workspace-api",
      status: "succeeded",
      durationMs: eventName === "receipt_setup.completed" ? 42_000 : null,
      metrics: {
        commitmentsDetected: eventName === "commitments.detected" ? 3 : 0,
        correctionsRecorded: eventName === "correction.recorded" ? 1 : 0,
        healthySources: eventName === "source.health_observed" ? 1 : 0,
      },
    });

    assert.equal(event.eventName, eventName);
    assert.deepEqual(event.metrics, {
      commitmentsDetected: eventName === "commitments.detected" ? 3 : 0,
      correctionsRecorded: eventName === "correction.recorded" ? 1 : 0,
      healthySources: eventName === "source.health_observed" ? 1 : 0,
    });
  }
});

test("product events reject raw payload fields, arbitrary metrics, PII-shaped IDs, and strings", () => {
  assert.throws(() => normalizeProductEvent({
    eventName: "ledger.materialized",
    source: "living-ledger",
    rawFinancialPayload: { merchant: "Secret" },
  } as ProductEventInput), /not privacy-safe/);

  assert.throws(() => normalizeProductEvent({
    eventName: "ledger.materialized",
    source: "living-ledger",
    metrics: { merchant: 1 },
  } as unknown as ProductEventInput), /not allowlisted/);

  assert.throws(() => normalizeProductEvent({
    workspaceId: "customer@example.com",
    eventName: "ledger.materialized",
    source: "living-ledger",
  }), /must be a UUID/);

  assert.throws(() => normalizeProductEvent({
    eventName: "ledger.materialized",
    source: "living-ledger",
    metrics: { recordsSeen: "12" },
  } as unknown as ProductEventInput), /bounded non-negative number/);
});

test("anonymous funnel ingestion is rejected until a separate legal basis and consent flow exist", async () => {
  const response = await postProductEvent(new Request("http://localhost/api/product-events", {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ eventName: "guest_audit.started", email: "person@example.com" }),
  }));
  assert.equal(response.status, 401);
});

test("client product-event ingest cannot mark a workspace activated", () => {
  const route = readFileSync(new URL("../src/app/api/product-events/route.ts", import.meta.url), "utf8");
  const evidenceRoute = readFileSync(new URL("../src/app/api/workspaces/current/evidence/route.ts", import.meta.url), "utf8");
  const briefRoute = readFileSync(new URL("../src/app/api/workspaces/current/brief/route.ts", import.meta.url), "utf8");
  const activationRoute = readFileSync(new URL("../src/app/api/workspaces/current/activation/route.ts", import.meta.url), "utf8");
  const store = readFileSync(new URL("../src/lib/server/product-event-store.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /"workspace.activated"/);
  assert.doesNotMatch(evidenceRoute, /recordWorkspaceActivationOnce|hasCitedRecurringSpendPicture/);
  assert.doesNotMatch(briefRoute, /recordWorkspaceActivationOnce|hasCitedRecurringSpendPicture/);
  assert.match(activationRoute, /hasActiveConsentGrant/);
  assert.match(activationRoute, /product-analytics-opt-in/);
  assert.match(activationRoute, /hasCitedRecurringSpendPicture/);
  assert.match(activationRoute, /getRecoveryHome/);
  assert.match(activationRoute, /rejectCrossSiteMutation/);
  assert.match(activationRoute, /recordWorkspaceActivationOnce/);
  assert.doesNotMatch(activationRoute, /readRecoveryJson|request\.json/);
  assert.match(store, /on conflict \(workspace_id\) where event_name = 'workspace.activated' and workspace_id is not null/i);
  assert.match(store, /activation_semantic_version/i);
  assert.match(store, /do nothing/i);
});

test("public audit clients do not automatically transmit first-session analytics", () => {
  const privateAudit = readFileSync(new URL("../src/app/private-audit/private-audit-client.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(privateAudit, /trackAnonymousFunnelEvent|\/api\/product-events/);
  for (const eventName of ["guest_audit.started", "guest_audit.evidence_added", "guest_audit.first_result_reached", "private_audit.opened"]) {
    assert.equal((productEventNames as readonly string[]).includes(eventName), false);
  }
});

test("the first-10 report covers the frozen receipt experiment without PII", () => {
  const report = readFileSync(new URL("../scripts/report-funnel.mjs", import.meta.url), "utf8");
  for (const metric of [
    "setupStarted",
    "setupCompleted",
    "forwardingVerified",
    "backfillCompleted",
    "commitmentsDetected",
    "userCorrectionCount",
    "medianSecondsToTrustworthyPicture",
    "sourcesRemainingHealthy",
    "returnVisits",
    "checkoutAttempts",
  ]) {
    assert.match(report, new RegExp(`\\b${metric}\\b`), `first-10 report must include ${metric}`);
  }
  assert.match(report, /recovery_inbound_aliases/);
  assert.match(report, /recovery_inbound_events/);
  assert.match(report, /event\.status = 'PROCESSED'/);
  assert.match(report, /interval '45 days'/);
  assert.match(report, /alias\.hmac_key_id = \$1/);
  assert.match(report, /RECEIPT_INBOX_ALIAS_HMAC_KEY_ID/);
  assert.match(report, /recovery_corrections/);
  assert.match(report, /secondsToTrustworthyPicture/);
  assert.match(report, /workspace\.returned/);
  assert.match(report, /billing\.checkout_started/);
  assert.doesNotMatch(report, /select[\s\S]{0,120}\b(?:email|subject|excerpt|raw_evidence|encrypted_display|alias_hmac)\b/i);
});
