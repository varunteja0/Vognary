import type { ManualRecurringInput } from "./recurring-audit";
import { formatCalendarDate, parseIsoDateOnly } from "./date-only";

export type ReceiptCandidate = ManualRecurringInput & {
  confidenceScore: number;
  evidenceText: string;
};

const merchantPatterns = [
  /(OpenAI|ChatGPT|Anthropic|Claude|Kling|Cursor|Perplexity|Midjourney|Runway|ElevenLabs|GitHub|Vercel|Render|AWS|Google Cloud|DigitalOcean|Cloudflare|GoDaddy|Namecheap|Hostinger|Apple|Google Play|Netflix|Spotify|YouTube|Adobe|Canva|Figma|Notion|Slack|Zoom|X Premium|X\.com|Airtel|Jio|LIC|Razorpay)/i,
  // Explicit label with a colon ("From: Acme Billing"); the capture must start
  // uppercase so phrases like "from your account" are never taken as merchants.
  /(?:[Mm]erchant|[Ss]eller|[Vv]endor|[Ff]rom)\s*:\s*([A-Z][A-Za-z0-9 .&+-]{2,60})/,
  // Mandate/pre-debit phrasing: "... mandate towards ACME FITNESS for INR 999 ...".
  /(?:towards|in favou?r of)\s+(?!INR\b|Rs\.?\b|USD\b)([A-Z][A-Za-z0-9 .&-]{2,40}?)(?:\s+(?:on|via|of|dated|will|is|has|for)\b|[.,]|$)/,
  // Leading proper-noun phrase directly before a billing keyword, e.g.
  // "Acme Cloud invoice ..." or "Foo domain renewal notice ...".
  /^([A-Z][A-Za-z0-9.&+-]*(?:\s+[A-Z][A-Za-z0-9.&+-]*){0,2})\s+(?:domain|invoice|receipt|subscription|renewal|premium|bill|plan)\b/,
];

const mandateLikePattern = /pre-?debit|e-?mandate|\bmandate\b|standing instruction|autopay|auto-?debit/i;

const amountPattern = /(?:₹|Rs\.?|INR|USD|\$)\s*([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/i;

export function extractReceiptCandidates(messages: string[]): ReceiptCandidate[] {
  return messages
    .map((message, index) => extractReceiptCandidate(message, index))
    .filter((candidate): candidate is ReceiptCandidate => Boolean(candidate));
}

// One pasted blob usually holds several receipts separated by blank lines.
export function splitReceiptSnippets(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((snippet) => snippet.trim())
    .filter(Boolean);
}

// Convert pasted receipt text into recurring-audit inputs so pasted evidence
// lands in the ledger (and merges with statement rows) instead of only counting
// toward source coverage.
export function receiptTextToManualInputs(text: string, sourceName = "Pasted receipt snippet"): ManualRecurringInput[] {
  if (!text.trim()) return [];

  return extractReceiptCandidates(splitReceiptSnippets(text)).map((candidate) => ({
    id: `receipt-paste-${candidate.id}`,
    merchant: candidate.merchant,
    amount: candidate.amount,
    currency: candidate.currency,
    frequency: candidate.frequency,
    nextExpectedDate: candidate.nextExpectedDate,
    category: candidate.category,
    sourceName,
  }));
}

function extractReceiptCandidate(message: string, index: number): ReceiptCandidate | null {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) return null;

  const mandateLike = mandateLikePattern.test(normalized);
  const subscriptionLike = mandateLike
    || /subscription|renewal|invoice|receipt|charged|auto.?pay|recurring|plan|membership|will be debited/i.test(normalized);
  const amountMatch = normalized.match(amountPattern);
  const merchantMatch = merchantPatterns.map((pattern) => normalized.match(pattern)).find(Boolean);

  if (!subscriptionLike || !amountMatch || !merchantMatch) return null;

  const merchant = (merchantMatch[1] || merchantMatch[0]).replace(/[:\s]+$/g, "").trim();
  const amount = Number.parseFloat(amountMatch[1].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const baseCategory = inferCategory(merchant);
  // RBI pre-debit notifications are the strongest mandate-freshness signal we
  // can legally read today: they arrive by email for the rail we already have.
  const category = baseCategory === "Other" && mandateLike ? "Mandates" : baseCategory;
  const currency = /\$|USD/.test(amountMatch[0]) ? "USD" : /€|EUR/.test(amountMatch[0]) ? "EUR" : "INR";

  return {
    id: `receipt-${index}-${slugify(merchant)}`,
    merchant,
    amount,
    currency,
    frequency: /annual|yearly|per year/i.test(normalized) ? "yearly" : "monthly",
    nextExpectedDate: inferNextDate(normalized),
    category,
    sourceName: "gmail receipt preview",
    confidenceScore: mandateLike ? 78 : /renewal|recurring|subscription/i.test(normalized) ? 76 : 62,
    evidenceText: normalized.slice(0, 500),
  };
}

function inferCategory(merchant: string): string {
  if (/OpenAI|ChatGPT|Anthropic|Claude|Kling|Cursor|Perplexity|Midjourney|Runway|ElevenLabs/i.test(merchant)) return "AI tools";
  if (/GitHub/i.test(merchant)) return "Developer tools";
  if (/Cloudflare|GoDaddy|Namecheap|Hostinger/i.test(merchant)) return "Domains";
  if (/Vercel|Render|AWS|Cloud|DigitalOcean/i.test(merchant)) return "Cloud hosting";
  if (/Apple|Google Play/i.test(merchant)) return "App store";
  if (/Netflix|Spotify|YouTube/i.test(merchant)) return "Streaming";
  if (/Adobe|Canva|Figma/i.test(merchant)) return "Creative tools";
  if (/Notion|Slack|Zoom/i.test(merchant)) return "Productivity";
  if (/X Premium|X\.com/i.test(merchant)) return "Social tools";
  if (/Airtel|Jio|Vodafone|broadband/i.test(merchant)) return "Utilities";
  if (/LIC|insurance|policy/i.test(merchant)) return "Insurance";
  return "Other";
}

function inferNextDate(message: string): string {
  const explicitDate = message.match(/(?:renews?|next billing|next charge|due|debit(?:ed)? on|scheduled (?:for|on)|next debit(?: date)?)\D{0,20}(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/i);
  if (explicitDate) {
    const parsed = parseLooseDate(explicitDate[1]);
    if (parsed) return parsed;
  }

  const nextMonth = new Date();
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  return nextMonth.toISOString().slice(0, 10);
}

// Indian receipts write dates day-first ("15/08/2026"); native Date parsing
// assumes month-first and silently fails, so apply the day>12 heuristic.
function parseLooseDate(value: string): string | null {
  const isoDate = parseIsoDateOnly(value);
  if (isoDate) return formatCalendarDate(isoDate);
  const native = new Date(value);
  if (!Number.isNaN(native.getTime())) return formatIsoDate(native);

  const match = value.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (!match) return null;

  const first = Number.parseInt(match[1], 10);
  const second = Number.parseInt(match[2], 10);
  const year = Number.parseInt(match[3].length === 2 ? `20${match[3]}` : match[3], 10);
  const day = first > 12 ? first : second > 12 ? second : first;
  const month = first > 12 ? second : second > 12 ? first : second;
  const parsed = new Date(year, month - 1, day);
  return Number.isNaN(parsed.getTime()) ? null : formatIsoDate(parsed);
}

function formatIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
