import type { ManualRecurringInput, RecommendationType } from "./recurring-audit";
import { parseIsoDateOnly } from "./date-only";

const transferFrequencies = new Set(["weekly", "biweekly", "semimonthly", "monthly", "bimonthly", "quarterly", "yearly", "irregular"]);

export const guestAuditTransferKey = "vognary.guest-audit-transfer.v1";
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

function splitSnippets(value: string) {
  return value.split(/\n\s*\n/).map((snippet) => snippet.trim()).filter(Boolean);
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
