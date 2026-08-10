export const maxPdfPages = 50;
export const maxPdfTextCharacters = 2_000_000;

export function hasReadablePdfTextLayer(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length >= 40 && /[\p{L}\p{N}]/u.test(normalized);
}

export function assertPdfTextWithinLimits(result: { total: number; text: string }) {
  if (!Number.isInteger(result.total) || result.total < 1 || result.total > maxPdfPages) {
    throw new Error(`PDF exceeds the ${maxPdfPages} page limit.`);
  }
  if (result.text.length > maxPdfTextCharacters) {
    throw new Error(`PDF exceeds the ${maxPdfTextCharacters.toLocaleString("en")} character text limit.`);
  }
}