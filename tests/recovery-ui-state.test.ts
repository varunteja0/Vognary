import assert from "node:assert/strict";
import test from "node:test";
import type { CommitmentDetailDto, CommitmentSummaryDto, HomeProjectionDto, ReceiptInboxStatusDto } from "../src/lib/recovery/contracts";
import {
  correctionPatchFromDraft,
  evidenceRequestFromDraft,
  displayedDecision,
  initialRecoveryState,
  recoveryReducer,
  type RecoveryState,
} from "../src/app/workspace/recovery/state";
import type { TransportFailure } from "../src/app/workspace/recovery/transport";

const money = { currency: "INR", minor: "199900", exponent: 2, display: "₹1,999.00" } as const;
const confidence = { state: "MEDIUM", score: 72, scale: "PERCENT_0_100", reasons: ["One receipt"] } as const;

const commitment: CommitmentSummaryDto = {
  id: "commitment-1",
  version: 1,
  status: "ACTIVE",
  merchant: "OpenAI",
  category: "AI tools",
  cadence: "MONTHLY",
  amount: money,
  monthlyEquivalent: money,
  nextExpectedDate: "2026-08-06",
  confidence,
  recommendedDecision: "MONITOR",
  decision: null,
  evidenceCount: 1,
  updatedAt: "2026-08-09T10:00:00.000Z",
};

const otherCommitment: CommitmentSummaryDto = { ...commitment, id: "commitment-2", merchant: "Notion" };

const home: HomeProjectionDto = {
  workspace: { id: "workspace-1", name: "Founder workspace", role: "owner", version: 4 },
  generatedAt: "2026-08-09T10:00:00.000Z",
  recentObservations: [],
  monthlyTotals: [],
  next30DayTotals: [],
  needsMe: [],
  changed: { state: "NO_PRIOR_BASELINE", fromVersion: null, toVersion: 4, items: [] },
  next: [],
  coverage: { state: "BASELINE_ONLY", sourceCount: 1, evidenceCount: 1, lastEvidenceAt: null, coverageStart: null, coverageEnd: null, limitations: [] },
};

const detail: CommitmentDetailDto = {
  ...commitment,
  recommendationReason: "Confirm with a second receipt.",
  riskTags: [],
  evidence: { items: [], total: 0, nextCursor: null },
  corrections: [],
};

const meta = { requestId: "request-1", workspaceVersion: 4 };
const receiptInbox = {
  state: "PROCESSING",
  alias: {
    id: "11111111-1111-4111-8111-111111111111",
    status: "ACTIVE",
    address: "rcpt_example@receipts.vognary.test",
    createdAt: "2026-08-10T10:00:00.000Z",
    rotatedAt: null,
    revokedAt: null,
  },
  lastReceivedAt: "2026-08-10T10:05:00.000Z",
  lastProcessedAt: null,
  lastFailureCode: null,
} as const satisfies ReceiptInboxStatusDto;

const failure = (error: TransportFailure["error"], origin: TransportFailure["origin"] = "SERVER"): TransportFailure => ({ ok: false, origin, error });

const loaded = (): RecoveryState =>
  recoveryReducer(initialRecoveryState, { type: "SNAPSHOT_LOADED", home, commitments: [commitment, otherCommitment], total: 9, nextCursor: null, meta });

test("a loaded snapshot stores server payloads verbatim in server order", () => {
  const state = loaded();
  assert.deepEqual(state.home, home);
  assert.deepEqual(state.commitments.map((item) => item.id), ["commitment-1", "commitment-2"]);
  assert.equal(state.workspaceVersion, 4);
  assert.equal(state.commitmentTotal, 9);
  assert.equal(state.status.kind, "READY");
  assert.equal(state.commitments[0].amount.display, "₹1,999.00");
});

test("source state stores provider status verbatim and keeps action progress separate", () => {
  const requested = recoveryReducer(loaded(), { type: "SOURCES_REQUESTED" });
  assert.equal(requested.sourceStatus.kind, "LOADING");
  assert.equal(requested.receiptInbox, null);

  const received = recoveryReducer(requested, { type: "SOURCES_LOADED", receiptInbox, meta });
  assert.equal(received.sourceStatus.kind, "READY");
  assert.deepEqual(received.receiptInbox, receiptInbox);
  assert.equal(received.receiptInbox?.state, "PROCESSING");

  const action = recoveryReducer(received, { type: "SOURCE_ACTION_STARTED", action: "ROTATE" });
  assert.equal(action.pendingSourceAction, "ROTATE");
  const saved = recoveryReducer(action, { type: "SOURCE_ACTION_SAVED", receiptInbox: { ...receiptInbox, state: "WAITING" }, meta });
  assert.equal(saved.pendingSourceAction, null);
  assert.equal(saved.receiptInbox?.state, "WAITING");

  const newer = recoveryReducer(received, {
    type: "SOURCES_LOADED",
    receiptInbox: { ...receiptInbox, state: "READY" },
    meta: { requestId: "request-newer-source", workspaceVersion: 5 },
  });
  assert.equal(newer.sourceStatus.kind, "READY");
  assert.equal(newer.receiptInbox?.state, "READY");
  assert.equal(newer.workspaceVersion, 4, "source status must not impersonate a canonical snapshot");
  assert.equal(newer.refreshRequired, true);
});

test("source authentication failures move the whole workspace to sign-in-required", () => {
  const authFailure = failure({
    code: "AUTH_REQUIRED",
    message: "Sign in to continue.",
    retryable: false,
    requestId: "request-source-auth",
  });
  const readFailed = recoveryReducer(loaded(), { type: "SOURCES_FAILED", failure: authFailure });
  assert.equal(readFailed.status.kind, "AUTH_REQUIRED");
  assert.equal(readFailed.sourceStatus.kind, "AUTH_REQUIRED");

  const actionFailed = recoveryReducer(
    recoveryReducer(loaded(), { type: "SOURCE_ACTION_STARTED", action: "ROTATE" }),
    { type: "SOURCE_ACTION_FAILED", failure: authFailure },
  );
  assert.equal(actionFailed.status.kind, "AUTH_REQUIRED");
  assert.equal(actionFailed.sourceStatus.kind, "AUTH_REQUIRED");
  assert.equal(actionFailed.pendingSourceAction, null);
});

test("a decision shows the reader's intent immediately and keeps the server decision underneath", () => {
  const pending = recoveryReducer(loaded(), {
    type: "DECISION_STARTED",
    commitmentId: "commitment-1",
    decision: "CANCEL",
    previous: null,
    idempotencyKey: "key-1",
  });

  assert.deepEqual(displayedDecision(pending, "commitment-1", null), { value: "CANCEL", pending: true });
  assert.deepEqual(displayedDecision(pending, "commitment-2", null), { value: null, pending: false });
  assert.equal(pending.commitments[0].decision, null, "the stored server row must not be rewritten optimistically");
  assert.equal(pending.announcement, "Saving Plan to cancel…");
});

test("a failed decision rolls back visibly and names what the workspace still holds", () => {
  const pending = recoveryReducer(loaded(), {
    type: "DECISION_STARTED",
    commitmentId: "commitment-1",
    decision: "CANCEL",
    previous: null,
    idempotencyKey: "key-1",
  });
  const rolledBack = recoveryReducer(pending, {
    type: "MUTATION_FAILED",
    failure: failure({ code: "SAVE_FAILED", message: "The change did not save.", retryable: true, requestId: "request-9" }),
  });

  assert.equal(rolledBack.pending, null);
  assert.deepEqual(displayedDecision(rolledBack, "commitment-1", null), { value: null, pending: false });
  assert.equal(rolledBack.rollback?.mutation.kind, "DECISION");
  assert.equal(rolledBack.rollback?.failure.error.requestId, "request-9");
  assert.match(rolledBack.announcement, /^Not saved\./);
  assert.equal(recoveryReducer(rolledBack, { type: "ROLLBACK_DISMISSED" }).rollback, null);
});

test("a saved decision swaps the row in place and never reorders the list", () => {
  const saved = recoveryReducer(loaded(), {
    type: "DECISION_SAVED",
    commitment: { ...otherCommitment, decision: { value: "KEEP", decidedAt: "2026-08-09T11:00:00.000Z", updatedAt: "2026-08-09T11:00:00.000Z" } },
    home,
    meta: { requestId: "request-2", workspaceVersion: 5 },
  });

  assert.deepEqual(saved.commitments.map((item) => item.id), ["commitment-1", "commitment-2"]);
  assert.equal(saved.commitments[1].decision?.value, "KEEP");
  assert.equal(saved.workspaceVersion, 5);
  assert.equal(saved.announcement, "Saved. Notion is now Keep.");
});

test("mutation responses never leave a stale commitment detail visible", () => {
  const withDetail = recoveryReducer(recoveryReducer(loaded(), { type: "COMMITMENT_SELECTED", commitmentId: "commitment-1" }), {
    type: "DETAIL_LOADED",
    detail,
    meta,
  });
  const evidenceSaved = recoveryReducer(withDetail, {
    type: "EVIDENCE_SUBMITTED",
    submission: { id: "submission-1", type: "RECEIPT_PASTE", ingestedAt: now(), acceptedEvidenceCount: 1, results: [{ clientRef: "receipt-1", status: "ACCEPTED", code: null, message: null }] },
    home,
    commitments: [{ ...commitment, amount: { ...money, minor: "209900", display: "₹2,099.00" } }, otherCommitment],
    total: 9,
    meta: { requestId: "request-evidence", workspaceVersion: 5 },
  });
  assert.equal(evidenceSaved.detail, null);
  assert.equal(evidenceSaved.detailStatus.kind, "LOADING");
  assert.equal(evidenceSaved.detailRefreshToken, withDetail.detailRefreshToken + 1);

  const decisionSaved = recoveryReducer(withDetail, {
    type: "DECISION_SAVED",
    commitment: { ...commitment, decision: { value: "KEEP", decidedAt: now(), updatedAt: now() } },
    home,
    meta: { requestId: "request-decision", workspaceVersion: 5 },
  });
  assert.equal(decisionSaved.detail, null);
  assert.equal(decisionSaved.detailStatus.kind, "LOADING");

  const correctedDetail = { ...detail, merchant: "OpenAI India", version: 2 };
  const correctionSaved = recoveryReducer(withDetail, {
    type: "CORRECTION_SAVED",
    detail: correctedDetail,
    home,
    meta: { requestId: "request-correction", workspaceVersion: 5 },
  });
  assert.equal(correctionSaved.detail?.merchant, "OpenAI India");
  assert.equal(correctionSaved.commitments[0].merchant, "OpenAI India");
});

test("pages and details from another workspace version are rejected instead of merged", () => {
  const page = recoveryReducer(loaded(), {
    type: "COMMITMENTS_PAGE_APPENDED",
    items: [{ ...commitment, id: "commitment-late" }],
    total: 10,
    nextCursor: null,
    meta: { requestId: "request-late", workspaceVersion: 5 },
  });
  assert.equal(page.refreshRequired, true);
  assert.deepEqual(page.commitments.map((item) => item.id), ["commitment-1", "commitment-2"]);

  const selected = recoveryReducer(loaded(), { type: "COMMITMENT_SELECTED", commitmentId: "commitment-1" });
  const staleDetail = recoveryReducer(selected, {
    type: "DETAIL_LOADED",
    detail,
    meta: { requestId: "request-detail-late", workspaceVersion: 5 },
  });
  assert.equal(staleDetail.refreshRequired, true);
  assert.equal(staleDetail.detail, null);
});

test("reloading a stale selected detail schedules a fresh detail request", () => {
  const selected = recoveryReducer(loaded(), { type: "COMMITMENT_SELECTED", commitmentId: "commitment-1" });
  const staleDetail = recoveryReducer(selected, {
    type: "DETAIL_LOADED",
    detail,
    meta: { requestId: "request-stale-detail", workspaceVersion: 5 },
  });
  const reloaded = recoveryReducer(staleDetail, {
    type: "SNAPSHOT_LOADED",
    home: { ...home, workspace: { ...home.workspace, version: 5 } },
    commitments: [commitment, otherCommitment],
    total: 2,
    nextCursor: null,
    meta: { requestId: "request-reload", workspaceVersion: 5 },
  });
  assert.equal(reloaded.detail, null);
  assert.equal(reloaded.detailStatus.kind, "LOADING");
  assert.equal(reloaded.detailRefreshToken, staleDetail.detailRefreshToken + 1);
});

test("stale and conflicting state force a reload instead of a silent guess", () => {
  for (const code of ["STALE_STATE", "CONFLICT"] as const) {
    const state = recoveryReducer(loaded(), {
      type: "EVIDENCE_SUBMIT_FAILED",
      failure: failure(
        code === "STALE_STATE"
          ? { code, message: "Workspace state changed.", retryable: true, requestId: "request-stale", currentVersion: 9 }
          : { code, message: "Another change landed first.", retryable: true, requestId: "request-conflict" },
      ),
    });
    assert.equal(state.refreshRequired, true, `${code} must require a reload`);
    assert.equal(state.home, home, `${code} must not disturb the last server truth`);
  }
});

test("an auth failure moves the whole workspace into the signed-out state", () => {
  const state = recoveryReducer(loaded(), {
    type: "SNAPSHOT_FAILED",
    failure: failure({ code: "AUTH_REQUIRED", message: "Sign in.", retryable: false, requestId: "request-auth" }),
  });
  assert.equal(state.status.kind, "AUTH_REQUIRED");

  const signedOut = recoveryReducer(initialRecoveryState, {
    type: "SESSION_RESOLVED",
    session: { authenticated: false, configuration: { status: "ready", cookieName: "vognary_session" }, session: null },
  });
  assert.equal(signedOut.status.kind, "AUTH_REQUIRED");
});

test("evidence results decide whether the draft is cleared or kept for repair", () => {
  const withDraft = recoveryReducer(loaded(), { type: "RECEIPT_DRAFT_CHANGED", text: "OpenAI invoice INR 1,999" });

  const accepted = recoveryReducer(withDraft, {
    type: "EVIDENCE_SUBMITTED",
    submission: { id: "submission-1", type: "RECEIPT_PASTE", ingestedAt: "2026-08-09T10:00:00.000Z", acceptedEvidenceCount: 1, results: [{ clientRef: "receipt-paste-1", status: "ACCEPTED", code: null, message: null }] },
    home,
    commitments: [commitment],
    total: 2,
    meta,
  });
  assert.equal(accepted.evidenceDraft.receiptText, "");
  assert.equal(accepted.announcement, "Evidence submitted. 1 accepted of 1 sent.");

  const rejected = recoveryReducer(withDraft, {
    type: "EVIDENCE_SUBMITTED",
    submission: { id: "submission-2", type: "RECEIPT_PASTE", ingestedAt: "2026-08-09T10:00:00.000Z", acceptedEvidenceCount: 0, results: [{ clientRef: "receipt-paste-1", status: "REJECTED", code: "DUPLICATE_EVIDENCE", message: "Already submitted." }] },
    home,
    commitments: [commitment],
    total: 2,
    meta,
  });
  assert.equal(rejected.evidenceDraft.receiptText, "OpenAI invoice INR 1,999", "rejected text must stay so it can be fixed");
  assert.equal(rejected.submission?.results[0].status, "REJECTED");
});

test("dialogs record where focus must return and prefill corrections from server values only", () => {
  const withDetail = recoveryReducer(recoveryReducer(loaded(), { type: "COMMITMENT_SELECTED", commitmentId: "commitment-1" }), {
    type: "DETAIL_LOADED",
    detail,
    meta,
  });
  const open = recoveryReducer(withDetail, {
    type: "DIALOG_OPENED",
    dialog: { kind: "CORRECTION", commitmentId: "commitment-1", field: "AMOUNT" },
    returnFocusId: "recovery-correct-AMOUNT",
  });

  assert.equal(open.returnFocusId, "recovery-correct-AMOUNT");
  assert.equal(open.correctionDraft.amountMinor, "199900");
  assert.equal(open.correctionDraft.merchant, "OpenAI");
  assert.equal(open.correctionDraft.cadence, "MONTHLY");
  assert.equal(open.correctionDraft.isRecurring, true);

  const closed = recoveryReducer(open, { type: "DIALOG_CLOSED" });
  assert.equal(closed.dialog, null);
  assert.equal(closed.returnFocusId, null);
});

test("correction drafts only become contract patches when they are complete", () => {
  const base = { field: "MERCHANT", merchant: "", amountMinor: "", date: "", cadence: "MONTHLY", isRecurring: true, reason: "" } as const;

  assert.equal(correctionPatchFromDraft({ ...base }), null);
  assert.deepEqual(correctionPatchFromDraft({ ...base, merchant: " OpenAI " }), { field: "MERCHANT", value: { merchant: "OpenAI" } });
  assert.equal(correctionPatchFromDraft({ ...base, field: "AMOUNT" }), null);
  assert.equal(correctionPatchFromDraft({ ...base, field: "AMOUNT", amountMinor: "19.99" }), null);
  assert.equal(correctionPatchFromDraft({ ...base, field: "AMOUNT", amountMinor: "0199900" }), null);
  assert.deepEqual(correctionPatchFromDraft({ ...base, field: "AMOUNT", amountMinor: "9007199254740993" }), { field: "AMOUNT", value: { amountMinor: "9007199254740993" } });
  assert.equal(correctionPatchFromDraft({ ...base, field: "NEXT_EXPECTED_DATE", date: "06-08-2026" }), null);
  assert.deepEqual(correctionPatchFromDraft({ ...base, field: "NEXT_EXPECTED_DATE", date: "2026-08-06" }), { field: "NEXT_EXPECTED_DATE", value: { date: "2026-08-06" } });
  assert.deepEqual(correctionPatchFromDraft({ ...base, field: "CADENCE", cadence: "YEARLY" }), { field: "CADENCE", value: { cadence: "YEARLY" } });
  assert.deepEqual(correctionPatchFromDraft({ ...base, field: "IS_RECURRING", isRecurring: false }), { field: "IS_RECURRING", value: { isRecurring: false } });
});

test("evidence requests are built from the chosen mode, not from stale draft state", () => {
  const draft = { mode: "CSV_IMPORT" as const, receiptText: "  OpenAI invoice  ", preparing: false, csvSources: [{ clientRef: "csv-1", name: "statement.csv", text: "Date,Description", rowCount: 1, warnings: [] }] };

  assert.deepEqual(evidenceRequestFromDraft(draft, "RECEIPT_PASTE"), { kind: "RECEIPT_PASTE", receipts: [{ clientRef: "receipt-paste-1", text: "OpenAI invoice" }] });
  assert.deepEqual(evidenceRequestFromDraft(draft, "CSV_IMPORT"), { kind: "CSV_IMPORT", sources: [{ clientRef: "csv-1", name: "statement.csv", text: "Date,Description" }] });
  assert.equal(evidenceRequestFromDraft({ ...draft, receiptText: "   " }, "RECEIPT_PASTE"), null);
  assert.equal(evidenceRequestFromDraft({ ...draft, csvSources: [] }, "CSV_IMPORT"), null);
});

test("going offline is announced once and never invents a reason for the gap", () => {
  const offline = recoveryReducer(loaded(), { type: "NETWORK_CHANGED", online: false });
  assert.equal(offline.online, false);
  assert.match(offline.announcement, /Offline\./);

  const repeated = recoveryReducer(offline, { type: "NETWORK_CHANGED", online: false });
  assert.equal(repeated, offline, "an unchanged connection state must not re-announce");
  assert.equal(recoveryReducer(offline, { type: "NETWORK_CHANGED", online: true }).announcement, "Back online.");
});

test("selecting a commitment resets its evidence page and asking for a page reloads it", () => {
  const selected = recoveryReducer(loaded(), { type: "COMMITMENT_SELECTED", commitmentId: "commitment-1" });
  assert.equal(selected.detail, null);
  assert.equal(selected.detailEvidenceCursor, null);
  assert.equal(selected.detailStatus.kind, "LOADING");

  const paged = recoveryReducer(recoveryReducer(selected, { type: "DETAIL_LOADED", detail, meta }), {
    type: "DETAIL_EVIDENCE_PAGE_REQUESTED",
    cursor: "evidence-cursor-2",
  });
  assert.equal(paged.detailEvidenceCursor, "evidence-cursor-2");
  assert.equal(paged.detailStatus.kind, "LOADING");
});

function now() {
  return "2026-08-09T11:00:00.000Z";
}
