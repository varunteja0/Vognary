import assert from "node:assert/strict";
import test from "node:test";
import { BillReviewError, writeBillDisposition } from "../src/app/workspace/recovery/bill-review-transport";
import type { BillDispositionInput } from "../src/lib/zoho-books/resolution";

const request: BillDispositionInput = { billId: "200001", sourceSequence: "2", expectedLatestSequence: "2", expectedVersion: "0", idempotencyKey: "synthetic-retry-key", kind: "RESOLVED", note: "Synthetic change explained", followUpOn: null };
const result = { id: "11111111-1111-4111-8111-111111111111", eventSequence: "1", sourceSequence: "2", version: "1", billId: "200001", actorUserId: "22222222-2222-4222-8222-222222222222", kind: "RESOLVED", note: request.note, followUpOn: null, responsibleUserId: null, createdAt: "2026-09-06T00:00:00.000Z", basis: "HUMAN_REVIEW_NOT_PAYMENT" };

test("an interrupted disposition retains the original workspace and idempotency request on retry", async context => {
  const calls: RequestInit[] = [];
  context.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    calls.push(init);
    if (calls.length === 1) throw new Error("Synthetic response loss");
    return Response.json({ data: result });
  });
  await assert.rejects(writeBillDisposition("synthetic-workspace", request), error => error instanceof BillReviewError && error.unconfirmed);
  assert.equal((await writeBillDisposition("synthetic-workspace", request)).id, result.id);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(new Headers(calls[1].headers).get("idempotency-key"), request.idempotencyKey);
  assert.equal(new Headers(calls[1].headers).get("X-Vognary-Workspace"), "synthetic-workspace");
});

test("stale refusal is distinct from an unknown financial save outcome", async context => {
  context.mock.method(globalThis, "fetch", async () => Response.json({ error: {} }, { status: 409 }));
  await assert.rejects(writeBillDisposition("synthetic-workspace", request), error => error instanceof BillReviewError && !error.unconfirmed && error.status === 409);
});

test("a successful HTTP status with another revision cannot confirm the disposition", async context => {
  context.mock.method(globalThis, "fetch", async () => Response.json({ data: { ...result, sourceSequence: "3" } }));
  await assert.rejects(writeBillDisposition("synthetic-workspace", request), error => error instanceof BillReviewError && error.unconfirmed);
});
