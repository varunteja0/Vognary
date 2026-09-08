import { parsePositiveMinorUnits, requireUuid } from "./money";
import { rejectUnknownControlFields, requireControlRecord } from "./validation";
import type { ZohoBooksSort, ZohoBooksState } from "@/lib/zoho-books/contracts";
import { decimalToMinorUnits } from "@/lib/recovery/domain";
import { normalizeControlDateOnly } from "./outcome";
import { normalizeCurrency } from "./money";

export const controlProviderBillRetentionNotice = "control-provider-bill-retention-v1" as const;
export const controlProviderBillSourceMaxAgeMs = 86_400_000;

export type ZohoBooksAdmissionStateDto = ZohoBooksState & {
  retainedAdmissionCount: number;
  retentionNotice: typeof controlProviderBillRetentionNotice;
};
export type ProviderBillSourceErasureAcknowledgement = {
  noticeVersion: typeof controlProviderBillRetentionNotice;
  retainAdmitted: true;
  retainedAdmissionCount: number;
};

export function assertProviderBillErasureAcknowledgement(value: unknown, retainedAdmissionCount: number) {
  if (retainedAdmissionCount === 0 && value === undefined) return;
  const record = requireControlRecord(value, "Retained admission acknowledgement");
  rejectUnknownControlFields(record, ["noticeVersion", "retainAdmitted", "retainedAdmissionCount"], "retained admission acknowledgement");
  if (record.noticeVersion !== controlProviderBillRetentionNotice || record.retainAdmitted !== true
    || record.retainedAdmissionCount !== retainedAdmissionCount) {
    throw new Error("Acknowledge the current retention notice and exact retained admission count before source erasure.");
  }
}

export type ControlProviderBillProvenanceDto = {
  source: "ZOHO_BOOKS";
  workspaceId: string;
  evidenceId: string;
  connectionId: string;
  organizationId: string;
  billId: string;
  sourceSequence: string;
  sourceVersion: 1;
  sourceFingerprint: string;
  sourceObservedAt: string;
  providerModifiedAt: string;
  billDate: string;
  billStatus: string;
  changeKind: string;
  totalMinor: string;
  currency: string;
  sourceTotal: string;
  vendorName: string;
  billNumber: string;
  consentReference: string;
  consentGeneration: string;
  consentNoticeVersion: "zoho-books-read-v1";
  consentScopes: string[];
  consentAuthorizedByUserId: string | null;
  consentAuthorizedAt: string;
  region: "IN";
  connectionRevision: string;
  lastSuccessfulSyncAt: string;
  selectedByUserId: string | null;
  selectedAt: string;
  relationBasis: "USER_CONFIRMED_SAME_CHARGE";
  retentionNotice: typeof controlProviderBillRetentionNotice;
};

export function isControlProviderBillProvenanceDto(value: unknown): value is ControlProviderBillProvenanceDto {
  try {
    const record = requireControlRecord(value, "Provider bill provenance");
    if (record.source !== "ZOHO_BOOKS" || record.sourceVersion !== 1 || record.region !== "IN"
      || record.relationBasis !== "USER_CONFIRMED_SAME_CHARGE" || record.retentionNotice !== controlProviderBillRetentionNotice
      || record.consentNoticeVersion !== "zoho-books-read-v1"
      || !Array.isArray(record.consentScopes) || record.consentScopes.join("|") !== "ZohoBooks.settings.READ|ZohoBooks.bills.READ"
      || !["open", "approved", "overdue", "partially_paid", "paid"].includes(String(record.billStatus))
      || !["BASELINE", "NEW", "AMENDED"].includes(String(record.changeKind))
      || typeof record.sourceFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(record.sourceFingerprint)) return false;
    for (const key of ["workspaceId", "evidenceId", "connectionId", "consentReference"] as const) requireUuid(record[key], key);
    for (const key of ["consentAuthorizedByUserId", "selectedByUserId"] as const) if (record[key] !== null) requireUuid(record[key], key);
    for (const key of ["organizationId", "billId"] as const) if (typeof record[key] !== "string" || !/^\d{1,64}$/.test(record[key])) return false;
    for (const key of ["sourceSequence", "consentGeneration", "connectionRevision", "totalMinor"] as const) {
      if (parsePositiveMinorUnits(record[key], key).toString() !== record[key]) return false;
    }
    for (const key of ["sourceObservedAt", "providerModifiedAt", "consentAuthorizedAt", "lastSuccessfulSyncAt", "selectedAt"] as const) {
      if (typeof record[key] !== "string" || !Number.isFinite(Date.parse(record[key])) || new Date(record[key]).toISOString() !== record[key]) return false;
    }
    for (const key of ["vendorName", "billNumber"] as const) if (typeof record[key] !== "string" || !record[key].trim() || record[key].length > 240) return false;
    if (normalizeControlDateOnly(record.billDate as string, "Bill date") !== record.billDate
      || normalizeCurrency(record.currency) !== record.currency || typeof record.sourceTotal !== "string" || record.sourceTotal.length > 64
      || decimalToMinorUnits(record.sourceTotal, record.currency as string) !== record.totalMinor) return false;
    return String(record.consentAuthorizedAt) <= String(record.sourceObservedAt)
      && String(record.sourceObservedAt) <= String(record.lastSuccessfulSyncAt)
      && String(record.lastSuccessfulSyncAt) <= String(record.selectedAt)
      && String(record.providerModifiedAt) <= String(record.selectedAt);
  } catch { return false; }
}

export type ControlProviderBillCandidateQuery = { cursor?: string; search?: string; sort?: ZohoBooksSort; currency?: string };
export type ControlProviderBillFreshnessDto = {
  status: "FRESH" | "STALE" | "UNAVAILABLE";
  maximumAgeSeconds: 86400;
  lastCompletedSyncAt: string | null;
  nextScheduledAt: string | null;
  checkedAt: string;
};
export type ControlProviderBillCandidateDto = {
  source: "ZOHO_BOOKS";
  connectionId: string;
  organizationId: string;
  billId: string;
  sourceSequence: string;
  sourceVersion: 1;
  sourceFingerprint: string;
  sourceObservedAt: string;
  providerModifiedAt: string;
  billDate: string;
  billStatus: string;
  changeKind: string;
  vendorName: string;
  billNumber: string;
  totalMinor: string;
  currency: string;
  evidenceBasis: "PROVIDER_BILL_TOTAL";
  consentReference: string | null;
  consentGeneration: string | null;
  consentScopes: string[] | null;
  consentAuthorizedByUserId: string | null;
  consentAuthorizedAt: string | null;
  consentNoticeVersion: string | null;
  region: "IN";
  expectedSourceVersion: string;
  expectedLatestSequence: string;
  canSelect: boolean;
  selectionReasons: string[];
  alreadyCompared: boolean;
  prospectiveVerdict: "MATCHED" | "WITHIN_CAP" | "OVER_CAP" | "CURRENCY_MISMATCH" | "AUTHORIZATION_EXPIRED" | null;
  billReviewPath: string;
};
export type ControlProviderBillCandidatesDto = {
  source: "ZOHO_BOOKS";
  proposalId: string;
  matchingPerformed: false;
  connectionId: string | null;
  organizationId: string | null;
  expectedSourceVersion: string | null;
  canManage: boolean;
  canConfirm: boolean;
  capabilityReasons: string[];
  freshness: ControlProviderBillFreshnessDto;
  retentionNotice: typeof controlProviderBillRetentionNotice;
  retainedAdmissionCount: number;
  candidates: ControlProviderBillCandidateDto[];
  total: number;
  nextCursor: string | null;
  throughSequence: string;
  throughEventSequence: string;
  query: { search: string; sort: ZohoBooksSort; currency: string | null };
};
export type ControlProviderBillSourceStateDto = {
  condition: "ERASED" | "CONSENT_WITHDRAWN" | "CONSENT_CHANGED" | "ABSENCE_UNCONFIRMED" | "REMOVED" | "VOIDED" | "UNAVAILABLE" | "STALE" | "AMENDED" | "CURRENT";
  latestSequence: string | null;
  currentStatus: string | null;
  currentReviewRelevance: "BASELINE" | "INFORMATIONAL" | "MATERIAL" | null;
  freshness: ControlProviderBillFreshnessDto;
  pendingMaterialNewerCount: number;
  pendingMaterialNewerSequences: string[];
  pendingMaterialOlderCount: number;
  pendingMaterialOlderSequences: string[];
  openFollowUpCount: number;
  billReviewPath: string | null;
};

export type ReconcileControlProviderBillRequest = {
  source: "ZOHO_BOOKS";
  connectionId: string;
  organizationId: string;
  billId: string;
  sourceSequence: string;
  expectedLatestSequence: string;
  expectedSourceVersion: string;
  wholeCharge: "USER_CONFIRMED_SAME_CHARGE";
  retentionNotice: typeof controlProviderBillRetentionNotice;
  evidenceId?: never;
  observedOutcome?: never;
};

export function normalizeControlProviderBillRequest(value: unknown): ReconcileControlProviderBillRequest {
  const record = requireControlRecord(value, "Provider bill reconciliation");
  rejectUnknownControlFields(record, ["source", "connectionId", "organizationId", "billId", "sourceSequence", "expectedLatestSequence", "expectedSourceVersion", "wholeCharge", "retentionNotice"], "provider bill reconciliation");
  if (record.source !== "ZOHO_BOOKS") throw new Error("Select a supported reconciliation source.");
  if (record.wholeCharge !== "USER_CONFIRMED_SAME_CHARGE") throw new Error("Explicitly confirm the whole bill corresponds to this authorized charge.");
  if (record.retentionNotice !== controlProviderBillRetentionNotice) throw new Error("Acknowledge the current admitted-bill retention notice.");
  for (const field of ["organizationId", "billId"] as const) {
    if (typeof record[field] !== "string" || !/^\d{1,64}$/.test(record[field])) throw new Error(`Provider ${field} is invalid.`);
  }
  return {
    source: "ZOHO_BOOKS",
    connectionId: requireUuid(record.connectionId, "Source connection id"),
    organizationId: record.organizationId as string,
    billId: record.billId as string,
    sourceSequence: parsePositiveMinorUnits(record.sourceSequence, "Source sequence").toString(),
    expectedLatestSequence: parsePositiveMinorUnits(record.expectedLatestSequence, "Latest source sequence").toString(),
    expectedSourceVersion: parsePositiveMinorUnits(record.expectedSourceVersion, "Source version").toString(),
    wholeCharge: "USER_CONFIRMED_SAME_CHARGE",
    retentionNotice: controlProviderBillRetentionNotice,
  };
}
