/**
 * Monthly compounding is Recovery persistence, not a knowledge graph.
 *
 *   CONFIRM  human confirms a cited line (never auto-commits money)
 *   REMEMBER that line is persisted as RECEIPT_PASTE evidence
 *   DECIDE   owner KEEP / PLAN_TO_CANCEL / REVIEW_LATER
 *   WATCH    next expected window from the KEEP cycle
 *   VERIFY   a later cited receipt on the same exact merchant + currency
 *
 * Inbox forwarding and Control reconcile stay separate enrolled loops.
 * This module never fuzzy-matches merchants, never invents cadence, and
 * never stores embeddings or a parallel "knowledge" table.
 */

export const MONTHLY_LOOP_STEPS = ["CONFIRM", "REMEMBER", "DECIDE", "WATCH", "VERIFY"] as const;
export type MonthlyLoopStep = (typeof MONTHLY_LOOP_STEPS)[number];

export const MAX_KNOWN_MERCHANTS = 50;
const MAX_MERCHANT_CHARS = 80;

const blockedMerchant = /^(paid|invoice|receipt|transaction|total|amount|date|history|plan|subscription|merchant|seller|vendor|premium|active|inactive|manage subscription|plus|pro|max|team|business|enterprise|unlimited)$/i;

export function sanitizeKnownMerchants(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const merchants: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const merchant = item.replace(/\s+/g, " ").trim();
    if (merchant.length < 2 || merchant.length > MAX_MERCHANT_CHARS) continue;
    if (blockedMerchant.test(merchant)) continue;
    const key = merchant.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merchants.push(merchant);
    if (merchants.length >= MAX_KNOWN_MERCHANTS) break;
  }
  return merchants;
}

export function knownMerchantsFromNames(names: readonly string[]): string[] {
  return sanitizeKnownMerchants(names);
}

/**
 * Cite-or-shut-up workspace history: a previously confirmed merchant is
 * usable only when that exact name is already printed in this transcript.
 */
export function workspaceMerchantCitedInText(
  text: string,
  knownMerchants: readonly string[],
): string | null {
  const haystack = text.replace(/\s+/g, " ").trim();
  if (!haystack) return null;
  const matches: string[] = [];
  for (const merchant of sanitizeKnownMerchants(knownMerchants)) {
    const escaped = escapeRegExp(merchant);
    const cited = new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?:[^A-Za-z0-9]|$)`, "i").test(haystack);
    if (cited) matches.push(merchant);
  }
  if (!matches.length) return null;
  matches.sort((left, right) => right.length - left.length);
  return matches[0] ?? null;
}

export function persistTextFromConfirmedLine(existingReceiptText: string, confirmedLine: string): string {
  return [existingReceiptText.trim(), confirmedLine.trim()].filter(Boolean).join("\n\n");
}

export function keepAddBillsOpenAfterPersist(remainingImageCount: number): boolean {
  return remainingImageCount > 0;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
