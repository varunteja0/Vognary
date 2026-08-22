/**
 * First-session cards from already-cited recurring items.
 * Same spoken sentence, quote, overlap, and Keep-primary rule as signed-in Home.
 */
import type { DecisionReasonKey } from "./contracts";
import { spokenChargeWhenLine } from "./decision-cycle";
import { decimalToMinorUnits, toMoneyDto } from "./domain";
import { PROVISIONAL_RISK_TAG } from "./provisional-receipt";
import { groupStackOverlaps } from "./stack-overlap";
import { receiptQuote, spokenDecisionSentence } from "./wow-first-session";

export type RecurringItemLike = {
  id?: string;
  merchant?: string;
  category?: string;
  currency?: string;
  averageAmount?: number;
  amount?: number;
  amountDecimal?: string;
  nextExpectedDate?: string | null;
  provisional?: boolean;
  riskTags?: readonly string[];
  evidence?: readonly { description?: string; amountDecimal?: string; amount?: number; date?: string }[];
};

export type StartCard = {
  id: string;
  merchant: string;
  amountDisplay: string;
  dueDate: string | null;
  whenLine: string;
  sentence: string;
  excerpt: string | null;
  provisional: boolean;
  reasonKeys: readonly DecisionReasonKey[];
  overlapMerchants: readonly string[];
};

export function startCardsFromRecurringItems(items: readonly RecurringItemLike[], today: string): StartCard[] {
  const prepared = items.flatMap((item, index) => {
    const merchant = item.merchant?.trim();
    const currency = (item.currency ?? "INR").toUpperCase();
    // One charge per card: the most recent cited bill. The engine's averaged
    // effective amount is only a fallback, so a price-increase card never shows
    // an average that no receipt contains.
    const cited = (item.evidence ?? []).filter((link) => (
      typeof link.amountDecimal === "string" || (typeof link.amount === "number" && Number.isFinite(link.amount) && link.amount > 0)
    ));
    const dated = cited.filter((link) => typeof link.date === "string" && link.date.length >= 10);
    const newestDated = dated.length
      ? [...dated].sort((left, right) => String(right.date).localeCompare(String(left.date)))[0]
      : undefined;
    // Merged evidence is stored oldest-first, so without dates the last row is the newest.
    const latestCited = newestDated ?? cited.at(-1);
    const latestDecimal = latestCited?.amountDecimal ?? (typeof latestCited?.amount === "number" ? latestCited.amount.toFixed(2) : undefined);
    const numericAmount = item.averageAmount ?? item.amount ?? item.evidence?.[0]?.amount;
    const amountDecimal = latestDecimal
      ?? item.amountDecimal
      ?? (typeof numericAmount === "number" ? numericAmount.toFixed(2) : "");
    if (!merchant || !amountDecimal) return [];
    let amountDisplay = amountDecimal;
    try {
      amountDisplay = toMoneyDto(decimalToMinorUnits(amountDecimal, currency), currency).display;
    } catch {
      amountDisplay = `${currency} ${amountDecimal}`;
    }
    const dueDate = item.nextExpectedDate && item.nextExpectedDate >= today ? item.nextExpectedDate : null;
    const provisional = item.provisional === true || (item.riskTags ?? []).some((tag) => tag === PROVISIONAL_RISK_TAG || /provisional/i.test(tag));
    return [{
      id: item.id ?? `${merchant}-${index}`,
      merchant,
      category: item.category ?? "Other",
      amountDisplay,
      dueDate,
      provisional,
      excerpt: receiptQuote(item.evidence?.[0]?.description ?? null),
    }];
  });

  const groups = groupStackOverlaps(prepared.map((item) => ({
    id: item.id,
    merchant: item.merchant,
    category: item.category,
    status: "ACTIVE" as const,
    purpose: null,
  })));

  return prepared.map((item) => {
    const overlapMerchants = groups
      .find((group) => group.members.some((member) => member.id === item.id))
      ?.members.filter((member) => member.id !== item.id)
      .map((member) => member.merchant) ?? [];
    const reasonKeys: DecisionReasonKey[] = [];
    if (item.provisional) reasonKeys.push("PROVISIONAL_SINGLE");
    if (overlapMerchants.length > 0) reasonKeys.push("OVERLAP_NO_PURPOSE");
    if (reasonKeys.length === 0) reasonKeys.push("NO_PRIOR_DECISION");
    const whenLine = spokenChargeWhenLine(today, item.dueDate);
    return {
      id: item.id,
      merchant: item.merchant,
      amountDisplay: item.amountDisplay,
      dueDate: item.dueDate,
      whenLine,
      sentence: spokenDecisionSentence({
        merchant: item.merchant,
        amountDisplay: item.amountDisplay,
        whenLine,
        overlapMerchants,
        provisional: item.provisional,
        undecided: true,
      }),
      excerpt: item.excerpt,
      provisional: item.provisional,
      reasonKeys,
      overlapMerchants,
    };
  });
}
