import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// The only module that touches the Anthropic SDK or the API key. It is
// deliberately inert until ANTHROPIC_API_KEY is provisioned: with no key,
// getAiClient() returns null and every caller must degrade to the deterministic
// engine. AI is never on the critical path for a correct answer — the guardrail
// (citations.ts), the reconcile check (reconcile.ts), and the budget cap
// (budget.ts) all run regardless of whether a live model is reachable.

let cached: Anthropic | null | undefined;

export function getAiClient(): Anthropic | null {
  if (cached !== undefined) return cached;
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  cached = apiKey ? new Anthropic({ apiKey }) : null;
  return cached;
}

export function isAiEnabled(): boolean {
  return getAiClient() !== null;
}

// Model tiers per master-build-plan Part 3.2: a cheap high-volume tier for
// structured extraction and query compilation, a reasoning tier reserved for
// narration and recommendations where quality is user-visible.
export const AI_MODELS = {
  /** Extraction assist + query compilation — structured, high-volume. */
  extraction: "claude-haiku-4-5",
  /** Narration + action drafting — reasoning-sensitive, low-volume. */
  reasoning: "claude-opus-4-8",
} as const;
