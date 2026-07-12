export function hasReadablePdfTextLayer(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length >= 40 && /[\p{L}\p{N}]/u.test(normalized);
}