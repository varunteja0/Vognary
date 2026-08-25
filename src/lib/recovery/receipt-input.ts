// Segments pasted text into separate receipts. This chooses boundaries only; every
// merchant, amount and date is still extracted server-side.

const MAX_RECEIPT_TEXTS = 20;

const AMOUNT = /(?:[₹$€£]|\b(?:INR|USD|EUR|GBP|AUD|CAD|SGD|AED)\b)\s*[\d,]+(?:\.\d{1,2})?|[\d,]+(?:\.\d{1,2})?\s*(?:INR|USD|EUR|GBP|AUD|CAD|SGD|AED)\b/i;
const DATE = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b/i;

function looksComplete(line: string): boolean {
  return AMOUNT.test(line) && DATE.test(line);
}

/**
 * Blank lines always separate bills. Within a block, consecutive lines are split
 * only when every one of them already reads as a whole receipt, so a single
 * receipt spread over several lines is never torn apart.
 */
export function splitReceiptTexts(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const blocks = trimmed
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);

  const texts: string[] = [];
  for (const block of blocks) {
    const lines = block.split(/\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length > 1 && lines.every(looksComplete)) texts.push(...lines);
    else texts.push(block);
  }

  return texts.slice(0, MAX_RECEIPT_TEXTS);
}
