// Real per-model pricing, so budget.ts gates on money rather than a guess.
// Prices are USD per 1,000,000 tokens from the Anthropic pricing table. Sonnet 5
// reflects the introductory rate in effect through 2026-08-31 ($2/$10); it
// reverts to $3/$15 after, which only makes the cap more conservative, never
// less. No `server-only` import — this is pure arithmetic the orchestration code
// and its tests both use.

export type ModelPrice = {
  /** USD per 1M input tokens. */
  inputPerMTokUsd: number;
  /** USD per 1M output tokens. */
  outputPerMTokUsd: number;
};

export const MODEL_PRICING: Record<string, ModelPrice> = {
  "claude-haiku-4-5": { inputPerMTokUsd: 1, outputPerMTokUsd: 5 },
  "claude-sonnet-5": { inputPerMTokUsd: 2, outputPerMTokUsd: 10 },
  "claude-opus-4-8": { inputPerMTokUsd: 5, outputPerMTokUsd: 25 },
};

const DEFAULT_USD_TO_INR = 88;

// Configurable so the cap tracks a real exchange rate; falls back to a sane
// default when unset or malformed rather than throwing on the hot path.
export function usdToInr(): number {
  const raw = Number(process.env.AI_USD_TO_INR);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_USD_TO_INR;
}

export type TokenUsage = { inputTokens: number; outputTokens: number };

// Cost in paise (integer), rounded up so we never under-count against the cap.
// An unknown model returns 0 — a cost we can't price should not silently block
// the AI layer; the budget cap still bounds total known spend.
export function estimateCostPaise(
  model: string,
  usage: TokenUsage,
  usdToInrRate: number = usdToInr(),
): number {
  const price = MODEL_PRICING[model];
  if (!price) return 0;
  const usd =
    (Math.max(0, usage.inputTokens) / 1_000_000) * price.inputPerMTokUsd +
    (Math.max(0, usage.outputTokens) / 1_000_000) * price.outputPerMTokUsd;
  return Math.ceil(usd * usdToInrRate * 100);
}
