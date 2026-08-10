import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGuestAuditTransferBinding,
  buildGuestAuditSnapshot,
  buildGuestRecoveryEvidenceTransfer,
  guestAuditTransferMaxBytes,
  guestAuditTransferTtlMs,
  mergeGuestAuditSnapshot,
  parseGuestAuditTransferBinding,
  parseGuestAuditSnapshot,
  persistGuestRecoveryEvidenceTransfer,
} from "../src/lib/guest-audit-transfer";

test("guest audit transfer rejects malformed state", () => {
  assert.equal(parseGuestAuditSnapshot("not json"), null);
  assert.equal(parseGuestAuditSnapshot(JSON.stringify({ version: 1 })), null);
  assert.equal(parseGuestAuditSnapshot(JSON.stringify({ version: 2, statementSources: [], manualItems: [] })), null);
});

test("guest transfer becomes bounded Recovery evidence only after sign-in without trusting manual claims", () => {
  const snapshot = buildGuestAuditSnapshot({
    receiptText: "OpenAI invoice INR 1,999. Renews monthly.\n\nGitHub invoice USD 100. Renews yearly.",
    statementSources: [
      { id: "csv-one", name: "statement.csv", text: "Date,Description,Debit\n2026-01-01,OPENAI,1999", rowCount: 1, kind: "csv" },
      { id: "pdf-one", name: "statement.pdf", text: "extracted pdf text", rowCount: 1, kind: "pdf" },
    ],
    manualItems: [{
      id: "manual-one",
      merchant: "Uncited manual claim",
      amount: 999,
      currency: "INR",
      frequency: "monthly",
      nextExpectedDate: "2026-09-01",
      category: "Other",
    }],
  });
  const transfer = buildGuestRecoveryEvidenceTransfer(snapshot);
  assert.ok(transfer);
  assert.deepEqual(transfer.requests, [
    {
      kind: "RECEIPT_PASTE",
      receipts: [
        { clientRef: "guest-receipt-1", text: "OpenAI invoice INR 1,999. Renews monthly." },
        { clientRef: "guest-receipt-2", text: "GitHub invoice USD 100. Renews yearly." },
      ],
    },
    {
      kind: "CSV_IMPORT",
      sources: [{ clientRef: "csv-one", name: "statement.csv", text: "Date,Description,Debit\n2026-01-01,OPENAI,1999" }],
    },
  ]);
  assert.deepEqual(transfer.unsupportedSourceNames, ["statement.pdf"]);
  assert.equal(transfer.unsupportedManualItemCount, 1);
});

test("guest audit transfer preserves receipt and statement evidence without duplication", () => {
  const exportedAt = new Date("2026-07-13T10:00:00.000Z");
  const guest = buildGuestAuditSnapshot({
    receiptText: "OpenAI invoice INR 1,999. Renews monthly.",
    statementSources: [{ id: "guest-one", name: "one.csv", text: "Date,Description,Debit\n2026-01-01,OPENAI,1999", rowCount: 1, kind: "csv" }],
    manualItems: [],
  }, exportedAt);
  const parsed = parseGuestAuditSnapshot(JSON.stringify(guest), new Date(exportedAt.getTime() + 1_000));
  assert.ok(parsed);
  assert.equal(parsed.exportedAt, exportedAt.toISOString());

  const merged = mergeGuestAuditSnapshot({
    ...guest,
    statementSources: [{ ...guest.statementSources[0], id: "already-saved" }],
  }, parsed);

  assert.equal(merged.statementSources.length, 1);
  assert.equal(merged.receiptText, guest.receiptText);
  assert.deepEqual(merged.manualItems, []);
});

test("guest audit transfer expires and rejects oversized or over-count state", () => {
  const exportedAt = new Date("2026-07-13T10:00:00.000Z");
  const guest = buildGuestAuditSnapshot({ receiptText: "Receipt", statementSources: [], manualItems: [] }, exportedAt);
  const serialized = JSON.stringify(guest);

  assert.ok(parseGuestAuditSnapshot(serialized, new Date(exportedAt.getTime() + guestAuditTransferTtlMs)));
  assert.equal(parseGuestAuditSnapshot(serialized, new Date(exportedAt.getTime() + guestAuditTransferTtlMs + 1)), null);
  assert.equal(parseGuestAuditSnapshot("x".repeat(guestAuditTransferMaxBytes + 1), exportedAt), null);

  const tooManyManualItems = {
    ...guest,
    manualItems: Array.from({ length: 201 }, (_, index) => ({
      id: `manual-${index}`,
      merchant: `Merchant ${index}`,
      amount: 100,
      frequency: "monthly",
      nextExpectedDate: "2026-08-01",
    })),
  };
  assert.equal(parseGuestAuditSnapshot(JSON.stringify(tooManyManualItems), exportedAt), null);

  const malformedSource = { ...guest, statementSources: [{ id: "source", name: "statement.csv", text: "Date,Description,Debit", rowCount: -1 }] };
  assert.equal(parseGuestAuditSnapshot(JSON.stringify(malformedSource), exportedAt), null);
});

test("guest Recovery persistence advances versions sequentially with stable retry keys", async () => {
  const snapshot = buildGuestAuditSnapshot({
    receiptText: "OpenAI invoice INR 1,999. Renews monthly.",
    statementSources: [{ id: "csv-one", name: "statement.csv", text: "Date,Description,Debit\n2026-01-01,OPENAI,1999", rowCount: 1, kind: "csv" }],
    manualItems: [],
  }, new Date("2026-08-10T03:30:00.000Z"));
  const calls: Array<{ workspaceVersion: number; idempotencyKey: string; kind: string }> = [];

  const result = await persistGuestRecoveryEvidenceTransfer({
    snapshot,
    initialWorkspaceVersion: 4,
    submit: async (request, context) => {
      calls.push({ ...context, kind: request.kind });
      return {
        ok: true,
        workspaceVersion: context.workspaceVersion + 1,
        acceptedEvidenceCount: 1,
        results: [{ status: "ACCEPTED" as const }],
      };
    },
  });

  assert.deepEqual(calls, [
    { workspaceVersion: 4, idempotencyKey: "guest-transfer-v1-20260810T033000000Z-1", kind: "RECEIPT_PASTE" },
    { workspaceVersion: 5, idempotencyKey: "guest-transfer-v1-20260810T033000000Z-2", kind: "CSV_IMPORT" },
  ]);
  assert.deepEqual(result, {
    ok: true,
    workspaceVersion: 6,
    completedRequests: 2,
    acceptedEvidenceCount: 2,
    unsupportedSourceNames: [],
    unsupportedManualItemCount: 0,
  });
});

test("guest Recovery persistence retains staged evidence after partial or unconfirmed saves", async () => {
  const snapshot = buildGuestAuditSnapshot({
    receiptText: "OpenAI invoice INR 1,999. Renews monthly.",
    statementSources: [{ id: "csv-one", name: "statement.csv", text: "Date,Description,Debit\n2026-01-01,OPENAI,1999", rowCount: 1, kind: "csv" }],
    manualItems: [],
  }, new Date("2026-08-10T03:30:00.000Z"));

  const partial = await persistGuestRecoveryEvidenceTransfer({
    snapshot,
    initialWorkspaceVersion: 7,
    submit: async (_request, context) => context.idempotencyKey.endsWith("-1")
      ? { ok: true, workspaceVersion: 8, acceptedEvidenceCount: 1, results: [{ status: "ACCEPTED" as const }] }
      : { ok: false },
  });
  assert.deepEqual(partial, {
    ok: false,
    reason: "SUBMISSION_FAILED",
    workspaceVersion: 8,
    completedRequests: 1,
  });

  const rejected = await persistGuestRecoveryEvidenceTransfer({
    snapshot: buildGuestAuditSnapshot({ receiptText: "Unparseable receipt", statementSources: [], manualItems: [] }, new Date("2026-08-10T03:31:00.000Z")),
    initialWorkspaceVersion: 8,
    submit: async () => ({ ok: true, workspaceVersion: 8, acceptedEvidenceCount: 0, results: [{ status: "REJECTED" as const }] }),
  });
  assert.deepEqual(rejected, {
    ok: false,
    reason: "PERSISTENCE_UNCONFIRMED",
    workspaceVersion: 8,
    completedRequests: 0,
  });
});

test("a retained guest transfer is bound to the first authenticated account", () => {
  const snapshot = buildGuestAuditSnapshot({ receiptText: "Receipt", statementSources: [], manualItems: [] }, new Date("2026-08-10T03:30:00.000Z"));
  const serialized = buildGuestAuditTransferBinding(snapshot, { userId: "user-a", workspaceId: "workspace-a" });
  assert.deepEqual(parseGuestAuditTransferBinding(serialized, snapshot), { userId: "user-a", workspaceId: "workspace-a" });
  assert.equal(parseGuestAuditTransferBinding(serialized, { ...snapshot, exportedAt: "2026-08-10T03:31:00.000Z" }), null);
});
