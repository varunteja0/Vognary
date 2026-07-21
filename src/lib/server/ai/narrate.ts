// Live narration: turn a computed audit into prose, with the cite-or-shut-up
// guardrail (citations.ts) enforced in code on the model's output. The model is
// asked to produce discrete claims, each citing evidence node IDs from the Proof
// Graph; any claim that cites nothing, or cites an ID that doesn't resolve, is
// dropped before it reaches the user. The client is injected, so this stays a
// pure, offline-testable orchestrator that degrades safely: no client, over
// budget, refusal, truncation, or unparseable output all resolve to a typed
// non-answer and the caller falls back to deterministic copy.
import type Anthropic from "@anthropic-ai/sdk";
import { AI_MODELS } from "./models";
import { validateCited, renderCitedText, type Claim } from "./citations";
import { evaluateBudget, type BudgetSnapshot } from "./budget";
import { estimateCostPaise } from "./pricing";

const NARRATION_MAX_TOKENS = 2048;

const NARRATION_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string" },
          citedIds: { type: "array", items: { type: "string" } },
        },
        required: ["text", "citedIds"],
      },
    },
  },
  required: ["claims"],
};

export type NarrateInput = {
  /** The audit facts + a catalog of evidence IDs the model may cite. */
  context: string;
  /** The evidence node IDs that actually exist in the Proof Graph. */
  validEvidenceIds: Iterable<string>;
};

export type NarrateDeps = {
  /** The Anthropic client, or null when no key is provisioned (→ disabled). */
  client: Anthropic | null;
  /** Optional monthly spend snapshot; when present, the cap gates the call. */
  budget?: BudgetSnapshot;
  /** Override the USD→INR rate (tests pass a fixed rate for determinism). */
  usdToInrRate?: number;
};

export type NarrationErrorReason = "refusal" | "truncated" | "unparseable" | "exception";

export type NarrationOutcome =
  | { status: "disabled" }
  | { status: "budget-exceeded"; remaining: number }
  | { status: "error"; reason: NarrationErrorReason; message: string }
  | {
      status: "narrated";
      /** Only the claims whose evidence resolved, rendered to prose. */
      text: string;
      cited: Claim[];
      dropped: Claim[];
      /** True when nothing was dropped — the whole model output was citable. */
      fullyCited: boolean;
      costPaise: number;
    };

export async function narrateAudit(input: NarrateInput, deps: NarrateDeps): Promise<NarrationOutcome> {
  const client = deps.client;
  if (!client) return { status: "disabled" };

  const model = AI_MODELS.reasoning;

  if (deps.budget) {
    const estimatedInputTokens = Math.ceil(input.context.length / 4) + 200;
    const estimate = estimateCostPaise(
      model,
      { inputTokens: estimatedInputTokens, outputTokens: NARRATION_MAX_TOKENS },
      deps.usdToInrRate,
    );
    const decision = evaluateBudget(deps.budget, estimate);
    if (!decision.allowed) return { status: "budget-exceeded", remaining: decision.remaining };
  }

  let message: Anthropic.Message;
  try {
    message = await client.messages.create({
      model,
      max_tokens: NARRATION_MAX_TOKENS,
      system:
        "Narrate the audit as discrete factual claims. Every claim MUST cite the evidence node IDs it " +
        "rests on via citedIds. Never state a financial fact you cannot cite. If you are unsure, omit the " +
        "claim rather than guess. Only cite IDs that appear in the provided evidence catalog.",
      messages: [{ role: "user", content: input.context }],
      // Sonnet 5 supports the effort parameter; narration is a rendering task
      // over already-computed numbers, so low effort keeps it fast and cheap.
      output_config: { effort: "low", format: { type: "json_schema", schema: NARRATION_SCHEMA } },
    });
  } catch (error) {
    return {
      status: "error",
      reason: "exception",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  if (message.stop_reason === "refusal") {
    return { status: "error", reason: "refusal", message: "The model declined to narrate this audit." };
  }
  if (message.stop_reason === "max_tokens") {
    return { status: "error", reason: "truncated", message: "Narration hit the output cap before finishing." };
  }

  const claims = parseClaims(message);
  if (!claims) {
    return { status: "error", reason: "unparseable", message: "Model output was not valid structured narration." };
  }

  const check = validateCited(claims, input.validEvidenceIds);
  const costPaise = estimateCostPaise(model, usageOf(message), deps.usdToInrRate);
  return {
    status: "narrated",
    text: renderCitedText(check),
    cited: check.cited,
    dropped: check.dropped,
    fullyCited: check.ok,
    costPaise,
  };
}

function parseClaims(message: Anthropic.Message): Claim[] | null {
  const text = message.content.find((block): block is Anthropic.TextBlock => block.type === "text")?.text;
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const raw = (parsed as { claims?: unknown }).claims;
  if (!Array.isArray(raw)) return null;
  const claims: Claim[] = [];
  for (const row of raw) {
    if (
      row &&
      typeof row === "object" &&
      typeof (row as { text?: unknown }).text === "string" &&
      Array.isArray((row as { citedIds?: unknown }).citedIds) &&
      (row as { citedIds: unknown[] }).citedIds.every((id) => typeof id === "string")
    ) {
      claims.push({
        text: (row as { text: string }).text,
        citedIds: (row as { citedIds: string[] }).citedIds,
      });
    } else {
      return null;
    }
  }
  return claims;
}

function usageOf(message: Anthropic.Message): { inputTokens: number; outputTokens: number } {
  return {
    inputTokens: message.usage?.input_tokens ?? 0,
    outputTokens: message.usage?.output_tokens ?? 0,
  };
}
