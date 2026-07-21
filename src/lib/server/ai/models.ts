// Model tiers for the AI layer. The cost decision lives here, and it is
// deliberately split so we never pay a premium tier for work a cheaper one does
// as well:
//
//   extraction — Haiku 4.5, the cheapest tier ($1/$5 per 1M tokens in/out).
//     Structured, high-volume, and reconcile.ts catches its arithmetic mistakes
//     deterministically, so the guardrail — not the model price — is what keeps
//     the number honest.
//
//   reasoning  — Sonnet 5, near-Opus quality on this kind of narration/analysis
//     at roughly 40% less than Opus 4.8 ($3/$15 vs $5/$25 per 1M tokens; intro
//     $2/$10 through 2026-08-31). Opus was the earlier default; for reading out
//     numbers the Twin engine already computed, its premium buys nothing here.
//
// This module has no `server-only` import so the pure orchestration + pricing
// code (extract.ts, narrate.ts, pricing.ts) can depend on the model ids without
// pulling in the API-key gateway.
export const AI_MODELS = {
  /** Extraction assist + query compilation — structured, high-volume. */
  extraction: "claude-haiku-4-5",
  /** Narration + action drafting — reasoning-sensitive, low-volume. */
  reasoning: "claude-sonnet-5",
} as const;

export type AiModelTier = keyof typeof AI_MODELS;
export type AiModelId = (typeof AI_MODELS)[AiModelTier];
