// The "cite or shut up" guardrail — the one rule of the AI layer, enforced in
// code rather than by prompt politeness. The LLM is never allowed to originate
// a financial fact: every claim it makes must reference evidence node IDs that
// exist in the Proof Graph. Any claim with no citation, or a citation that
// doesn't resolve, is dropped before it can reach the user.

export type Claim = {
  text: string;
  /** Evidence node IDs this claim rests on (e.g. commitment identityKeys). */
  citedIds: string[];
};

export type CitationCheck = {
  cited: Claim[];
  dropped: Claim[];
  /** True when nothing was dropped — the whole model output was citable. */
  ok: boolean;
};

// A claim survives only if it cites at least one evidence node AND every node
// it cites actually exists. One hallucinated id taints the whole claim: a
// sentence that mixes a real citation with an invented one is not trustworthy.
export function validateCited(claims: Claim[], validIds: Iterable<string>): CitationCheck {
  const valid = validIds instanceof Set ? validIds : new Set(validIds);
  const cited: Claim[] = [];
  const dropped: Claim[] = [];
  for (const claim of claims) {
    if (isFullyCited(claim, valid)) cited.push(claim);
    else dropped.push(claim);
  }
  return { cited, dropped, ok: dropped.length === 0 };
}

export function renderCitedText(check: CitationCheck, separator = " "): string {
  return check.cited
    .map((claim) => claim.text.trim())
    .filter(Boolean)
    .join(separator);
}

function isFullyCited(claim: Claim, valid: Set<string>): boolean {
  if (claim.citedIds.length === 0) return false;
  return claim.citedIds.every((id) => valid.has(id));
}
