import { extractObservedReceipt, receiptTextToManualInputs, splitReceiptSnippets } from "@/lib/receipt-parser";
import type { ManualRecurringInput } from "@/lib/recurring-audit";
import {
  type OrphanReceiptObservation,
  provisionalManualsFromOrphans,
} from "./provisional-receipt";

export function manualsFromReceiptText(text: string, sourceName: string, today: string): ManualRecurringInput[] {
  const declared = receiptTextToManualInputs(text, sourceName);
  const covered = new Set(declared.map((item) => `${item.merchant.trim().toLowerCase()}::${(item.currency ?? "INR").toUpperCase()}`));
  const observations: OrphanReceiptObservation[] = splitReceiptSnippets(text).flatMap((snippet, index) => {
    const observed = extractObservedReceipt(snippet);
    if (!observed) return [];
    return [{
      id: `${sourceName}-${index + 1}`,
      merchant: observed.merchant,
      normalizedMerchant: observed.merchant,
      amountDecimal: observed.amountDecimal,
      amount: Number(observed.amountDecimal),
      currency: observed.currency,
      observedDate: observed.observedDate,
      excerpt: observed.evidenceText,
      sourceName,
      category: observed.category,
    }];
  });
  return [...declared, ...provisionalManualsFromOrphans(observations, covered, today)];
}
