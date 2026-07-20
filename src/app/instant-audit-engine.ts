import { rankFirstAction } from "@/lib/first-action";
import {
  buildGuestAuditSnapshot,
  guestAuditTransferKey,
  parseGuestAuditSnapshot,
} from "@/lib/guest-audit-transfer";
import { analyzeStatements } from "@/lib/recurring-audit";
import { receiptTextToManualInputs } from "@/lib/receipt-parser";
import { sampleReceiptText } from "@/lib/sample-audit";

export type InstantAuditResult = {
  totals: Array<[string, number]>;
  nextRenewal: { merchant: string; date: string; amount: number; currency: string };
  action: { label: string; merchant: string; reason: string };
  itemCount: number;
};

export function analyzeInstant(receiptText: string): InstantAuditResult | null {
  const items = receiptTextToManualInputs(receiptText);
  if (!items.length) return null;
  const audit = analyzeStatements([], items);
  if (!audit.recurringItems.length) return null;

  const first = rankFirstAction(audit.recurringItems);
  const next = [...audit.recurringItems].sort((left, right) =>
    left.nextExpectedDate.localeCompare(right.nextExpectedDate) || left.identityKey.localeCompare(right.identityKey))[0];
  if (!first || !next) return null;

  const totals: Record<string, number> = {};
  for (const item of audit.recurringItems) totals[item.currency] = (totals[item.currency] ?? 0) + item.monthlyCost;

  return {
    totals: Object.entries(totals).sort(([left], [right]) => left.localeCompare(right, "en")),
    nextRenewal: { merchant: next.merchant, date: next.nextExpectedDate, amount: next.averageAmount, currency: next.currency },
    action: { label: first.action, merchant: first.item.merchant, reason: first.reason },
    itemCount: audit.recurringItems.length,
  };
}

export function getSampleReceiptText(): string {
  return sampleReceiptText;
}

export function stageForFullAudit(receiptText: string): boolean {
  try {
    const snapshot = buildGuestAuditSnapshot({ receiptText, statementSources: [], manualItems: [] });
    const serialized = JSON.stringify(snapshot);
    if (!parseGuestAuditSnapshot(serialized)) return false;
    window.sessionStorage.setItem(guestAuditTransferKey, serialized);
    return window.sessionStorage.getItem(guestAuditTransferKey) === serialized;
  } catch {
    return false;
  }
}
