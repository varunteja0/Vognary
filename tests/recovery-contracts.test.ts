import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  attentionReasons,
  cadences,
  changeKinds,
  commitmentStatuses,
  confidenceStates,
  correctionFields,
  correctionStatuses,
  coverageStates,
  decisions,
  evidenceProvenanceKinds,
  receiptInboxAliasStates,
  receiptInboxUpdateStates,
  recoveryEndpoints,
  recoveryErrorCodes,
  recoveryErrorStatusByCode,
  recoveryLimits,
  sourceTypes,
  type ApiFailure,
  type AttentionReason,
  type Cadence,
  type ChangeKind,
  type ChangeItemDto,
  type CommitmentDetailDto,
  type CommitmentStatus,
  type ConfidenceState,
  type CorrectionField,
  type CorrectionPatch,
  type CorrectionDto,
  type CorrectionStatus,
  type CoverageState,
  type Decision,
  type EvidenceIngestRequest,
  type EvidenceProvenanceKind,
  type ReceiptInboxAliasState,
  type ReceiptInboxStatusDto,
  type ReceiptInboxUpdateState,
  type GetCommitmentResponse,
  type GetCommitmentQuery,
  type GetHomeResponse,
  type HomeChangedDto,
  type HomeProjectionDto,
  type ListCommitmentsResponse,
  type PutDecisionRequest,
  type PutDecisionResponse,
  type RecoveryErrorCode,
  type RecoveryEndpointContracts,
  type RecoverySessionResponse,
  type RecoveryMutationHeaders,
  type ReverseCorrectionResponse,
  type SourceType,
  type SubmitEvidenceResponse,
} from "../src/lib/recovery/contracts";

const exhaustive = <T extends string>(values: readonly T[]) =>
  Object.fromEntries(values.map((value) => [value, value])) as unknown as Record<T, string>;

const decisionLabels = exhaustive(decisions) satisfies Record<Decision, string>;
const cadenceLabels = exhaustive(cadences) satisfies Record<Cadence, string>;
const sourceLabels = exhaustive(sourceTypes) satisfies Record<SourceType, string>;
const commitmentStatusLabels = exhaustive(commitmentStatuses) satisfies Record<CommitmentStatus, string>;
const confidenceLabels = exhaustive(confidenceStates) satisfies Record<ConfidenceState, string>;
const correctionFieldLabels = exhaustive(correctionFields) satisfies Record<CorrectionField, string>;
const correctionStatusLabels = exhaustive(correctionStatuses) satisfies Record<CorrectionStatus, string>;
const changeLabels = exhaustive(changeKinds) satisfies Record<ChangeKind, string>;
const attentionLabels = exhaustive(attentionReasons) satisfies Record<AttentionReason, string>;
const coverageLabels = exhaustive(coverageStates) satisfies Record<CoverageState, string>;
const provenanceLabels = exhaustive(evidenceProvenanceKinds) satisfies Record<EvidenceProvenanceKind, string>;
const receiptInboxAliasLabels = exhaustive(receiptInboxAliasStates) satisfies Record<ReceiptInboxAliasState, string>;
const receiptInboxUpdateLabels = exhaustive(receiptInboxUpdateStates) satisfies Record<ReceiptInboxUpdateState, string>;
const errorLabels = exhaustive(recoveryErrorCodes) satisfies Record<RecoveryErrorCode, string>;

const money = { currency: "INR", minor: "199900", exponent: 2, display: "₹1,999.00" } as const;
const confidence = { state: "MEDIUM", score: 72, scale: "PERCENT_0_100", reasons: ["One user-submitted receipt"] } as const;
const source = {
  id: "source-1",
  type: "RECEIPT_PASTE",
  label: "Pasted receipt",
  ingestedAt: "2026-08-09T10:00:00.000Z",
  coverageStart: "2026-07-06",
  coverageEnd: "2026-07-06",
} as const;
const evidence = {
  id: "evidence-1",
  source,
  immutable: true,
  observedAt: "2026-07-06T00:00:00.000Z",
  excerpt: "OpenAI invoice paid INR 1,999. Renews monthly.",
  excerptTruncated: false,
  amount: money,
  date: "2026-07-06",
  provenance: { kind: "USER_SUBMITTED", reference: "submission-1:1" },
  confidence,
} as const;
const commitment = {
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
} as const;

const baseline = {
  state: "NO_PRIOR_BASELINE",
  fromVersion: null,
  toVersion: 1,
  items: [],
} as const satisfies HomeChangedDto;

const home = {
  workspace: { id: "workspace-1", name: "Founder workspace", role: "owner", version: 1 },
  generatedAt: "2026-08-09T10:00:00.000Z",
  recentObservations: [{ evidenceId: evidence.id, merchant: commitment.merchant, amount: money, date: evidence.date }],
  monthlyTotals: [{ amount: money, commitmentIds: [commitment.id], evidenceIds: [evidence.id], provenance: "RECEIPT", correctionIds: [] }],
  annualizedEstimateTotals: [{
    amount: { currency: "INR", minor: "2398800", exponent: 2, display: "₹23,988.00" },
    commitmentIds: [commitment.id],
    evidenceIds: [evidence.id],
    provenance: "RECEIPT",
    correctionIds: [],
  }],
  next30DayTotals: [{ amount: money, commitmentIds: [commitment.id], evidenceIds: [evidence.id], provenance: "RECEIPT", correctionIds: [] }],
  needsMe: [{
    id: "attention-1",
    commitmentId: commitment.id,
    priority: "MEDIUM",
    reason: "LOW_CONFIDENCE",
    title: "Confirm OpenAI",
    detail: "Only one receipt supports this commitment.",
    amount: money,
    dueDate: "2026-08-06",
    evidenceIds: [evidence.id],
  }],
  changed: baseline,
  next: [{
    commitmentId: commitment.id,
    merchant: commitment.merchant,
    date: "2026-08-06",
    daysAway: 0,
    amount: money,
    decision: null,
    confidence,
    reminderEligible: true,
    evidenceIds: [evidence.id],
  }],
  coverage: {
    state: "BASELINE_ONLY",
    sourceCount: 1,
    evidenceCount: 1,
    lastEvidenceAt: "2026-07-06T00:00:00.000Z",
    coverageStart: "2026-07-06",
    coverageEnd: "2026-07-06",
    limitations: ["No prior persisted baseline exists."],
  },
  activeCommitmentCount: 1,
  unknownCadenceCommitmentCount: 0,
  reviewItemCount: 1,
  evidenceSources: [],
} as const satisfies HomeProjectionDto;

const detail = {
  ...commitment,
  recommendationReason: "Confirm with a second receipt.",
  riskTags: ["single occurrence"],
  evidence: { items: [evidence], total: 1, nextCursor: null },
  corrections: [],
} as const satisfies CommitmentDetailDto;

const compared = {
  state: "COMPARED",
  fromVersion: 1,
  toVersion: 2,
  items: [{
    id: "change-1",
    commitmentId: commitment.id,
    merchant: commitment.merchant,
    kind: "AMOUNT",
    before: money,
    after: { currency: "INR", minor: "209900", exponent: 2, display: "₹2,099.00" },
    detectedAt: "2026-08-09T10:05:00.000Z",
    provenance: { kind: "EVIDENCE", submissionId: "submission-2", evidenceIds: ["evidence-2"] },
  }],
} as const satisfies HomeChangedDto;

const correctionPatches = [
  { field: "MERCHANT", value: { merchant: "OpenAI" } },
  { field: "AMOUNT", value: { amountMinor: "199900" } },
  { field: "NEXT_EXPECTED_DATE", value: { date: "2026-08-06" } },
  { field: "CADENCE", value: { cadence: "MONTHLY" } },
  { field: "IS_RECURRING", value: { isRecurring: false } },
] as const satisfies readonly CorrectionPatch[];

const correctionHistory = [
  {
    id: "correction-active",
    commitmentId: commitment.id,
    patch: correctionPatches[0],
    authoritativeAmount: null,
    reason: "Merchant name on the invoice.",
    status: "ACTIVE",
    createdAt: "2026-08-09T10:00:00.000Z",
    reversedAt: null,
    supersededAt: null,
  },
  {
    id: "correction-reversed",
    commitmentId: commitment.id,
    patch: correctionPatches[3],
    authoritativeAmount: null,
    reason: "The invoice states monthly billing.",
    status: "REVERSED",
    createdAt: "2026-08-09T10:00:00.000Z",
    reversedAt: "2026-08-09T10:01:00.000Z",
    supersededAt: null,
  },
  {
    id: "correction-superseded",
    commitmentId: commitment.id,
    patch: correctionPatches[1],
    authoritativeAmount: money,
    reason: null,
    status: "SUPERSEDED",
    createdAt: "2026-08-09T10:00:00.000Z",
    reversedAt: null,
    supersededAt: "2026-08-09T10:02:00.000Z",
  },
] as const satisfies readonly CorrectionDto[];

const allChangeVariants = [
  { id: "added", commitmentId: commitment.id, merchant: "OpenAI", kind: "ADDED", before: null, after: { merchant: "OpenAI", amount: money, date: "2026-08-06", cadence: "MONTHLY" }, detectedAt: "2026-08-09T10:00:00.000Z", provenance: { kind: "EVIDENCE", submissionId: "submission-1", evidenceIds: [evidence.id] } },
  { id: "merchant", commitmentId: commitment.id, merchant: "OpenAI", kind: "MERCHANT", before: "Open AI", after: "OpenAI", detectedAt: "2026-08-09T10:00:00.000Z", provenance: { kind: "CORRECTION", correctionId: "correction-1", evidenceIds: [] } },
  { id: "amount", commitmentId: commitment.id, merchant: "OpenAI", kind: "AMOUNT", before: money, after: { currency: "INR", minor: "209900", exponent: 2, display: "₹2,099.00" }, detectedAt: "2026-08-09T10:00:00.000Z", provenance: { kind: "CORRECTION_REVERSAL", correctionId: "correction-1", evidenceIds: [] } },
  { id: "date", commitmentId: commitment.id, merchant: "OpenAI", kind: "DATE", before: "2026-08-06", after: "2026-08-07", detectedAt: "2026-08-09T10:00:00.000Z", provenance: { kind: "EVIDENCE", submissionId: "submission-1", evidenceIds: [evidence.id] } },
  { id: "cadence", commitmentId: commitment.id, merchant: "OpenAI", kind: "CADENCE", before: "MONTHLY", after: "YEARLY", detectedAt: "2026-08-09T10:00:00.000Z", provenance: { kind: "EVIDENCE", submissionId: "submission-1", evidenceIds: [evidence.id] } },
  { id: "classification", commitmentId: commitment.id, merchant: "OpenAI", kind: "RECURRING_CLASSIFICATION", before: "ACTIVE", after: "NOT_RECURRING", detectedAt: "2026-08-09T10:00:00.000Z", provenance: { kind: "EVIDENCE", submissionId: "submission-1", evidenceIds: [evidence.id] } },
] as const satisfies readonly ChangeItemDto[];

test("Recovery v1 freezes every product enum exhaustively", () => {
  assert.deepEqual(decisions, ["KEEP", "MONITOR", "DOWNGRADE", "CANCEL", "INVESTIGATE"]);
  assert.deepEqual(cadences, ["WEEKLY", "BIWEEKLY", "SEMIMONTHLY", "MONTHLY", "BIMONTHLY", "QUARTERLY", "YEARLY", "IRREGULAR"]);
  assert.deepEqual(sourceTypes, ["RECEIPT_PASTE", "CSV_IMPORT", "FORWARDED_EMAIL", "GMAIL_OAUTH"]);
  assert.deepEqual(commitmentStatuses, ["ACTIVE", "NOT_RECURRING"]);
  assert.deepEqual(confidenceStates, ["HIGH", "MEDIUM", "LOW", "UNKNOWN"]);
  assert.deepEqual(correctionFields, ["MERCHANT", "AMOUNT", "NEXT_EXPECTED_DATE", "CADENCE", "IS_RECURRING"]);
  assert.deepEqual(correctionStatuses, ["ACTIVE", "REVERSED", "SUPERSEDED"]);
  assert.deepEqual(changeKinds, ["ADDED", "MERCHANT", "AMOUNT", "DATE", "CADENCE", "RECURRING_CLASSIFICATION"]);
  assert.deepEqual(attentionReasons, ["DECISION_REQUIRED", "RENEWS_SOON", "LOW_CONFIDENCE", "PRICE_INCREASE", "EVIDENCE_CONFLICT"]);
  assert.deepEqual(coverageStates, ["NO_EVIDENCE", "BASELINE_ONLY", "PARTIAL", "CURRENT", "STALE"]);
  assert.deepEqual(evidenceProvenanceKinds, ["USER_SUBMITTED", "PROVIDER_RECEIVED"]);
  assert.deepEqual(receiptInboxAliasStates, ["ACTIVE", "ROTATED", "REVOKED"]);
  assert.deepEqual(receiptInboxUpdateStates, ["UNAVAILABLE", "NOT_PROVISIONED", "WAITING", "RECEIVED", "PROCESSING", "READY", "FAILED", "REVOKED"]);
  assert.deepEqual(recoveryErrorCodes, ["AUTH_REQUIRED", "FORBIDDEN", "NOT_FOUND", "INVALID_EVIDENCE", "PARSE_FAILED", "DUPLICATE_EVIDENCE", "DATABASE_UNAVAILABLE", "CONFLICT", "STALE_STATE", "SAVE_FAILED", "REQUEST_TOO_LARGE", "UNSUPPORTED_MEDIA_TYPE", "FEATURE_UNAVAILABLE", "RATE_LIMITED", "UNKNOWN"]);
  assert.equal(Object.keys(decisionLabels).length, decisions.length);
  assert.equal(Object.keys(cadenceLabels).length, cadences.length);
  assert.equal(Object.keys(sourceLabels).length, sourceTypes.length);
  assert.equal(Object.keys(commitmentStatusLabels).length, commitmentStatuses.length);
  assert.equal(Object.keys(confidenceLabels).length, confidenceStates.length);
  assert.equal(Object.keys(correctionFieldLabels).length, correctionFields.length);
  assert.equal(Object.keys(correctionStatusLabels).length, correctionStatuses.length);
  assert.equal(Object.keys(changeLabels).length, changeKinds.length);
  assert.equal(Object.keys(attentionLabels).length, attentionReasons.length);
  assert.equal(Object.keys(coverageLabels).length, coverageStates.length);
  assert.equal(Object.keys(provenanceLabels).length, evidenceProvenanceKinds.length);
  assert.equal(Object.keys(receiptInboxAliasLabels).length, receiptInboxAliasStates.length);
  assert.equal(Object.keys(receiptInboxUpdateLabels).length, receiptInboxUpdateStates.length);
  assert.equal(Object.keys(errorLabels).length, recoveryErrorCodes.length);
  assert.equal(correctionPatches.length, correctionFields.length);
  assert.equal(correctionHistory.length, correctionStatuses.length);
  assert.equal(allChangeVariants.length, changeKinds.length);
});

test("Recovery v1 freezes endpoint methods and paths without database vocabulary", () => {
  assert.deepEqual(recoveryEndpoints.guestAudit, { method: "POST", path: "/api/audit" });
  assert.deepEqual(recoveryEndpoints.prepareImport, { method: "POST", path: "/api/ingest" });
  assert.deepEqual(recoveryEndpoints.session, { method: "GET", path: "/api/auth/session" });
  assert.deepEqual(recoveryEndpoints.googleStart("/app"), { method: "GET", path: "/api/auth/google/start?mode=json&next=%2Fapp" });
  assert.deepEqual(recoveryEndpoints.logout, { method: "POST", path: "/api/auth/logout" });
  assert.deepEqual(recoveryEndpoints.submitEvidence, { method: "POST", path: "/api/workspaces/current/evidence" });
  assert.deepEqual(recoveryEndpoints.home, { method: "GET", path: "/api/workspaces/current/brief" });
  assert.deepEqual(recoveryEndpoints.recordWorkspaceActivation, { method: "POST", path: "/api/workspaces/current/activation" });
  assert.deepEqual(recoveryEndpoints.evidence("evidence 1"), { method: "GET", path: "/api/workspaces/current/evidence/evidence%201" });
  assert.deepEqual(recoveryEndpoints.commitments, { method: "GET", path: "/api/workspaces/current/commitments" });
  assert.deepEqual(recoveryEndpoints.commitment("commitment 1"), { method: "GET", path: "/api/workspaces/current/commitments/commitment%201" });
  assert.deepEqual(recoveryEndpoints.createCorrection("commitment 1"), { method: "POST", path: "/api/workspaces/current/commitments/commitment%201/corrections" });
  assert.deepEqual(recoveryEndpoints.reverseCorrection("commitment 1", "correction 1"), { method: "DELETE", path: "/api/workspaces/current/commitments/commitment%201/corrections/correction%201" });
  assert.deepEqual(recoveryEndpoints.decisions, { method: "GET", path: "/api/workspaces/current/decisions" });
  assert.deepEqual(recoveryEndpoints.decision, { method: "PUT", path: "/api/workspaces/current/decisions" });
  assert.deepEqual(recoveryEndpoints.sources, { method: "GET", path: "/api/workspaces/current/sources" });
  assert.deepEqual(recoveryEndpoints.receiptInbox, { method: "POST", path: "/api/workspaces/current/sources/receipt-inbox" });
  assert.deepEqual(recoveryEndpoints.rotateReceiptInbox, { method: "POST", path: "/api/workspaces/current/sources/receipt-inbox/rotate" });
  assert.deepEqual(recoveryEndpoints.revokeReceiptInbox, { method: "DELETE", path: "/api/workspaces/current/sources/receipt-inbox" });
  assert.deepEqual(recoveryEndpoints.standingMandate, { method: "GET", path: "/api/workspaces/current/standing-mandate" });
  assert.deepEqual(recoveryEndpoints.signStandingMandate, { method: "POST", path: "/api/workspaces/current/standing-mandate" });
  assert.deepEqual(recoveryEndpoints.revokeStandingMandate, { method: "DELETE", path: "/api/workspaces/current/standing-mandate" });
  assert.deepEqual(recoveryEndpoints.autopilotCandidates, { method: "GET", path: "/api/workspaces/current/autopilot/candidates" });
  assert.deepEqual(recoveryEndpoints.vetoAutopilotCandidate("candidate 1"), { method: "POST", path: "/api/workspaces/current/autopilot/candidates/candidate%201/veto" });
  assert.deepEqual(recoveryEndpoints.autopilotAttempts("candidate 1"), { method: "GET", path: "/api/workspaces/current/autopilot/candidates/candidate%201/attempts" });
  assert.deepEqual(recoveryEndpoints.disableAutopilotProvider("openai"), { method: "POST", path: "/api/workspaces/current/autopilot/providers/openai/disable" });
  assert.deepEqual(recoveryEndpoints.autopilotDeadLetters, { method: "GET", path: "/api/workspaces/current/autopilot/dead-letters" });
  assert.deepEqual(recoveryEndpoints.replayAutopilotDeadLetter("letter 1"), { method: "POST", path: "/api/workspaces/current/autopilot/dead-letters/letter%201/replay" });
  assert.deepEqual(recoveryEndpoints.disconnectRecoverySource("source 1"), { method: "POST", path: "/api/workspaces/current/autopilot/sources/source%201/disconnect" });
  assert.deepEqual(recoveryEndpoints.reconnectRecoverySource("source 1"), { method: "POST", path: "/api/workspaces/current/autopilot/sources/source%201/reconnect" });

  const sourceText = readFileSync(new URL("../src/lib/recovery/contracts.ts", import.meta.url), "utf8");
  assert.doesNotMatch(sourceText, /from ["'](?:pg|server-only|@\/lib\/server)/);
  assert.doesNotMatch(sourceText, /workspace_states|recurring_items|evidence_links|commitment_decisions|sql|\bexception\b|stack|cause/i);
  assert.doesNotMatch(sourceText, /\b(?:any|unknown)\b/);
});

test("Recovery v1 freezes bounded immutable evidence and typed endpoint payload ownership", () => {
  assert.deepEqual(recoveryLimits, {
    maxReceiptSnippets: 25,
    maxReceiptCharacters: 20_000,
    maxCsvSources: 6,
    maxCsvCharactersPerSource: 2_000_000,
    maxRequestBytes: 12 * 1024 * 1024,
    maxEvidenceExcerptCharacters: 500,
    maxCommitmentEvidencePageSize: 50,
    maxWorkspaceEvidenceRecords: 20_000,
  });
  assert.equal(evidence.immutable, true);
  assert.equal(evidence.excerpt.length <= recoveryLimits.maxEvidenceExcerptCharacters, true);
  assert.equal(detail.evidence.total, 1);
  assert.equal(detail.evidence.nextCursor, null);
  assert.deepEqual(Object.keys(recoveryEndpoints).filter((key) => /evidence/i.test(key)), ["submitEvidence", "evidence"]);

  const endpointWitness = {
    guestAudit: true,
    prepareImport: true,
    session: true,
    googleStart: true,
    logout: true,
    submitEvidence: true,
    home: true,
    recordWorkspaceActivation: true,
    evidence: true,
    commitments: true,
    commitment: true,
    createCorrection: true,
    reverseCorrection: true,
    decisions: true,
    decision: true,
    sources: true,
    receiptInbox: true,
    rotateReceiptInbox: true,
    revokeReceiptInbox: true,
    standingMandate: true,
    signStandingMandate: true,
    revokeStandingMandate: true,
    autopilotCandidates: true,
    vetoAutopilotCandidate: true,
    autopilotAttempts: true,
    disableAutopilotProvider: true,
    autopilotDeadLetters: true,
    replayAutopilotDeadLetter: true,
    disconnectRecoverySource: true,
    reconnectRecoverySource: true,
  } satisfies Record<keyof typeof recoveryEndpoints & keyof RecoveryEndpointContracts, true>;
  assert.deepEqual(Object.keys(endpointWitness), Object.keys(recoveryEndpoints));

  const mutationHeaders = {
    "Content-Type": "application/json",
    "Idempotency-Key": "recovery-request-0001",
    "If-Match": "\"workspace:1\"",
  } as const satisfies RecoveryMutationHeaders;
  assert.equal(mutationHeaders["If-Match"], "\"workspace:1\"");

  const evidencePageQuery = { evidenceLimit: 50, evidenceCursor: "evidence-cursor-2" } satisfies GetCommitmentQuery;
  const typedEvidencePageQuery: RecoveryEndpointContracts["commitment"]["request"] = evidencePageQuery;
  assert.deepEqual(typedEvidencePageQuery, evidencePageQuery);
  assert.equal(recoveryLimits.maxCommitmentEvidencePageSize, evidencePageQuery.evidenceLimit);
});

test("first ingestion is an honest baseline and all payloads round-trip as product DTOs", () => {
  assert.equal(home.changed.state, "NO_PRIOR_BASELINE");
  assert.equal(home.changed.fromVersion, null);
  assert.deepEqual(home.changed.items, []);
  assert.equal(compared.state, "COMPARED");
  assert.equal(compared.items[0].merchant, "OpenAI");
  assert.deepEqual(compared.items[0].before, money);
  assert.equal(home.monthlyTotals[0].evidenceIds[0], evidence.id);

  const receiptRequest = {
    kind: "RECEIPT_PASTE",
    receipts: [{ clientRef: "receipt-1", text: evidence.excerpt }],
  } as const satisfies EvidenceIngestRequest;
  const csvRequest = {
    kind: "CSV_IMPORT",
    sources: [{ clientRef: "csv-1", name: "statement.csv", text: "Date,Description,Debit" }],
  } as const satisfies EvidenceIngestRequest;
  const submitResponse = {
    data: {
      submission: {
        id: "submission-1",
        type: "RECEIPT_PASTE",
        ingestedAt: "2026-08-09T10:00:00.000Z",
        acceptedEvidenceCount: 1,
        results: [
          { clientRef: "receipt-1", status: "ACCEPTED", code: null, message: null },
          { clientRef: "receipt-2", status: "REJECTED", code: "PARSE_FAILED", message: "No recurring receipt could be established." },
        ],
      },
      home,
      commitments: [commitment],
      commitmentTotal: 1,
    },
    meta: { requestId: "request-1", workspaceVersion: 1 },
  } as const satisfies SubmitEvidenceResponse;
  const homeResponse = { data: home, meta: { requestId: "request-2", workspaceVersion: 1 } } as const satisfies GetHomeResponse;
  const listResponse = { data: { items: [commitment], total: 1, nextCursor: null }, meta: { requestId: "request-3", workspaceVersion: 1 } } as const satisfies ListCommitmentsResponse;
  const detailResponse = { data: detail, meta: { requestId: "request-4", workspaceVersion: 1 } } as const satisfies GetCommitmentResponse;
  const decisionRequest = { commitmentId: commitment.id, decision: "MONITOR" } as const satisfies PutDecisionRequest;
  const decisionResponse = {
    data: {
      decision: { value: "MONITOR", decidedAt: "2026-08-09T10:00:00.000Z", updatedAt: "2026-08-09T10:00:00.000Z" },
      commitment,
      home,
    },
    meta: { requestId: "request-5", workspaceVersion: 2 },
  } as const satisfies PutDecisionResponse;
  const reverseResponse = {
    data: {
      correction: {
        id: "correction-1",
        commitmentId: commitment.id,
        patch: correctionPatches[3],
        authoritativeAmount: null,
        reason: "The invoice states monthly billing.",
        status: "REVERSED",
        createdAt: "2026-08-09T10:00:00.000Z",
        reversedAt: "2026-08-09T10:01:00.000Z",
        supersededAt: null,
      },
      commitment: detail,
      home,
    },
    meta: { requestId: "request-6", workspaceVersion: 3 },
  } as const satisfies ReverseCorrectionResponse;
  const session = {
    authenticated: true,
    configuration: { status: "ready", cookieName: "vognary_session" },
    session: {
      userId: "user-1",
      email: "founder@example.com",
      workspaceId: "workspace-1",
      expiresAt: "2026-08-16T10:00:00.000Z",
    },
  } as const satisfies RecoverySessionResponse;
  const signedOutSession = {
    authenticated: false,
    configuration: { status: "not-configured", cookieName: "vognary_session" },
    session: null,
  } as const satisfies RecoverySessionResponse;
  const receiptInbox = {
    state: "WAITING",
    alias: {
      id: "11111111-1111-4111-8111-111111111111",
      status: "ACTIVE",
      address: "rcpt_example@receipts.vognary.com",
      createdAt: "2026-08-10T10:00:00.000Z",
      rotatedAt: null,
      revokedAt: null,
    },
    lastReceivedAt: null,
    lastProcessedAt: null,
    lastFailureCode: null,
  } as const satisfies ReceiptInboxStatusDto;

  for (const payload of [receiptRequest, csvRequest, submitResponse, homeResponse, listResponse, detailResponse, decisionRequest, decisionResponse, reverseResponse, session, signedOutSession, receiptInbox, correctionHistory, allChangeVariants]) {
    assert.deepEqual(JSON.parse(JSON.stringify(payload)), payload);
  }
});

test("frontend-safe errors have exhaustive primary HTTP statuses and no raw exception shape", () => {
  assert.deepEqual(recoveryErrorStatusByCode, {
    AUTH_REQUIRED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    INVALID_EVIDENCE: 400,
    PARSE_FAILED: 422,
    DUPLICATE_EVIDENCE: 409,
    DATABASE_UNAVAILABLE: 503,
    CONFLICT: 409,
    STALE_STATE: 412,
    SAVE_FAILED: 502,
    REQUEST_TOO_LARGE: 413,
    UNSUPPORTED_MEDIA_TYPE: 415,
    FEATURE_UNAVAILABLE: 503,
    RATE_LIMITED: 429,
    UNKNOWN: 500,
  } satisfies Record<RecoveryErrorCode, number>);

  const failure = {
    error: {
      code: "STALE_STATE",
      message: "Workspace state changed. Reload before retrying.",
      retryable: true,
      requestId: "request-stale",
      currentVersion: 4,
    },
  } as const satisfies ApiFailure;
  assert.deepEqual(Object.keys(failure.error).sort(), ["code", "currentVersion", "message", "requestId", "retryable"]);

  const rateLimited = {
    error: {
      code: "RATE_LIMITED",
      message: "Too many requests. Retry later.",
      retryable: true,
      requestId: "request-rate-limited",
      retryAfterSeconds: 60,
    },
  } as const satisfies ApiFailure;
  assert.equal(rateLimited.error.retryAfterSeconds, 60);
});
