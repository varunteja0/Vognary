import assert from "node:assert/strict";
import test from "node:test";
import { createRecoveryTransport, type FetchLike } from "../src/app/workspace/recovery/transport";

type Call = { path: string; init: RequestInit | undefined };

function recorder(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (path, init) => {
    const call = { path, init };
    calls.push(call);
    return handler(call);
  };
  return { calls, fetchImpl };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const home = {
  workspace: { id: "workspace-1", name: "Founder workspace", role: "owner", version: 4 },
  generatedAt: "2026-08-09T10:00:00.000Z",
  monthlyTotals: [],
  next30DayTotals: [],
  confidenceLayers: [],
  needsMe: [],
  changed: { state: "NO_PRIOR_BASELINE", fromVersion: null, toVersion: 4, items: [] },
  next: [],
  coverage: { state: "BASELINE_ONLY", sourceCount: 1, evidenceCount: 1, lastEvidenceAt: null, coverageStart: null, coverageEnd: null, limitations: [] },
};

const commitment = {
  id: "commitment-1",
  version: 1,
  status: "ACTIVE",
  merchant: "OpenAI",
  category: "AI tools",
  cadence: "MONTHLY",
  amount: { currency: "INR", minor: "199900", exponent: 2, display: "₹1,999.00" },
  monthlyEquivalent: { currency: "INR", minor: "199900", exponent: 2, display: "₹1,999.00" },
  nextExpectedDate: "2026-08-06",
  confidence: { state: "MEDIUM", score: 72, scale: "PERCENT_0_100", reasons: [] },
  recommendedDecision: "MONITOR",
  decision: null,
  evidenceCount: 1,
  updatedAt: "2026-08-09T10:00:00.000Z",
};

test("mutations carry the exact contract headers and body the server requires", async () => {
  const { calls, fetchImpl } = recorder(() =>
    json({ data: { decision: { value: "CANCEL", decidedAt: "2026-08-09T10:00:00.000Z", updatedAt: "2026-08-09T10:00:00.000Z" }, commitment, home }, meta: { requestId: "request-1", workspaceVersion: 5 } }),
  );
  const transport = createRecoveryTransport(fetchImpl);

  const result = await transport.putDecision({ commitmentId: "commitment-1", decision: "CANCEL" }, { workspaceVersion: 4, idempotencyKey: "key-1" });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/workspaces/current/decisions");
  assert.equal(calls[0].init?.method, "PUT");
  assert.deepEqual(calls[0].init?.headers, {
    "Content-Type": "application/json",
    "Idempotency-Key": "key-1",
    "If-Match": '"workspace:4"',
  });
  assert.equal(calls[0].init?.body, JSON.stringify({ commitmentId: "commitment-1", decision: "CANCEL" }));
  assert.equal(calls[0].init?.cache, "no-store");
});

test("purpose context is saved against the encoded commitment path", async () => {
  const { calls, fetchImpl } = recorder(() =>
    json({ data: { context: { purpose: "CODING", importance: null, owner: null, updatedAt: "2026-08-09T10:00:00.000Z" }, commitment, home }, meta: { requestId: "request-context", workspaceVersion: 5 } }),
  );
  const result = await createRecoveryTransport(fetchImpl).putCommitmentContext(
    "commitment 1",
    { purpose: "CODING" },
    { workspaceVersion: 4, idempotencyKey: "key-context" },
  );

  assert.equal(result.ok, true);
  assert.equal(calls[0].path, "/api/workspaces/current/commitments/commitment%201/context");
  assert.equal(calls[0].init?.method, "PUT");
  assert.equal(calls[0].init?.body, JSON.stringify({ purpose: "CODING" }));
});

test("correction paths percent-encode identifiers and reversal uses DELETE", async () => {
  const detail = { ...commitment, recommendationReason: "", riskTags: [], evidence: { items: [], total: 0, nextCursor: null }, corrections: [], expectation: { status: "INSUFFICIENT_HISTORY", expectedDate: null, expectedAmount: null, observedDate: null, observedAmount: null, windowStart: null, windowEnd: null, summary: "There is not enough settled rhythm yet to compare an expected charge with what arrived.", reasons: [] }, memory: [], belief: null, because: [] };
  const correction = { id: "correction 1", commitmentId: "commitment 1", patch: { field: "MERCHANT", value: { merchant: "OpenAI" } }, reason: null, status: "REVERSED", createdAt: "2026-08-09T10:00:00.000Z", reversedAt: "2026-08-09T10:01:00.000Z", supersededAt: null };
  const { calls, fetchImpl } = recorder(() => json({ data: { correction, commitment: detail, home }, meta: { requestId: "request-2", workspaceVersion: 6 } }));
  const transport = createRecoveryTransport(fetchImpl);

  await transport.createCorrection("commitment 1", { patch: { field: "MERCHANT", value: { merchant: "OpenAI" } } }, { workspaceVersion: 5, idempotencyKey: "key-2" });
  await transport.reverseCorrection("commitment 1", "correction 1", { workspaceVersion: 6, idempotencyKey: "key-3" });

  assert.equal(calls[0].path, "/api/workspaces/current/commitments/commitment%201/corrections");
  assert.equal(calls[0].init?.method, "POST");
  assert.equal(calls[1].path, "/api/workspaces/current/commitments/commitment%201/corrections/correction%201");
  assert.equal(calls[1].init?.method, "DELETE");
});

test("evidence paging is requested with the contract page size and cursor", async () => {
  const detail = { ...commitment, recommendationReason: "", riskTags: [], evidence: { items: [], total: 0, nextCursor: null }, corrections: [], expectation: { status: "INSUFFICIENT_HISTORY", expectedDate: null, expectedAmount: null, observedDate: null, observedAmount: null, windowStart: null, windowEnd: null, summary: "There is not enough settled rhythm yet to compare an expected charge with what arrived.", reasons: [] }, memory: [], belief: null, because: [] };
  const { calls, fetchImpl } = recorder(() => json({ data: detail, meta: { requestId: "request-3", workspaceVersion: 4 } }));
  const transport = createRecoveryTransport(fetchImpl);

  await transport.commitment("commitment-1", { evidenceLimit: 50, evidenceCursor: "evidence-cursor-2" });

  assert.equal(calls[0].path, "/api/workspaces/current/commitments/commitment-1?evidenceLimit=50&evidenceCursor=evidence-cursor-2");
});

test("a contract failure is surfaced verbatim and attributed to the server", async () => {
  const { fetchImpl } = recorder(() =>
    json({ error: { code: "STALE_STATE", message: "Workspace state changed.", retryable: true, requestId: "request-stale", currentVersion: 9 } }, 412),
  );
  const result = await createRecoveryTransport(fetchImpl).home();

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.origin, "SERVER");
  assert.equal(result.error.code, "STALE_STATE");
  assert.equal(result.error.requestId, "request-stale");
  assert.equal(result.error.code === "STALE_STATE" ? result.error.currentVersion : null, 9);
});

test("a malformed failure is never presented as server truth", async () => {
  const missingVersion = await createRecoveryTransport(recorder(() => json({ error: { code: "STALE_STATE", message: "…", retryable: true, requestId: "r" } }, 412)).fetchImpl).home();
  assert.equal(missingVersion.ok, false);
  if (!missingVersion.ok) {
    assert.equal(missingVersion.origin, "CLIENT");
    assert.equal(missingVersion.error.code, "UNKNOWN");
    assert.equal(missingVersion.error.requestId, "client-device");
  }

  const unreadable = await createRecoveryTransport(async () => new Response("<html>gateway</html>", { status: 502 })).home();
  assert.equal(unreadable.ok, false);
  if (!unreadable.ok) assert.equal(unreadable.origin, "CLIENT");

  const offline = await createRecoveryTransport(async () => {
    throw new TypeError("Failed to fetch");
  }).home();
  assert.equal(offline.ok, false);
  if (!offline.ok) {
    assert.equal(offline.origin, "CLIENT");
    assert.match(offline.error.message, /could not reach the workspace/i);
    assert.equal(offline.error.retryable, true);
  }
});

test("successful payloads are returned exactly as published, without reshaping", async () => {
  const { fetchImpl } = recorder(() => json({ data: { items: [commitment], total: 7, nextCursor: "cursor-2" }, meta: { requestId: "request-4", workspaceVersion: 4 } }));
  const result = await createRecoveryTransport(fetchImpl).commitments();

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.data.items[0], commitment);
  assert.equal(result.data.items[0].amount.display, "₹1,999.00");
  assert.equal(result.data.total, 7);
  assert.equal(result.data.nextCursor, "cursor-2");
  assert.deepEqual(result.meta, { requestId: "request-4", workspaceVersion: 4 });
});

test("receipt inbox transport uses exact source paths and preserves server state", async () => {
  const receiptInbox = {
    state: "WAITING",
    alias: {
      id: "11111111-1111-4111-8111-111111111111",
      status: "ACTIVE",
      address: "rcpt_example@receipts.vognary.test",
      createdAt: "2026-08-10T10:00:00.000Z",
      rotatedAt: null,
      revokedAt: null,
    },
    lastReceivedAt: null,
    lastProcessedAt: null,
    lastFailureCode: null,
  };
  const { calls, fetchImpl } = recorder(() => json({ data: receiptInbox, meta: { requestId: "request-source", workspaceVersion: 4 } }));
  const transport = createRecoveryTransport(fetchImpl);

  const read = await transport.sources();
  const provision = await transport.provisionReceiptInbox();
  const rotate = await transport.rotateReceiptInbox("11111111-1111-4111-8111-111111111111", "rotate-source-1234");
  const revoke = await transport.revokeReceiptInbox();

  assert.deepEqual(calls.map((call) => [call.path, call.init?.method ?? "GET"]), [
    ["/api/workspaces/current/sources", "GET"],
    ["/api/workspaces/current/sources/receipt-inbox", "POST"],
    ["/api/workspaces/current/sources/receipt-inbox/rotate", "POST"],
    ["/api/workspaces/current/sources/receipt-inbox", "DELETE"],
  ]);
  assert.equal(calls[2].init?.headers && (calls[2].init.headers as Record<string, string>)["If-Match"], '"11111111-1111-4111-8111-111111111111"');
  assert.equal(calls[2].init?.headers && (calls[2].init.headers as Record<string, string>)["Idempotency-Key"], "rotate-source-1234");
  for (const result of [read, provision, rotate, revoke]) {
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.data, receiptInbox);
  }
});

test("workspace activation is a CSRF POST that sends no client totals", async () => {
  const { calls, fetchImpl } = recorder(() =>
    json({ data: { recorded: true, id: "event-1" }, meta: { requestId: "request-activation", workspaceVersion: 4 } }, 201),
  );
  const result = await createRecoveryTransport(fetchImpl).recordWorkspaceActivation();

  assert.equal(result.ok, true);
  assert.equal(calls[0].path, "/api/workspaces/current/activation");
  assert.equal(calls[0].init?.method, "POST");
  assert.equal(calls[0].init?.body, "{}");
  assert.doesNotMatch(String(calls[0].init?.body), /monthlyTotals|annualizedEstimateTotals|activeCommitmentCount/);
});

test("session and file preparation use their unwrapped contract responses", async () => {
  const sessionPayload = { authenticated: true, configuration: { status: "ready", cookieName: "vognary_session" }, session: { userId: "user-1", email: "founder@example.com", workspaceId: "workspace-1", expiresAt: "2026-08-16T10:00:00.000Z" } };
  const session = await createRecoveryTransport(recorder(() => json(sessionPayload)).fetchImpl).session();
  assert.equal(session.ok, true);
  if (session.ok) assert.deepEqual(session.data, sessionPayload);

  const prepared = { mode: "stateless-ingestion-api", storage: "none", sources: [{ name: "statement.csv", text: "Date,Description", kind: "csv", rowCount: 1, warnings: [] }] };
  const { calls, fetchImpl } = recorder(() => json(prepared));
  const importResult = await createRecoveryTransport(fetchImpl).prepareImport([new File(["Date,Description"], "statement.csv", { type: "text/csv" })]);

  assert.equal(calls[0].path, "/api/ingest");
  assert.equal(calls[0].init?.method, "POST");
  assert.equal(calls[0].init?.body instanceof FormData, true);
  assert.equal((calls[0].init?.body as FormData).get("mode"), "recovery-v1");
  assert.equal((calls[0].init?.body as FormData).getAll("files").length, 1);
  assert.equal(importResult.ok, true);
  if (importResult.ok) assert.equal(importResult.data.sources[0].rowCount, 1);
});

test("a bare legacy error message is shown without inventing a contract code", async () => {
  const result = await createRecoveryTransport(recorder(() => json({ error: "Attach at least one statement export or PDF file as files." }, 400)).fetchImpl)
    .prepareImport([]);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.origin, "SERVER");
  assert.equal(result.error.code, "UNKNOWN");
  assert.equal(result.error.message, "Attach at least one statement export or PDF file as files.");
});

test("evidence-source disconnect and reconnect use the canonical Recovery endpoints", async () => {
  const payload = {
    sourceId: "source 1",
    disconnectedAt: "2026-08-16T00:00:00.000Z",
    reconnectedAt: null,
    withdrawnCandidateIds: ["candidate-1"],
  };
  const { calls, fetchImpl } = recorder(() => json({ data: payload, meta: { requestId: "request-source", workspaceVersion: 5 } }));
  const transport = createRecoveryTransport(fetchImpl);
  const disconnected = await transport.disconnectRecoverySource("source 1", { workspaceVersion: 4, idempotencyKey: "key-disconnect" });
  const reconnected = await transport.reconnectRecoverySource("source 1", { workspaceVersion: 5, idempotencyKey: "key-reconnect" });
  assert.equal(disconnected.ok, true);
  assert.equal(reconnected.ok, true);
  assert.equal(calls[0].path, "/api/workspaces/current/autopilot/sources/source%201/disconnect");
  assert.equal(calls[0].init?.method, "POST");
  assert.equal(calls[1].path, "/api/workspaces/current/autopilot/sources/source%201/reconnect");
  assert.equal(calls[1].init?.method, "POST");
});
