import type { ControlDecisionDto, ControlProposalDto, ControlReconciliationWriteDto } from "@/lib/commitment-control/contracts";
import {
  controlProviderBillRetentionNotice,
  normalizeControlProviderBillRequest,
  type ControlProviderBillCandidateDto,
  type ControlProviderBillCandidatesDto,
  type ControlProviderBillFreshnessDto,
  type ControlProviderBillSourceStateDto,
  type ReconcileControlProviderBillRequest,
} from "@/lib/commitment-control/provider-bill-contracts";
import { isCalendarDate } from "./control-format";

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, maximum = 240): value is string => typeof value === "string" && value.length > 0 && value.length <= maximum;
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const sequence = (value: unknown): value is string => typeof value === "string" && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= BigInt("9223372036854775807");
const nonnegative = (value: unknown): value is string => value === "0" || sequence(value);
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const providerId = (value: unknown): value is string => typeof value === "string" && /^\d{1,64}$/.test(value);
const timestamp = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 100 && value.every(item => text(item));
const nullable = <Value,>(value: unknown, guard: (input: unknown) => input is Value): value is Value | null => value === null || guard(value);
const verdicts = ["MATCHED", "WITHIN_CAP", "OVER_CAP", "CURRENCY_MISMATCH", "AUTHORIZATION_EXPIRED"];
const sorts = ["UPDATED", "SUPPLIER", "DATE", "AMOUNT_ASC", "AMOUNT_DESC"];
const currency = (value: unknown): value is string => typeof value === "string" && /^[A-Z]{3}$/.test(value);

function isProviderBillReviewPath(value: unknown, billId?: string): value is string {
  if (typeof value !== "string" || !value.startsWith("/app?")) return false;
  const url = new URL(value, "http://localhost");
  return url.pathname === "/app" && url.searchParams.get("view") === "BILL_REVIEW"
    && providerId(url.searchParams.get("bill")) && (!billId || url.searchParams.get("bill") === billId);
}

function isProviderBillFreshness(value: unknown): value is ControlProviderBillFreshnessDto {
  return record(value) && ["FRESH", "STALE", "UNAVAILABLE"].includes(String(value.status))
    && value.maximumAgeSeconds === 86400 && nullable(value.lastCompletedSyncAt, timestamp)
    && nullable(value.nextScheduledAt, timestamp) && timestamp(value.checkedAt)
    && (value.status !== "FRESH" || (timestamp(value.lastCompletedSyncAt) && value.lastCompletedSyncAt <= value.checkedAt));
}

function isProviderBillCandidate(value: unknown): value is ControlProviderBillCandidateDto {
  if (!record(value) || value.source !== "ZOHO_BOOKS" || value.region !== "IN" || value.evidenceBasis !== "PROVIDER_BILL_TOTAL"
    || !uuid(value.connectionId) || !providerId(value.organizationId) || !providerId(value.billId)
    || !sequence(value.sourceSequence) || value.sourceVersion !== 1 || !sequence(value.expectedSourceVersion) || !sequence(value.expectedLatestSequence)
    || typeof value.sourceFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.sourceFingerprint)
    || !timestamp(value.sourceObservedAt) || !timestamp(value.providerModifiedAt) || typeof value.billDate !== "string" || !isCalendarDate(value.billDate)
    || !text(value.vendorName) || !text(value.billNumber) || !text(value.billStatus) || !text(value.changeKind)
    || !nonnegative(value.totalMinor) || !currency(value.currency) || !isProviderBillReviewPath(value.billReviewPath, value.billId)
    || !nullable(value.consentReference, uuid) || !nullable(value.consentGeneration, sequence)
    || !nullable(value.consentAuthorizedByUserId, uuid) || !nullable(value.consentAuthorizedAt, timestamp)
    || !nullable(value.consentNoticeVersion, text) || !nullable(value.consentScopes, strings)
    || typeof value.canSelect !== "boolean" || typeof value.alreadyCompared !== "boolean" || !strings(value.selectionReasons)
    || !(value.prospectiveVerdict === null || verdicts.includes(String(value.prospectiveVerdict)))) return false;
  return !value.canSelect || (value.prospectiveVerdict !== null && !value.alreadyCompared && value.selectionReasons.length === 0
    && value.sourceSequence === value.expectedLatestSequence && uuid(value.consentReference) && sequence(value.consentGeneration)
    && timestamp(value.consentAuthorizedAt) && value.consentAuthorizedAt <= value.sourceObservedAt
    && value.consentNoticeVersion === "zoho-books-read-v1" && value.consentScopes?.join("|") === "ZohoBooks.settings.READ|ZohoBooks.bills.READ"
    && ["open", "approved", "overdue", "partially_paid", "paid"].includes(String(value.billStatus))
    && ["BASELINE", "NEW", "AMENDED"].includes(String(value.changeKind)));
}

export function isProviderBillCandidatePage(value: unknown): value is ControlProviderBillCandidatesDto {
  if (!record(value) || value.source !== "ZOHO_BOOKS" || !uuid(value.proposalId) || value.matchingPerformed !== false
    || !nullable(value.connectionId, uuid) || !nullable(value.organizationId, providerId) || !nullable(value.expectedSourceVersion, sequence)
    || typeof value.canManage !== "boolean" || typeof value.canConfirm !== "boolean" || !strings(value.capabilityReasons)
    || !isProviderBillFreshness(value.freshness) || value.retentionNotice !== controlProviderBillRetentionNotice || !count(value.retainedAdmissionCount)
    || !count(value.total) || !nullable(value.nextCursor, input => text(input, 8192))
    || !nonnegative(value.throughSequence) || !nonnegative(value.throughEventSequence)
    || !record(value.query) || typeof value.query.search !== "string" || value.query.search.length > 240
    || !sorts.includes(String(value.query.sort)) || !nullable(value.query.currency, currency)
    || !Array.isArray(value.candidates) || value.candidates.length > 50 || value.candidates.length > value.total
    || !value.candidates.every(isProviderBillCandidate)) return false;
  const candidates = value.candidates as ControlProviderBillCandidateDto[];
  const selectable = value.canConfirm && value.canManage && value.capabilityReasons.length === 0 && value.freshness.status === "FRESH";
  return new Set(candidates.map(item => `${item.billId}:${item.sourceSequence}`)).size === candidates.length
    && candidates.every(item => item.connectionId === value.connectionId && item.organizationId === value.organizationId
      && item.expectedSourceVersion === value.expectedSourceVersion && BigInt(item.sourceSequence) <= BigInt(String(value.throughSequence))
      && (!item.canSelect || selectable));
}

export function isProviderBillSourceState(value: unknown): value is ControlProviderBillSourceStateDto {
  if (!record(value) || !["ERASED", "CONSENT_WITHDRAWN", "CONSENT_CHANGED", "ABSENCE_UNCONFIRMED", "REMOVED", "VOIDED", "UNAVAILABLE", "STALE", "AMENDED", "CURRENT"].includes(String(value.condition))
    || !nullable(value.latestSequence, sequence) || !nullable(value.currentStatus, text)
    || !(value.currentReviewRelevance === null || ["BASELINE", "INFORMATIONAL", "MATERIAL"].includes(String(value.currentReviewRelevance)))
    || !isProviderBillFreshness(value.freshness) || !count(value.pendingMaterialNewerCount) || !count(value.pendingMaterialOlderCount) || !count(value.openFollowUpCount)
    || !Array.isArray(value.pendingMaterialNewerSequences) || !value.pendingMaterialNewerSequences.every(sequence)
    || !Array.isArray(value.pendingMaterialOlderSequences) || !value.pendingMaterialOlderSequences.every(sequence)
    || value.pendingMaterialNewerSequences.length > value.pendingMaterialNewerCount || value.pendingMaterialOlderSequences.length > value.pendingMaterialOlderCount
    || !nullable(value.billReviewPath, isProviderBillReviewPath)) return false;
  return value.condition !== "ERASED" || value.billReviewPath === null;
}

export type ProviderBillAttempt = {
  version: 1;
  workspaceId: string;
  actorId: string;
  proposalId: string;
  decisionId: string;
  workspaceVersion: number;
  idempotencyKey: string;
  request: ReconcileControlProviderBillRequest;
  snapshot: ControlProviderBillCandidateDto;
};

export function providerBillRequest(candidate: ControlProviderBillCandidateDto, wholeCharge: boolean, retainAdmitted: boolean): ReconcileControlProviderBillRequest | null {
  if (!wholeCharge || !retainAdmitted || !candidate.canSelect || !isProviderBillCandidate(candidate)) return null;
  return {
    source: "ZOHO_BOOKS", connectionId: candidate.connectionId, organizationId: candidate.organizationId, billId: candidate.billId,
    sourceSequence: candidate.sourceSequence, expectedLatestSequence: candidate.expectedLatestSequence, expectedSourceVersion: candidate.expectedSourceVersion,
    wholeCharge: "USER_CONFIRMED_SAME_CHARGE", retentionNotice: controlProviderBillRetentionNotice,
  };
}

export function providerBillAttemptKey(workspaceId: string, actorId: string, proposalId: string) {
  return `vognary.control-provider-bill.${workspaceId}.${actorId}.${proposalId}`;
}

export function restoreProviderBillAttempt(raw: string | null, identity: { workspaceId: string; actorId: string; proposalId: string; decisionId: string }): ProviderBillAttempt | null {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!record(value) || value.version !== 1 || !uuid(value.workspaceId) || !uuid(value.actorId) || !uuid(value.proposalId) || !uuid(value.decisionId)
      || !count(value.workspaceVersion) || !uuid(value.idempotencyKey) || !isProviderBillCandidate(value.snapshot)
      || !Object.entries(identity).every(([key, expected]) => value[key] === expected)) return null;
    const normalized = normalizeControlProviderBillRequest(value.request);
    const expected = providerBillRequest(value.snapshot, true, true);
    if (!expected || !Object.entries(expected).every(([key, entry]) => normalized[key as keyof ReconcileControlProviderBillRequest] === entry)) return null;
    return { ...value, request: normalized } as ProviderBillAttempt;
  } catch { return null; }
}

export function providerBillResultMatches(data: ControlReconciliationWriteDto, attempt: ProviderBillAttempt): boolean {
  const { reconciliation, proposal, decision } = data;
  const bill = reconciliation.providerBill;
  return proposal.id === attempt.proposalId && decision.id === attempt.decisionId && reconciliation.comparisonKind === "BILLED_AMOUNT_COMPARISON"
    && reconciliation.reconciledByUserId === attempt.actorId && bill !== undefined && bill.workspaceId === attempt.workspaceId
    && bill.selectedByUserId === attempt.actorId && bill.selectedAt === reconciliation.reconciledAt
    && bill.connectionId === attempt.request.connectionId && bill.organizationId === attempt.request.organizationId
    && bill.billId === attempt.request.billId && bill.sourceSequence === attempt.request.sourceSequence
    && bill.connectionRevision === attempt.request.expectedSourceVersion
    && (["sourceFingerprint", "sourceVersion", "sourceObservedAt", "providerModifiedAt", "billDate", "billStatus", "changeKind", "totalMinor", "currency", "vendorName", "billNumber", "consentReference", "consentGeneration", "consentAuthorizedByUserId", "consentAuthorizedAt", "consentNoticeVersion"] as const)
      .every(key => bill[key] === attempt.snapshot[key]);
}

export function supportsProviderBill(proposal: ControlProposalDto, decision: ControlDecisionDto) {
  return proposal.amountBasis === "GROSS_BILLED_TOTAL_PER_CHARGE" && decision.amountBasis === "GROSS_BILLED_TOTAL_PER_CHARGE" && decision.action !== "DECLINE";
}
