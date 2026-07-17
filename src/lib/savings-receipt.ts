import type { VerifiedSaving, VerifiedSavingsSummary } from "./verified-savings";

/**
 * Savings Receipt — the shareable artifact of a Verified Saving.
 *
 * A receipt only ever contains commitments whose status is `verified`:
 * expected debits passed clean inside covered evidence. It is built to be
 * sealed with the audit-pack checksum (and optional issuer signature) so the
 * shared number is checkable at /verify, not just claimed.
 *
 * Totals are single-currency by construction: entries are restricted to the
 * dominant currency among verified savings, because Vognary never sums
 * currencies with an invented exchange rate.
 */

export type SavingsReceiptEntry = {
  merchant: string;
  category: string;
  action: "cancel" | "downgrade";
  decidedAt: string;
  annualSaving: number;
  cleanCycles: number;
  requiredCleanCycles: number;
};

export type SavingsReceipt = {
  version: 1;
  kind: "vognary-savings-receipt";
  generatedAt: string;
  currency: string;
  verifiedAnnual: number;
  verifiedMonthly: number;
  verifiedCount: number;
  entries: SavingsReceiptEntry[];
  method: string;
  verifyUrl: string;
};

export type SavingsReceiptOptions = {
  generatedAt?: Date;
  /** Replace merchant names with categories for anonymous sharing. */
  redactMerchants?: boolean;
  verifyUrl?: string;
};

const METHOD_STATEMENT =
  "Each saving was verified by evidence of absence: after the cancel or downgrade decision, the commitment's own predicted debit dates passed inside covered evidence without the charge recurring.";

export function buildSavingsReceipt(
  savings: VerifiedSavingsSummary,
  options: SavingsReceiptOptions = {},
): SavingsReceipt | null {
  const verified = savings.entries.filter((entry) => entry.status === "verified");
  if (!verified.length) return null;

  const currency = dominantCurrency(verified);
  const inCurrency = verified.filter((entry) => entry.currency === currency);

  const entries = inCurrency
    .map((entry) => ({
      merchant: options.redactMerchants ? entry.category : entry.merchant,
      category: entry.category,
      action: entry.action,
      decidedAt: entry.decidedAt,
      annualSaving: roundMoney(entry.annualSaving),
      cleanCycles: entry.cleanCycles,
      requiredCleanCycles: entry.requiredCleanCycles,
    }))
    .sort((left, right) => right.annualSaving - left.annualSaving || left.merchant.localeCompare(right.merchant, "en"));

  const verifiedAnnual = roundMoney(inCurrency.reduce((sum, entry) => sum + entry.annualSaving, 0));
  const verifiedMonthly = roundMoney(inCurrency.reduce((sum, entry) => sum + entry.monthlySaving, 0));

  return {
    version: 1,
    kind: "vognary-savings-receipt",
    generatedAt: (options.generatedAt ?? new Date()).toISOString(),
    currency,
    verifiedAnnual,
    verifiedMonthly,
    verifiedCount: entries.length,
    entries,
    method: METHOD_STATEMENT,
    verifyUrl: options.verifyUrl ?? "https://www.vognary.com/verify",
  };
}

export function buildSavingsShareText(receipt: SavingsReceipt): string {
  const amount = formatReceiptMoney(receipt.verifiedAnnual, receipt.currency);
  const commitments = receipt.verifiedCount === 1 ? "1 recurring charge" : `${receipt.verifiedCount} recurring charges`;
  return [
    `Vognary verified ${amount}/yr stopped leaving my account — ${commitments} cancelled and proven by evidence of absence, not promised.`,
    `Any Vognary receipt can be checked at ${receipt.verifyUrl}.`,
  ].join(" ");
}

export function formatReceiptMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${Math.round(value).toLocaleString("en-IN")}`;
  }
}

function dominantCurrency(entries: VerifiedSaving[]): string {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    totals.set(entry.currency, (totals.get(entry.currency) ?? 0) + entry.annualSaving);
  }
  return [...totals.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "en"))[0][0];
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
