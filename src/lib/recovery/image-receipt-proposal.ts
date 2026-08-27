/**
 * Prefill confirm-the-line from already-readable text. Never invents money.
 * The user still has to confirm before the line becomes evidence.
 */
import { parseLooseCalendarDate } from "@/lib/loose-date";
import { extractObservedReceipt } from "@/lib/receipt-parser";
import { sanitizeKnownMerchants, workspaceMerchantCitedInText } from "@/lib/recovery/monthly-loop";

export type ReceiptLineProposal = {
  merchant: string;
  amount: string;
  currency: string;
  date: string;
  nextBillingDate?: string;
  zeroPaidVisible?: boolean;
};

export type ImageProposalStatus = "idle" | "reading" | "ready" | "unreadable";

export type ReceiptImageProposeReason = "cited" | "unreadable" | "not-image" | "too-large" | "timeout" | "error";

export type ReceiptImageProposeResult = {
  proposal: ReceiptLineProposal | null;
  reason: ReceiptImageProposeReason;
};

export type ReceiptLineProposalOptions = {
  knownMerchants?: readonly string[];
};

export const RECEIPT_IMAGE_CLIENT_TIMEOUT_MS = 8_000;

export function confirmLineInputLocked(
  formDisabled: boolean,
  proposalStatus?: ImageProposalStatus,
): boolean {
  void proposalStatus;
  return formDisabled;
}

const visibleBrandPattern = /(OpenAI|ChatGPT|Anthropic|Claude|Kling|Cursor|Perplexity|Midjourney|Runway|ElevenLabs|GitHub|Vercel|Render|AWS|Google Cloud|DigitalOcean|Cloudflare|GoDaddy|Namecheap|Hostinger|Apple|Google Play|Google One|Netflix|Spotify|YouTube|Amazon Prime|Prime Video|Hotstar|JioHotstar|Adobe|Canva|Figma|Notion|Slack|Zoom|Linear|Sentry|PostHog|X Premium|X\.com|Airtel|Jio|LIC|Razorpay|Stripe)/i;
const planSuffixPattern = /^(Plus|Pro|Max|Team|Business|Premium|Enterprise|Unlimited)\b/i;
const visibleAmountPattern = /(?:(₹|Rs\.?|INR|USD|EUR|GBP|CAD|AUD|US\$|CA\$|AU\$|€|£|\$)\s*([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)|([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)\s*(INR|USD|EUR|GBP|CAD|AUD))/gi;
const visibleDatePattern = /\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?,?\s+\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}/g;
const untilDatePrefix = /\b(?:until|till|through|expires?|valid(?:\s+until)?|access(?:\s+until)?)\b/i;
const nextCycleDatePrefix = /\b(?:next\s+(?:bill(?:ing)?(?:\s+cycle)?|charge|renewal)|billing\s+cycle\s+starts|renews?\s+on)\b/i;
const paidDatePrefix = /\b(?:paid|charged|debited|transaction|invoice|receipt|billing|charge date)\b/i;
const genericMerchant = /^(paid|invoice|receipt|transaction|total|amount|date|history|plan|subscription|merchant|seller|vendor|premium|active|inactive|manage subscription)$/i;

export function proposeReceiptLineFromReadableText(
  text: string,
  options?: ReceiptLineProposalOptions,
): ReceiptLineProposal | null {
  const observed = extractObservedReceipt(text);
  if (observed) {
    return applyCitedWorkspaceMerchant(withNextBilling({
      merchant: observed.merchant,
      amount: observed.amountDecimal,
      currency: observed.currency,
      date: observed.observedDate,
    }, text), text, options?.knownMerchants);
  }
  return proposeReceiptLineFromVisibleText(text, options);
}

export function proposeReceiptLineFromVisibleText(
  text: string,
  options?: ReceiptLineProposalOptions,
): ReceiptLineProposal | null {
  const normalized = normalizeVisibleText(text);
  if (!normalized) return null;

  const merchant = visibleMerchant(normalized);
  const amount = visibleAmount(normalized);
  const date = visibleChargeDate(normalized);
  const nextBillingDate = visibleNextBillingDate(normalized);
  const currency = amount.currency || visibleCurrency(normalized);
  if (!merchant && !amount.decimal && !date && !nextBillingDate) return null;
  if (amount.decimal && Number(amount.decimal) === 0) {
    return applyCitedWorkspaceMerchant(withNextBilling({
      merchant: merchant ?? "",
      amount: "",
      currency: currency || "INR",
      date: date ?? "",
      zeroPaidVisible: true,
    }, normalized), normalized, options?.knownMerchants);
  }
  return applyCitedWorkspaceMerchant(withNextBilling({
    merchant: merchant ?? "",
    amount: amount.decimal,
    currency: currency || (amount.decimal ? "INR" : ""),
    date: date ?? "",
  }, normalized), normalized, options?.knownMerchants);
}

export function applyCitedWorkspaceMerchant(
  proposal: ReceiptLineProposal | null,
  text: string,
  knownMerchants?: readonly string[],
): ReceiptLineProposal | null {
  if (!proposal) return null;
  if (proposal.merchant) return proposal;
  const merchant = workspaceMerchantCitedInText(text, knownMerchants ?? []);
  if (!merchant) return proposal;
  return { ...proposal, merchant };
}

export function sanitizeReceiptLineProposal(input: Partial<ReceiptLineProposal> | null | undefined): ReceiptLineProposal | null {
  if (!input) return null;
  const merchant = cleanMerchant(input.merchant ?? "");
  const currency = (input.currency ?? "").trim().toUpperCase();
  const amount = (input.amount ?? "").replace(/,/g, "").trim();
  const date = (input.date ?? "").trim();
  const nextBillingDate = (input.nextBillingDate ?? "").trim();
  const safeCurrency = /^[A-Z]{3}$/.test(currency) ? currency : "";
  const safeAmount = /^\d+(\.\d{1,2})?$/.test(amount) && Number(amount) > 0 ? amount : "";
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
  const safeNext = /^\d{4}-\d{2}-\d{2}$/.test(nextBillingDate) && nextBillingDate !== safeDate ? nextBillingDate : "";
  if (!merchant && !safeAmount && !safeDate && !safeNext) return null;
  const zeroPaidVisible = Boolean(input.zeroPaidVisible) && !safeAmount;
  return {
    merchant,
    amount: safeAmount,
    currency: safeCurrency || (safeAmount ? "INR" : ""),
    date: safeDate,
    ...(safeNext ? { nextBillingDate: safeNext } : {}),
    ...(zeroPaidVisible ? { zeroPaidVisible: true } : {}),
  };
}

export function receiptLineProposalIsPartial(proposal: ReceiptLineProposal): boolean {
  return !proposal.merchant || !proposal.amount || !proposal.currency || !(proposal.date || proposal.nextBillingDate);
}

export function mergeReceiptLineProposals(
  left: ReceiptLineProposal | null,
  right: ReceiptLineProposal | null,
): ReceiptLineProposal | null {
  if (!left) return right;
  if (!right) return left;
  const zeroPaid = Boolean(left.zeroPaidVisible || right.zeroPaidVisible);
  let amount = "";
  if (left.amount && right.amount) {
    amount = left.amount === right.amount ? left.amount : "";
  } else if (zeroPaid) {
    amount = "";
  } else {
    amount = left.amount || right.amount;
  }
  return sanitizeReceiptLineProposal({
    merchant: longerName(left.merchant, right.merchant),
    amount,
    currency: left.currency || right.currency,
    date: left.date || right.date,
    nextBillingDate: left.nextBillingDate || right.nextBillingDate,
    zeroPaidVisible: zeroPaid && !amount,
  });
}

/**
 * Turn a vision response into a proposal. Fields are kept only when they
 * already appear in the visible transcript. A paid 0 stays blank.
 */
export function proposalFromVisionExtraction(
  input: unknown,
  options?: ReceiptLineProposalOptions,
): ReceiptLineProposal | null {
  if (input == null) return null;
  if (typeof input === "string") {
    const parsed = parseVisionJson(input);
    if (parsed) return proposalFromVisionExtraction(parsed, options);
    return proposeReceiptLineFromReadableText(input, options);
  }
  if (typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const transcript = typeof record.visible_text === "string" ? record.visible_text : "";
  if (!transcript.trim() || /^empty$/i.test(transcript.trim())) return null;
  const fromText = proposeReceiptLineFromReadableText(transcript, options);
  const grounded = groundVisionFields(record, transcript);
  return applyCitedWorkspaceMerchant(
    mergeReceiptLineProposals(fromText, grounded),
    transcript,
    options?.knownMerchants,
  );
}

export async function fetchReceiptLineProposal(
  file: File,
  options?: ReceiptLineProposalOptions,
): Promise<ReceiptImageProposeResult> {
  const body = new FormData();
  body.append("file", file);
  const knownMerchants = sanitizeKnownMerchants(options?.knownMerchants ?? []);
  if (knownMerchants.length) body.append("known_merchants", JSON.stringify(knownMerchants));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RECEIPT_IMAGE_CLIENT_TIMEOUT_MS);
  try {
    const response = await fetch("/api/receipt-image/propose", {
      method: "POST",
      credentials: "same-origin",
      body,
      signal: controller.signal,
    });
    if (!response.ok) return { proposal: null, reason: "error" };
    const payload = await response.json() as {
      proposal?: ReceiptLineProposal | null;
      reason?: ReceiptImageProposeReason;
    };
    const proposal = sanitizeReceiptLineProposal(payload.proposal);
    return {
      proposal,
      reason: proposal ? "cited" : payload.reason === "not-image" ? "not-image" : "unreadable",
    };
  } catch (error) {
    const timedOut = error instanceof DOMException
      ? error.name === "AbortError"
      : error instanceof Error && error.name === "AbortError";
    return { proposal: null, reason: timedOut ? "timeout" : "error" };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeVisibleText(text: string) {
  return text.replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ").trim();
}

function visibleMerchant(text: string): string | null {
  const names: string[] = [];
  const brandGlobal = new RegExp(visibleBrandPattern.source, "gi");
  for (const match of text.matchAll(brandGlobal)) {
    if (match.index === undefined) continue;
    const after = text.slice(match.index + match[0].length).trim();
    const plan = after.match(planSuffixPattern);
    names.push(cleanMerchant(plan ? `${match[0]} ${plan[1]}` : match[0]));
  }
  if (names.length) {
    names.sort((left, right) => right.length - left.length);
    return names[0] || null;
  }
  const labelled = text.match(/\b(?:merchant|seller|vendor|from|billed to)\s*:\s*([A-Z][A-Za-z0-9 .&+-]{2,60})/i);
  if (labelled?.[1]) return cleanMerchant(labelled[1]);
  return null;
}

function visibleAmount(text: string): { decimal: string; currency: string } {
  const matches = [...text.matchAll(new RegExp(visibleAmountPattern.source, "gi"))].map((match) => {
    const raw = (match[2] ?? match[3] ?? "").replace(/,/g, "");
    const currency = detectVisibleCurrency(match[0]);
    const prefix = text.slice(Math.max(0, (match.index ?? 0) - 40), match.index ?? 0);
    const around = text.slice(match.index ?? 0, (match.index ?? 0) + match[0].length + 24);
    const paid = /\b(?:paid|charged|debited|total|amount|invoice|cost|price)\b/i.test(prefix)
      || /\b(?:paid|charged|debited)\b/i.test(around);
    return { decimal: raw, currency, paid };
  }).filter((match) => match.decimal && match.currency);
  const paid = matches.filter((match) => match.paid);
  const pool = paid.length ? paid : matches;
  const nonzero = pool.filter((match) => Number(match.decimal) > 0);
  const chosen = nonzero.length === 1
    ? nonzero[0]
    : nonzero.length === 0 && pool.length === 1
      ? pool[0]
      : uniqueAmount(nonzero);
  if (!chosen) return { decimal: "", currency: "" };
  return { decimal: chosen.decimal, currency: chosen.currency };
}

function uniqueAmount(matches: readonly { decimal: string; currency: string }[]) {
  if (matches.length === 0) return null;
  const keys = new Set(matches.map((match) => `${match.currency}:${match.decimal}`));
  return keys.size === 1 ? matches[0] : null;
}

function visibleCurrency(text: string): string {
  if (/₹|\bINR\b|\bRs\.?\b/i.test(text)) return "INR";
  if (/\bEUR\b|€/.test(text)) return "EUR";
  if (/\bGBP\b|£/.test(text)) return "GBP";
  if (/\bUSD\b|US\$/.test(text)) return "USD";
  if (/\bCAD\b|CA\$/.test(text)) return "CAD";
  if (/\bAUD\b|AU\$/.test(text)) return "AUD";
  return "";
}

function detectVisibleCurrency(token: string): string {
  if (/₹|\bINR\b|\bRs\.?\b/i.test(token)) return "INR";
  if (/\bEUR\b|€/.test(token)) return "EUR";
  if (/\bGBP\b|£/.test(token)) return "GBP";
  if (/\bCAD\b|CA\$/.test(token)) return "CAD";
  if (/\bAUD\b|AU\$/.test(token)) return "AUD";
  if (/\bUSD\b|US\$|\$/.test(token)) return "USD";
  return "";
}

function visibleChargeDate(text: string): string | null {
  const unique = citedChargeDates(text);
  return unique.length === 1 ? unique[0] : null;
}

function visibleNextBillingDate(text: string): string | undefined {
  const found: string[] = [];
  for (const match of text.matchAll(new RegExp(visibleDatePattern.source, "g"))) {
    const iso = parseLooseCalendarDate(match[0]);
    if (!iso || match.index === undefined) continue;
    const before = text.slice(Math.max(0, match.index - 48), match.index);
    if (untilDatePrefix.test(before)) continue;
    if (nextCycleDatePrefix.test(before)) found.push(iso);
  }
  const unique = [...new Set(found)];
  return unique.length === 1 ? unique[0] : undefined;
}

function withNextBilling(proposal: ReceiptLineProposal, text: string): ReceiptLineProposal {
  const nextBillingDate = visibleNextBillingDate(text);
  if (!nextBillingDate || nextBillingDate === proposal.date) return proposal;
  return { ...proposal, nextBillingDate };
}

function citedChargeDates(text: string): string[] {
  const found: { iso: string; paid: boolean }[] = [];
  for (const match of text.matchAll(new RegExp(visibleDatePattern.source, "g"))) {
    const iso = parseLooseCalendarDate(match[0]);
    if (!iso || match.index === undefined) continue;
    const before = text.slice(Math.max(0, match.index - 48), match.index);
    if (untilDatePrefix.test(before) || nextCycleDatePrefix.test(before)) continue;
    const around = `${before} ${text.slice(match.index, match.index + match[0].length + 24)}`;
    found.push({ iso, paid: paidDatePrefix.test(around) });
  }
  const paid = found.filter((item) => item.paid);
  const pool = paid.length ? paid : found;
  return [...new Set(pool.map((item) => item.iso))];
}

function parseVisionJson(text: string): Record<string, unknown> | null {
  const fenced = text.trim().match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(candidate.slice(start, end + 1));
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function groundVisionFields(record: Record<string, unknown>, transcript: string): ReceiptLineProposal | null {
  const merchant = citedMerchant(record.merchant, transcript);
  const amount = citedAmount(record.amount, transcript);
  const currency = citedCurrency(record.currency, transcript);
  const date = citedDate(record.charge_date ?? record.date, transcript);
  const zeroPaid = Boolean(record.paid_amount_is_zero) && amount === "";
  return sanitizeReceiptLineProposal(withNextBilling({
    merchant,
    amount,
    currency,
    date,
    zeroPaidVisible: zeroPaid,
  }, transcript));
}

function citedMerchant(value: unknown, transcript: string): string {
  const merchant = cleanMerchant(typeof value === "string" ? value : "");
  if (!merchant) return "";
  return transcript.toLowerCase().includes(merchant.toLowerCase()) ? merchant : "";
}

function citedAmount(value: unknown, transcript: string): string {
  const amount = fieldAmount(value);
  if (!amount || Number(amount) <= 0) return "";
  return amountAppearsWithCurrency(amount, transcript) ? amount : "";
}

function citedCurrency(value: unknown, transcript: string): string {
  const currency = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!/^[A-Z]{3}$/.test(currency)) return visibleCurrency(transcript);
  if (currency === "INR" && /₹|\bINR\b|\bRs\.?\b/i.test(transcript)) return "INR";
  if (currency === "USD" && /\bUSD\b|US\$|\$/.test(transcript)) return "USD";
  if (currency === "EUR" && /\bEUR\b|€/.test(transcript)) return "EUR";
  if (currency === "GBP" && /\bGBP\b|£/.test(transcript)) return "GBP";
  if (currency === "CAD" && /\bCAD\b|CA\$/.test(transcript)) return "CAD";
  if (currency === "AUD" && /\bAUD\b|AU\$/.test(transcript)) return "AUD";
  return visibleCurrency(transcript);
}

function citedDate(value: unknown, transcript: string): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : parseLooseCalendarDate(value.trim());
  if (!iso) return "";
  return citedChargeDates(transcript).includes(iso) ? iso : "";
}

function fieldAmount(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  if (typeof value !== "string") return "";
  return value.replace(/,/g, "").replace(/[^\d.]/g, "").trim();
}

function amountAppearsWithCurrency(amount: string, text: string): boolean {
  const variants = amountVariants(amount);
  for (const variant of variants) {
    const escaped = escapeRegExp(variant);
    if (new RegExp(`(?:₹|Rs\\.?|\\bINR\\b|\\bUSD\\b|\\bEUR\\b|\\bGBP\\b|US\\$|\\$|€|£)\\s*${escaped}\\b|\\b${escaped}\\s*(?:INR|USD|EUR|GBP|CAD|AUD)\\b`, "i").test(text)) {
      return true;
    }
  }
  return false;
}

function amountVariants(amount: string): string[] {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric <= 0) return [];
  const plain = Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2);
  const withDecimals = numeric.toFixed(2);
  const [whole, fraction] = withDecimals.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return [...new Set([amount, plain, withDecimals, `${grouped}.${fraction}`, grouped])];
}

function cleanMerchant(value: string): string {
  const merchant = value.replace(/\s+/g, " ").trim().slice(0, 80);
  if (merchant.length < 2 || genericMerchant.test(merchant)) return "";
  return merchant;
}

function longerName(left: string, right: string): string {
  if (!left) return right;
  if (!right) return left;
  if (right.toLowerCase().includes(left.toLowerCase()) && right.length > left.length) return right;
  if (left.toLowerCase().includes(right.toLowerCase())) return left;
  return left.length >= right.length ? left : right;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
