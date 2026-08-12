import type { ManualRecurringInput } from "./recurring-audit";
import { parseLooseCalendarDate } from "./loose-date";

export type ReceiptCandidate = ManualRecurringInput & {
  amountDecimal: string;
  confidenceScore: number;
  evidenceText: string;
  /** Date a charge/payment was actually observed; scheduled debit dates stay null. */
  observedDate: string | null;
};

const merchantPatterns = [
  /(OpenAI|ChatGPT|Anthropic|Claude|Kling|Cursor|Perplexity|Midjourney|Runway|ElevenLabs|GitHub|Vercel|Render|AWS|Google Cloud|DigitalOcean|Cloudflare|GoDaddy|Namecheap|Hostinger|Apple|Google Play|Google One|Netflix|Spotify|YouTube|Amazon Prime|Prime Video|Hotstar|JioHotstar|Adobe|Canva|Figma|Notion|Slack|Zoom|X Premium|X\.com|Airtel|Jio|LIC|Razorpay)/i,
  // Explicit label with a colon ("From: Acme Billing"); the capture must start
  // uppercase so phrases like "from your account" are never taken as merchants.
  /(?:[Mm]erchant|[Ss]eller|[Vv]endor|[Ff]rom)\s*:\s*([A-Z][A-Za-z0-9 .&+-]{2,60})/,
  // Mandate/pre-debit phrasing: "... mandate towards ACME FITNESS for INR 999 ...".
  /(?:towards|in favou?r of)\s+(?!INR\b|Rs\.?\b|USD\b)([A-Z][A-Za-z0-9 .&-]{2,40}?)(?:\s+(?:on|via|of|dated|will|is|has|for)\b|[.,]|$)/,
  // Leading proper-noun phrase directly before a billing keyword, e.g.
  // "Acme Cloud invoice ..." or "Foo domain renewal notice ...".
  /^([A-Z][A-Za-z0-9.&+-]*(?:\s+[A-Z][A-Za-z0-9.&+-]*){0,2})\s+(?:domain|invoice|receipt|subscription|renewal|premium|bill|plan|membership)\b/,
];

const mandateLikePattern = /pre-?debit|e-?mandate|\bmandate\b|standing instruction|autopay|auto-?debit/i;

const amountPattern = /(?:₹|Rs\.?|INR|USD|EUR|GBP|CAD|AUD|KWD|JPY|US\$|CA\$|AU\$|€|£|\$)\s*([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{1,3})?|[0-9]+(?:\.[0-9]{1,3})?)/i;

export type ReceiptCurrencyHint = "USD" | "CAD" | "AUD";

export function extractReceiptCandidates(messages: string[], currencyHint: ReceiptCurrencyHint | null = null): ReceiptCandidate[] {
  return messages
    .map((message) => extractReceiptCandidate(message, currencyHint))
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

  return extractReceiptCandidates(splitReceiptSnippets(text), inferReceiptCurrencyHint([text])).map((candidate) => ({
    id: `receipt-paste-${candidate.id}`,
    merchant: candidate.merchant,
    amount: candidate.amount,
    amountDecimal: candidate.amountDecimal,
    currency: candidate.currency,
    frequency: candidate.frequency,
    nextExpectedDate: candidate.nextExpectedDate,
    category: candidate.category,
    sourceName,
    // Carry the raw snippet so mandate kill-list and proof can match UPI/AUTOPAY tokens.
    evidenceDescription: candidate.evidenceText,
  }));
}

export type ObservedReceipt = {
  merchant: string;
  amountDecimal: string;
  currency: string;
  category: string;
  observedDate: string;
  evidenceText: string;
};

// A receipt proving one real charge but declaring no cadence. Two of these let the
// recurring engine infer the schedule from the gap instead of discarding both.
export function extractObservedReceipt(message: string, currencyHint: ReceiptCurrencyHint | null = null): ObservedReceipt | null {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) return null;

  const amountMatch = normalized.match(amountPattern);
  const merchantMatch = matchReceiptMerchant(normalized);
  if (!amountMatch || !merchantMatch) return null;

  const observedDate = inferObservedDate(normalized);
  if (!observedDate) return null;

  const currency = detectReceiptCurrency(amountMatch[0], currencyHint);
  if (!currency) return null;

  const amountDecimal = normalizeAmountDecimal(amountMatch[1]);
  const amount = Number(amountDecimal);
  if (!Number.isFinite(amount) || amount <= 0 || amount > Number.MAX_SAFE_INTEGER) return null;

  const merchant = (merchantMatch[1] || merchantMatch[0]).replace(/[:\s]+$/g, "").trim();
  return {
    merchant,
    amountDecimal,
    currency,
    category: inferCategory(merchant),
    observedDate,
    evidenceText: normalized.slice(0, 500),
  };
}

function extractReceiptCandidate(message: string, currencyHint: ReceiptCurrencyHint | null): ReceiptCandidate | null {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) return null;

  const mandateLike = mandateLikePattern.test(normalized);
  const subscriptionLike = mandateLike
    || /subscription|renewal|renew(?:s|ed)?\b|billing|invoice|receipt|charged|auto.?pay|recurring|plan|membership|will be debited|payment (?:of|received|was)/i.test(normalized);
  const amountMatch = normalized.match(amountPattern);
  const merchantMatch = matchReceiptMerchant(normalized);

  if (!subscriptionLike || !amountMatch || !merchantMatch) return null;

  const merchant = (merchantMatch[1] || merchantMatch[0]).replace(/[:\s]+$/g, "").trim();
  const amountDecimal = normalizeAmountDecimal(amountMatch[1]);
  const amount = Number(amountDecimal);
  if (!Number.isFinite(amount) || amount <= 0 || amount > Number.MAX_SAFE_INTEGER) return null;

  const baseCategory = inferCategory(merchant);
  // RBI pre-debit notifications are the strongest mandate-freshness signal we
  // can legally read today: they arrive by email for the rail we already have.
  const category = baseCategory === "Other" && mandateLike ? "Mandates" : baseCategory;
  const currency = detectReceiptCurrency(amountMatch[0], currencyHint);
  if (!currency) return null;
  const frequency = inferReceiptFrequency(normalized, mandateLike);
  if (!frequency) return null;
  const nextDate = inferNextDate(normalized, frequency);
  if (!nextDate) return null;
  const observedDate = inferObservedDate(normalized);

  return {
    id: `receipt-${slugify(merchant)}-${stableReceiptFingerprint(normalized)}`,
    merchant,
    amount,
    amountDecimal,
    currency,
    frequency,
    nextExpectedDate: nextDate,
    category,
    sourceName: "gmail receipt preview",
    confidenceScore: mandateLike ? 78 : /renewal|recurring|subscription/i.test(normalized) ? 76 : 62,
    evidenceText: normalized.slice(0, 500),
    observedDate,
  };
}

function normalizeAmountDecimal(value: string) {
  const normalized = value.replace(/,/g, "");
  const [whole, fraction] = normalized.split(".");
  const canonicalWhole = BigInt(whole).toString();
  return fraction === undefined ? canonicalWhole : `${canonicalWhole}.${fraction}`;
}

function stableReceiptFingerprint(value: string) {
  const descriptor = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\b\d{1,4}[-/]\d{1,2}[-/]\d{1,4}\b/g, " ")
    .replace(/(?:₹|rs\.?|inr|usd|eur|gbp|cad|aud|\$|€|£)?\s*\d[\d,.]*/g, " ")
    .replace(/[^a-z]+/g, " ")
    .trim();
  let hash = 2_166_136_261;
  for (let offset = 0; offset < descriptor.length; offset += 1) {
    hash ^= descriptor.charCodeAt(offset);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function inferCategory(merchant: string): string {
  if (/OpenAI|ChatGPT|Anthropic|Claude|Kling|Cursor|Perplexity|Midjourney|Runway|ElevenLabs/i.test(merchant)) return "AI tools";
  if (/GitHub/i.test(merchant)) return "Developer tools";
  if (/Cloudflare|GoDaddy|Namecheap|Hostinger/i.test(merchant)) return "Domains";
  if (/Vercel|Render|AWS|Cloud|DigitalOcean/i.test(merchant)) return "Cloud hosting";
  if (/Apple|Google Play|Google One/i.test(merchant)) return "App store";
  // Streaming must be tested before Utilities: "JioHotstar" contains the "Jio"
  // telecom substring, so match it here (via "Hotstar") before it falls through.
  if (/Netflix|Spotify|YouTube|Hotstar|Prime Video|Amazon Prime|Disney/i.test(merchant)) return "Streaming";
  if (/Adobe|Canva|Figma/i.test(merchant)) return "Creative tools";
  if (/Notion|Slack|Zoom/i.test(merchant)) return "Productivity";
  if (/X Premium|X\.com/i.test(merchant)) return "Social tools";
  if (/Airtel|Jio|Vodafone|broadband/i.test(merchant)) return "Utilities";
  if (/LIC|insurance|policy/i.test(merchant)) return "Insurance";
  return "Other";
}

function inferReceiptFrequency(message: string, mandateLike: boolean): ManualRecurringInput["frequency"] | null {
  if (/twice (?:a|per) month|semi-?monthly/i.test(message)) return "semimonthly";
  if (/every (?:two|2) weeks|bi-?weekly|fortnightly/i.test(message)) return "biweekly";
  if (/weekly|per week|every week/i.test(message)) return "weekly";
  if (/every (?:two|2) months|bi-?monthly/i.test(message)) return "bimonthly";
  if (/quarterly|every (?:three|3) months/i.test(message)) return "quarterly";
  if (/annual|yearly|per year|every year/i.test(message)) return "yearly";
  if (/monthly|per month|every month/i.test(message)) return "monthly";
  return mandateLike || /will be debited|pre-?debit|next charge|next debit|next billing|scheduled (?:for|on)|renew(?:s|al|ed)?\b/i.test(message) ? "irregular" : null;
}

// Numeric forms plus month-name forms ("17 July 2026", "July 17, 2026") —
// the latter is how Netflix, Spotify, Google, and Apple receipts write dates.
const receiptDateForms = "\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}|\\d{1,2}[-/]\\d{1,2}[-/]\\d{2,4}|\\d{1,2}(?:st|nd|rd|th)?\\s+[A-Za-z]{3,9}\\.?,?\\s+\\d{4}|[A-Za-z]{3,9}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}";
const explicitNextDatePattern = new RegExp(`(?:renews?\\b|next billing|next charge|due|will be debited|pre-?debit|scheduled (?:for|on)|next debit(?: date)?)[^.\\n]{0,120}?(${receiptDateForms})`, "i");
const chargeDatePattern = new RegExp(`(?:paid|payment date|charged|billed|debited)[\\s\\S]{0,80}?(${receiptDateForms})`, "i");

export function inferReceiptCurrencyHint(texts: readonly string[]): ReceiptCurrencyHint | null {
  const currencies = new Set<ReceiptCurrencyHint>();
  const chargeMerchants = new Set<string>();

  for (const text of texts) {
    collectExplicitDollarCurrencies(text, currencies);
    for (const snippet of splitReceiptSnippets(text)) {
      const amount = snippet.match(amountPattern);
      if (!amount || !/^\s*\$/.test(amount[0])) continue;
      const merchant = matchReceiptMerchant(snippet);
      if (!merchant || !inferObservedDate(snippet)) continue;
      chargeMerchants.add(receiptMerchantName(merchant).toLowerCase());
    }
  }

  if (currencies.size !== 1 || chargeMerchants.size !== 1) return null;
  const [currency] = currencies;
  return currency === "USD" || currency === "CAD" || currency === "AUD" ? currency : null;
}

function inferObservedDate(message: string) {
  const chargeDate = message.match(chargeDatePattern);
  if (!chargeDate || chargeDate.index === undefined) return null;
  const leadingContext = message.slice(Math.max(0, chargeDate.index - 30), chargeDate.index + 16);
  if (/will\s+be\s+debited|pre-?debit|scheduled\s+(?:for|on)/i.test(leadingContext)) return null;
  return parseLooseCalendarDate(chargeDate[1]);
}

function inferNextDate(message: string, frequency: ManualRecurringInput["frequency"]): string | null {
  const explicitDate = message.match(explicitNextDatePattern);
  if (explicitDate) {
    return parseLooseCalendarDate(explicitDate[1]);
  }

  const chargeDate = message.match(chargeDatePattern);
  const parsedChargeDate = chargeDate ? parseLooseCalendarDate(chargeDate[1]) : null;
  return parsedChargeDate ? advanceReceiptDate(parsedChargeDate, frequency) : null;
}

function advanceReceiptDate(value: string, frequency: ManualRecurringInput["frequency"]) {
  const [year, month, day] = value.split("-").map(Number);
  const source = new Date(year, month - 1, day);
  let result: Date;
  if (frequency === "weekly" || frequency === "biweekly") {
    result = new Date(year, month - 1, day + (frequency === "weekly" ? 7 : 14));
  } else if (frequency === "semimonthly") {
    result = day === 1
      ? new Date(year, month - 1, 15)
      : day === 15
        ? new Date(year, month, 1)
        : new Date(year, month - 1, day + 15);
  } else {
    const months = frequency === "bimonthly" ? 2 : frequency === "quarterly" ? 3 : frequency === "yearly" ? 12 : 1;
    const target = new Date(year, month - 1 + months, 1);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    const endOfMonth = day === new Date(source.getFullYear(), source.getMonth() + 1, 0).getDate();
    result = new Date(target.getFullYear(), target.getMonth(), endOfMonth ? lastDay : Math.min(day, lastDay));
  }
  return `${result.getFullYear()}-${`${result.getMonth() + 1}`.padStart(2, "0")}-${`${result.getDate()}`.padStart(2, "0")}`;
}

function detectReceiptCurrency(value: string, currencyHint: ReceiptCurrencyHint | null = null) {
  if (/\bCAD\b|CA\$/i.test(value)) return "CAD";
  if (/\bAUD\b|AU\$/i.test(value)) return "AUD";
  if (/\bEUR\b|€/i.test(value)) return "EUR";
  if (/\bGBP\b|£/i.test(value)) return "GBP";
  if (/\bUSD\b|US\$/i.test(value)) return "USD";
  if (/\$/.test(value)) return currencyHint;
  return "INR";
}

function matchReceiptMerchant(value: string) {
  return merchantPatterns.map((pattern) => value.match(pattern)).find((match): match is RegExpMatchArray => Boolean(match)) ?? null;
}

function receiptMerchantName(match: RegExpMatchArray) {
  return (match[1] || match[0]).replace(/[:\s]+$/g, "").trim();
}

function collectExplicitDollarCurrencies(value: string, currencies: Set<ReceiptCurrencyHint>) {
  if (!/invoice|receipt|billing|payment|charge|total|amount|currency|subscription|renewal/i.test(value)) return;
  if (/\bCAD\b|CA\$/i.test(value)) currencies.add("CAD");
  if (/\bAUD\b|AU\$/i.test(value)) currencies.add("AUD");
  if (/\bUSD\b|US\$/i.test(value)) currencies.add("USD");
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
