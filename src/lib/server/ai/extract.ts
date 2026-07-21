// Live extraction assist: when the deterministic parser can't read a document,
// the model proposes line items and reconcile.ts disposes — the sum must match
// the document's own stated total or the whole extraction degrades to
// needs-review. The Anthropic client is injected (never fetched here), so the
// route owns the key and this module stays a pure, offline-testable orchestrator
// that degrades safely at every branch: no client, over budget, refusal,
// truncation, or unparseable output all resolve to a typed non-answer, never a
// wrong number.
import type Anthropic from "@anthropic-ai/sdk";
import { AI_MODELS } from "./models";
import { reconcileExtraction, type ExtractedLine, type ReconcileResult } from "./reconcile";
import { evaluateBudget, type BudgetSnapshot } from "./budget";
import { estimateCostPaise } from "./pricing";

const EXTRACTION_MAX_TOKENS = 4096;

const EXTRACTION_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          description: { type: "string" },
          amount: { type: "number" },
        },
        required: ["description", "amount"],
      },
    },
  },
  required: ["lines"],
};

export type ExtractDeps = {
  /** The Anthropic client, or null when no key is provisioned (→ disabled). */
  client: Anthropic | null;
  /** Optional monthly spend snapshot; when present, the cap gates the call. */
  budget?: BudgetSnapshot;
  /** Override the USD→INR rate (tests pass a fixed rate for determinism). */
  usdToInrRate?: number;
};

export type ExtractionErrorReason = "refusal" | "truncated" | "unparseable" | "exception";

export type ExtractionOutcome =
  | { status: "disabled" }
  | { status: "budget-exceeded"; remaining: number }
  | { status: "error"; reason: ExtractionErrorReason; message: string }
  | {
      status: "accepted" | "needs-review";
      lines: ExtractedLine[];
      reconcile: ReconcileResult;
      costPaise: number;
    };

export async function extractLineItems(
  documentText: string,
  expectedTotal: number,
  deps: ExtractDeps,
): Promise<ExtractionOutcome> {
  const client = deps.client;
  if (!client) return { status: "disabled" };

  const model = AI_MODELS.extraction;

  if (deps.budget) {
    const estimatedInputTokens = Math.ceil(documentText.length / 4) + 200;
    const estimate = estimateCostPaise(
      model,
      { inputTokens: estimatedInputTokens, outputTokens: EXTRACTION_MAX_TOKENS },
      deps.usdToInrRate,
    );
    const decision = evaluateBudget(deps.budget, estimate);
    if (!decision.allowed) return { status: "budget-exceeded", remaining: decision.remaining };
  }

  let message: Anthropic.Message;
  try {
    message = await client.messages.create({
      model,
      max_tokens: EXTRACTION_MAX_TOKENS,
      system:
        "Extract every line item printed in the financial document as {description, amount}. " +
        "Amounts are numeric, in the document's own currency. Do not invent, merge, split, or infer " +
        "any line item that is not printed. Return only what the document states.",
      messages: [{ role: "user", content: documentText }],
      // Haiku 4.5 accepts neither adaptive thinking nor the effort parameter —
      // both return 400 on this tier, so we omit them and rely on structured
      // outputs to shape the response.
      output_config: { format: { type: "json_schema", schema: EXTRACTION_SCHEMA } },
    });
  } catch (error) {
    return {
      status: "error",
      reason: "exception",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  if (message.stop_reason === "refusal") {
    return { status: "error", reason: "refusal", message: "The model declined to extract this document." };
  }
  if (message.stop_reason === "max_tokens") {
    return {
      status: "error",
      reason: "truncated",
      message: "Extraction hit the output cap before finishing; treat the document as needs-review.",
    };
  }

  const lines = parseLines(message);
  if (!lines) {
    return { status: "error", reason: "unparseable", message: "Model output was not valid structured extraction." };
  }

  const reconcile = reconcileExtraction(lines, expectedTotal);
  const costPaise = estimateCostPaise(model, usageOf(message), deps.usdToInrRate);
  return { status: reconcile.status, lines, reconcile, costPaise };
}

// A single malformed row taints the whole extraction: if any element isn't a
// clean {description: string, amount: number}, we refuse to trust the batch
// rather than silently drop rows and reconcile against a partial sum.
function parseLines(message: Anthropic.Message): ExtractedLine[] | null {
  const text = message.content.find((block): block is Anthropic.TextBlock => block.type === "text")?.text;
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const raw = (parsed as { lines?: unknown }).lines;
  if (!Array.isArray(raw)) return null;
  const lines: ExtractedLine[] = [];
  for (const row of raw) {
    if (
      row &&
      typeof row === "object" &&
      typeof (row as { description?: unknown }).description === "string" &&
      typeof (row as { amount?: unknown }).amount === "number" &&
      Number.isFinite((row as { amount: number }).amount)
    ) {
      lines.push({
        description: (row as { description: string }).description,
        amount: (row as { amount: number }).amount,
      });
    } else {
      return null;
    }
  }
  return lines;
}

function usageOf(message: Anthropic.Message): { inputTokens: number; outputTokens: number } {
  return {
    inputTokens: message.usage?.input_tokens ?? 0,
    outputTokens: message.usage?.output_tokens ?? 0,
  };
}
