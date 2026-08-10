import type { ManualRecurringInput, RecommendationType } from "./recurring-audit";
import { parseIsoDateOnly } from "./date-only";
import { recoveryLimits, type EvidenceIngestRequest } from "./recovery/contracts";

const transferFrequencies = new Set(["weekly", "biweekly", "semimonthly", "monthly", "bimonthly", "quarterly", "yearly", "irregular"]);

export const guestAuditTransferKey = "vognary.guest-audit-transfer.v1";
export const guestAuditTransferBindingKey = "vognary.guest-audit-transfer-binding.v1";
export const guestAuditTransferTtlMs = 2 * 60 * 60 * 1_000;
export const guestAuditTransferMaxBytes = 4 * 1024 * 1024;

const guestAuditTransferMaxStatementSources = 10;
const guestAuditTransferMaxManualItems = 200;
const guestAuditTransferClockSkewMs = 5 * 60 * 1_000;

export type TransferStatementSource = {
  id: string;
  name: string;
  text: string;
  rowCount: number;
  kind?: "csv" | "pdf" | "spreadsheet";
  warnings?: string[];
};

export type GuestAuditSnapshot = {
  version: 1;
  exportedAt: string;
  statementSources: TransferStatementSource[];
  manualItems: ManualRecurringInput[];
  userActions: Record<string, RecommendationType>;
  itemOwners: Record<string, string>;
  reviewNotes: Record<string, string>;
  teamMembers: Array<{ id: string; name: string; role: string }>;
  receiptText: string;
  actionsMeta: Record<string, never>;
  mergeDecisions: Record<string, never>;
  lastReview: null;
  reviewCompletedAt: null;
};

export type GuestRecoveryEvidenceTransfer = {
  requests: EvidenceIngestRequest[];
  unsupportedSourceNames: string[];
  unsupportedManualItemCount: number;
};

type GuestAuditTransferBinding = {
  version: 1;
  exportedAt: string;
  userId: string;
  workspaceId: string;
};

export type GuestRecoveryEvidenceSubmitResult =
  | {
      ok: true;
      workspaceVersion: number;
      acceptedEvidenceCount: number;
      results: readonly { status: "ACCEPTED" | "REJECTED" }[];
    }
  | { ok: false };

export type GuestRecoveryEvidencePersistenceResult =
  | {
      ok: true;
      workspaceVersion: number;
      completedRequests: number;
      acceptedEvidenceCount: number;
      unsupportedSourceNames: string[];
      unsupportedManualItemCount: number;
    }
  | {
      ok: false;
      reason: "INVALID_TRANSFER" | "NO_SUPPORTED_EVIDENCE" | "SUBMISSION_FAILED" | "PERSISTENCE_UNCONFIRMED";
      workspaceVersion: number;
      completedRequests: number;
    };

export function buildGuestAuditSnapshot(input: {
  receiptText: string;
  statementSources: TransferStatementSource[];
  manualItems: ManualRecurringInput[];
}, exportedAt: Date = new Date()): GuestAuditSnapshot {
  return {
    version: 1,
    exportedAt: exportedAt.toISOString(),
    statementSources: input.statementSources,
    manualItems: input.manualItems,
    userActions: {},
    itemOwners: {},
    reviewNotes: {},
    teamMembers: [{ id: "founder", name: "Founder", role: "Owner" }],
    receiptText: input.receiptText,
    actionsMeta: {},
    mergeDecisions: {},
    lastReview: null,
    reviewCompletedAt: null,
  };
}

export function buildGuestAuditTransferBinding(
  snapshot: GuestAuditSnapshot,
  session: { userId: string; workspaceId: string },
) {
  return JSON.stringify({
    version: 1,
    exportedAt: snapshot.exportedAt,
    userId: session.userId,
    workspaceId: session.workspaceId,
  } satisfies GuestAuditTransferBinding);
}

export function parseGuestAuditTransferBinding(raw: string | null, snapshot: GuestAuditSnapshot) {
  if (!raw || raw.length > 1_024) return null;
  try {
    const value = JSON.parse(raw) as Partial<GuestAuditTransferBinding>;
    if (value.version !== 1 || value.exportedAt !== snapshot.exportedAt) return null;
    if (typeof value.userId !== "string" || !value.userId || typeof value.workspaceId !== "string" || !value.workspaceId) return null;
    return { userId: value.userId, workspaceId: value.workspaceId };
  } catch {
    return null;
  }
}

export function parseGuestAuditSnapshot(raw: string | null, now: Date = new Date()): GuestAuditSnapshot | null {
  if (!raw) return null;
  if (raw.length > guestAuditTransferMaxBytes || utf8Length(raw) > guestAuditTransferMaxBytes) return null;
  try {
    const value = JSON.parse(raw) as Partial<GuestAuditSnapshot>;
    if (value.version !== 1 || !Array.isArray(value.statementSources) || !Array.isArray(value.manualItems)) return null;
    if (typeof value.receiptText !== "string" || typeof value.exportedAt !== "string") return null;
    if (value.statementSources.length > guestAuditTransferMaxStatementSources || value.manualItems.length > guestAuditTransferMaxManualItems) return null;
    if (!value.statementSources.every(isStatementSource) || !value.manualItems.every(isManualItem)) return null;

    const exportedAt = new Date(value.exportedAt);
    const ageMs = now.getTime() - exportedAt.getTime();
    if (!Number.isFinite(ageMs) || ageMs < -guestAuditTransferClockSkewMs || ageMs > guestAuditTransferTtlMs) return null;

    return buildGuestAuditSnapshot({
      receiptText: value.receiptText,
      statementSources: value.statementSources,
      manualItems: value.manualItems,
    }, exportedAt);
  } catch {
    return null;
  }
}

export function mergeGuestAuditSnapshot(base: GuestAuditSnapshot, guest: GuestAuditSnapshot): GuestAuditSnapshot {
  const statementSources = [...base.statementSources];
  for (const source of guest.statementSources) {
    if (!statementSources.some((candidate) => candidate.text === source.text)) statementSources.push(source);
  }

  const manualItems = [...base.manualItems];
  for (const item of guest.manualItems) {
    if (!manualItems.some((candidate) => candidate.id === item.id)) manualItems.push(item);
  }

  const snippets = [...splitSnippets(base.receiptText), ...splitSnippets(guest.receiptText)];
  const receiptText = [...new Set(snippets)].join("\n\n");
  return buildGuestAuditSnapshot({ receiptText, statementSources, manualItems });
}

/**
 * Convert same-tab guest state into the existing authenticated Recovery ingest
 * contract. Manual recurring claims are deliberately not promoted to canonical
 * truth: the server must receive evidence it can parse and persist.
 */
export function buildGuestRecoveryEvidenceTransfer(snapshot: GuestAuditSnapshot): GuestRecoveryEvidenceTransfer | null {
  const requests: EvidenceIngestRequest[] = [];
  const receipts = splitSnippets(snapshot.receiptText);
  const receiptCharacters = receipts.reduce((total, snippet) => total + snippet.length, 0);
  if (receipts.length > recoveryLimits.maxReceiptSnippets || receiptCharacters > recoveryLimits.maxReceiptCharacters) return null;
  if (receipts.length) {
    requests.push({
      kind: "RECEIPT_PASTE",
      receipts: receipts.map((text, index) => ({ clientRef: `guest-receipt-${index + 1}`, text })),
    });
  }

  const csvSources = snapshot.statementSources.filter(isRecoveryCsvSource);
  if (csvSources.some((source) => source.text.length > recoveryLimits.maxCsvCharactersPerSource)) return null;
  for (let index = 0; index < csvSources.length; index += recoveryLimits.maxCsvSources) {
    requests.push({
      kind: "CSV_IMPORT",
      sources: csvSources.slice(index, index + recoveryLimits.maxCsvSources).map((source) => ({
        clientRef: source.id,
        name: source.name,
        text: source.text,
      })),
    });
  }

  return {
    requests,
    unsupportedSourceNames: snapshot.statementSources.filter((source) => !isRecoveryCsvSource(source)).map((source) => source.name),
    unsupportedManualItemCount: snapshot.manualItems.length,
  };
}

export async function persistGuestRecoveryEvidenceTransfer(input: {
  snapshot: GuestAuditSnapshot;
  initialWorkspaceVersion: number;
  submit: (
    request: EvidenceIngestRequest,
    context: { workspaceVersion: number; idempotencyKey: string },
  ) => Promise<GuestRecoveryEvidenceSubmitResult>;
}): Promise<GuestRecoveryEvidencePersistenceResult> {
  const transfer = buildGuestRecoveryEvidenceTransfer(input.snapshot);
  if (!transfer) {
    return {
      ok: false,
      reason: "INVALID_TRANSFER",
      workspaceVersion: input.initialWorkspaceVersion,
      completedRequests: 0,
    };
  }
  if (!transfer.requests.length) {
    return {
      ok: false,
      reason: "NO_SUPPORTED_EVIDENCE",
      workspaceVersion: input.initialWorkspaceVersion,
      completedRequests: 0,
    };
  }

  let workspaceVersion = input.initialWorkspaceVersion;
  let completedRequests = 0;
  let acceptedEvidenceCount = 0;
  for (let index = 0; index < transfer.requests.length; index += 1) {
    const result = await input.submit(transfer.requests[index], {
      workspaceVersion,
      idempotencyKey: guestTransferIdempotencyKey(input.snapshot.exportedAt, index),
    });
    if (!result.ok) {
      return { ok: false, reason: "SUBMISSION_FAILED", workspaceVersion, completedRequests };
    }
    workspaceVersion = result.workspaceVersion;
    const fullyPersisted = result.acceptedEvidenceCount > 0
      && result.results.length > 0
      && result.results.every((item) => item.status === "ACCEPTED");
    if (!fullyPersisted) {
      return { ok: false, reason: "PERSISTENCE_UNCONFIRMED", workspaceVersion, completedRequests };
    }
    completedRequests += 1;
    acceptedEvidenceCount += result.acceptedEvidenceCount;
  }

  return {
    ok: true,
    workspaceVersion,
    completedRequests,
    acceptedEvidenceCount,
    unsupportedSourceNames: transfer.unsupportedSourceNames,
    unsupportedManualItemCount: transfer.unsupportedManualItemCount,
  };
}

function guestTransferIdempotencyKey(exportedAt: string, requestIndex: number) {
  return `guest-transfer-v1-${exportedAt.replace(/[-:.]/g, "")}-${requestIndex + 1}`;
}

function splitSnippets(value: string) {
  return value.split(/\n\s*\n/).map((snippet) => snippet.trim()).filter(Boolean);
}

function isRecoveryCsvSource(source: TransferStatementSource) {
  return source.kind === "csv" || (source.kind === undefined && source.name.toLowerCase().endsWith(".csv"));
}

function utf8Length(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function isStatementSource(value: unknown): value is TransferStatementSource {
  if (!value || typeof value !== "object") return false;
  const source = value as Partial<TransferStatementSource>;
  return typeof source.id === "string"
    && source.id.length > 0
    && source.id.length <= 240
    && typeof source.name === "string"
    && source.name.trim().length > 0
    && source.name.length <= 240
    && typeof source.text === "string"
    && source.text.length > 0
    && typeof source.rowCount === "number"
    && Number.isSafeInteger(source.rowCount)
    && source.rowCount >= 0
    && (source.kind === undefined || ["csv", "pdf", "spreadsheet"].includes(source.kind))
    && (source.warnings === undefined || (Array.isArray(source.warnings)
      && source.warnings.length <= 100
      && source.warnings.every((warning) => typeof warning === "string" && warning.length <= 500)));
}

function isManualItem(value: unknown): value is ManualRecurringInput {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ManualRecurringInput>;
  return typeof item.id === "string"
    && item.id.length > 0
    && item.id.length <= 240
    && typeof item.merchant === "string"
    && item.merchant.trim().length > 0
    && item.merchant.length <= 180
    && typeof item.amount === "number"
    && Number.isFinite(item.amount)
    && item.amount > 0
    && typeof item.frequency === "string"
    && transferFrequencies.has(item.frequency)
    && typeof item.nextExpectedDate === "string"
    && Boolean(parseIsoDateOnly(item.nextExpectedDate))
    && typeof item.category === "string"
    && item.category.length <= 100;
}
