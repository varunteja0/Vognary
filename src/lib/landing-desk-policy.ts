/**
 * Public desk annotation. Must stay weaker than signed-in Control:
 * no policy version, no invented exposure, no recorded decision.
 *
 * Founder-owned voice: keep status honest (Review required / not cited)
 * and rewrite `reason` if the sentence does not sound like Vognary.
 */
export type LandingDeskAnnotation = {
  truthClass: "truth-policy" | "truth-frozen";
  status: string;
  reason: string;
};

export function annotateLandingPolicy(input: {
  usingExample: boolean;
  proposedAmountInr: number | null;
  citedPriorInr: number;
}): LandingDeskAnnotation {
  if (input.usingExample && input.proposedAmountInr != null) {
    const delta = input.proposedAmountInr - input.citedPriorInr;
    return {
      truthClass: "truth-policy",
      status: delta > 0 ? "Review required" : "Within last cited amount",
      reason: delta > 0
        ? `The latest cited bill is INR ${delta.toLocaleString("en-IN")} higher than the previous one. Policy annotates. A named human still decides.`
        : "Cited amounts did not increase. A named human still freezes the cap.",
    };
  }

  return {
    truthClass: "truth-frozen",
    status: "Review required",
    reason: "Existing exposure is not cited (EXPOSURE_NOT_CITED). Policy cannot invent a merchant or an amount.",
  };
}
