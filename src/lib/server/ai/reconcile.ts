// Extraction assist: the model proposes, arithmetic disposes. When the LLM
// extracts line items from a receipt or statement the deterministic parser
// rejected, the sum of what it extracted must match the document's own stated
// total before we trust any of it. A fabricated or misread line breaks the sum,
// and the extraction degrades to needs-review — never a silent wrong number.

export type ExtractedLine = { description: string; amount: number };

export type ReconcileResult = {
  status: "accepted" | "needs-review";
  extractedTotal: number;
  expectedTotal: number;
  difference: number;
  toleranceUsed: number;
};

export type ReconcileOptions = {
  /** Absolute rupee slack for rounding differences. Default ₹1. */
  absoluteTolerance?: number;
  /** Fractional slack relative to the expected total. Default 1%. */
  relativeTolerance?: number;
};

export function reconcileExtraction(
  lines: ExtractedLine[],
  expectedTotal: number,
  options: ReconcileOptions = {},
): ReconcileResult {
  const absoluteTolerance = Math.max(0, options.absoluteTolerance ?? 1);
  const relativeTolerance = Math.max(0, options.relativeTolerance ?? 0.01);
  const extractedTotal = round2(lines.reduce((sum, line) => sum + line.amount, 0));
  const difference = round2(Math.abs(extractedTotal - expectedTotal));
  const toleranceUsed = round2(Math.max(absoluteTolerance, Math.abs(expectedTotal) * relativeTolerance));
  return {
    status: difference <= toleranceUsed ? "accepted" : "needs-review",
    extractedTotal,
    expectedTotal: round2(expectedTotal),
    difference,
    toleranceUsed,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
