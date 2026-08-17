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
