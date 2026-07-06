import type { ManualRecurringInput } from "./recurring-audit";

export type ReceiptCandidate = ManualRecurringInput & {
  confidenceScore: number;
  evidenceText: string;
};

const merchantPatterns = [
  /(?:merchant|seller|vendor|from)[:\s]+([A-Z][A-Za-z0-9 .&+-]{2,60})/i,
  /(OpenAI|ChatGPT|Anthropic|Claude|Kling|Cursor|GitHub|Vercel|Render|AWS|Google Cloud|Apple|Google Play|Netflix|Spotify|Adobe|Canva|Figma|Notion|Slack|Zoom|X Premium|X\.com)/i,
];

const amountPattern = /(?:₹|Rs\.?|INR|USD|\$)\s*([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/i;

export function extractReceiptCandidates(messages: string[]): ReceiptCandidate[] {
  return messages
    .map((message, index) => extractReceiptCandidate(message, index))
    .filter((candidate): candidate is ReceiptCandidate => Boolean(candidate));
}

function extractReceiptCandidate(message: string, index: number): ReceiptCandidate | null {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) return null;

  const subscriptionLike = /subscription|renewal|invoice|receipt|charged|auto.?pay|recurring|plan|membership/i.test(normalized);
  const amountMatch = normalized.match(amountPattern);
  const merchantMatch = merchantPatterns.map((pattern) => normalized.match(pattern)).find(Boolean);

  if (!subscriptionLike || !amountMatch || !merchantMatch) return null;

  const merchant = (merchantMatch[1] || merchantMatch[0]).replace(/[:\s]+$/g, "").trim();
  const amount = Number.parseFloat(amountMatch[1].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const category = inferCategory(merchant);

  return {
    id: `receipt-${index}-${slugify(merchant)}`,
    merchant,
    amount,
    frequency: /annual|yearly|per year/i.test(normalized) ? "yearly" : "monthly",
    nextExpectedDate: inferNextDate(normalized),
    category,
    sourceName: "gmail receipt preview",
    confidenceScore: /renewal|recurring|subscription/i.test(normalized) ? 76 : 62,
    evidenceText: normalized.slice(0, 500),
  };
}

function inferCategory(merchant: string): string {
  if (/OpenAI|ChatGPT|Anthropic|Claude|Kling|Cursor/i.test(merchant)) return "AI tools";
  if (/GitHub/i.test(merchant)) return "Developer tools";
  if (/Vercel|Render|AWS|Cloud/i.test(merchant)) return "Cloud hosting";
  if (/Apple|Google Play/i.test(merchant)) return "App store";
  if (/Netflix|Spotify|YouTube/i.test(merchant)) return "Streaming";
  if (/Adobe|Canva|Figma/i.test(merchant)) return "Creative tools";
  if (/Notion|Slack|Zoom/i.test(merchant)) return "Productivity";
  if (/X Premium|X\.com/i.test(merchant)) return "Social tools";
  return "Other";
}

function inferNextDate(message: string): string {
  const explicitDate = message.match(/(?:renews?|next billing|next charge|due)\D{0,20}(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/i);
  if (explicitDate) {
    const parsed = new Date(explicitDate[1]);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }

  const nextMonth = new Date();
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  return nextMonth.toISOString().slice(0, 10);
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}