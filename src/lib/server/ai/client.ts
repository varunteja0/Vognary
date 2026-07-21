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

// Model tiers per master-build-plan Part 3.2 live in ./models (no server-only,
// so pure orchestration code can import them). Re-exported here for callers that
// already reach for them through the client gateway.
export { AI_MODELS } from "./models";
export type { AiModelTier, AiModelId } from "./models";
