import assert from "node:assert/strict";
import { test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { AI_MODELS } from "../src/lib/server/ai/models";
import { estimateCostPaise, MODEL_PRICING } from "../src/lib/server/ai/pricing";
import { extractLineItems } from "../src/lib/server/ai/extract";
import { narrateAudit } from "../src/lib/server/ai/narrate";

// A fake Anthropic client: records the request params and returns a canned
// response. Lets us prove the request is built correctly (right model, right
// structured-output config, no params the tier forbids) and that every degrade
// path is exercised — all without a live API key.
type FakeResponse = {
  text?: string;
  stopReason?: Anthropic.Message["stop_reason"];
  inputTokens?: number;
  outputTokens?: number;
};

function fakeClient(response: FakeResponse, capture?: (params: unknown) => void): Anthropic {
  return {
    messages: {
      create: async (params: unknown) => {
        capture?.(params);
        return {
          id: "msg_fake",
          type: "message",
          role: "assistant",
          model: "fake",
          content: response.text === undefined ? [] : [{ type: "text", text: response.text }],
          stop_reason: response.stopReason ?? "end_turn",
          stop_sequence: null,
          usage: {
            input_tokens: response.inputTokens ?? 100,
            output_tokens: response.outputTokens ?? 50,
          },
        };
      },
    },
  } as unknown as Anthropic;
}

// ---- cost decision: Sonnet 5 reasoning is cheaper than Opus for the same work ----

test("the reasoning tier is a cost-efficient model, not the premium Opus tier", () => {
  assert.equal(AI_MODELS.extraction, "claude-haiku-4-5");
  assert.equal(AI_MODELS.reasoning, "claude-sonnet-5");
});

test("cost estimate is proportional to tokens and Sonnet is cheaper than Opus", () => {
  const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
  const sonnet = estimateCostPaise("claude-sonnet-5", usage, 88);
  const opus = estimateCostPaise("claude-opus-4-8", usage, 88);
  assert.ok(sonnet < opus, "Sonnet 5 must cost less than Opus 4.8 for identical usage");
  // Sonnet intro $2/$10 => $12 => *88 INR *100 paise = 105600 paise
  assert.equal(sonnet, 105_600);
  // Opus $5/$25 => $30 => 264000 paise
  assert.equal(opus, 264_000);
  assert.ok(MODEL_PRICING["claude-haiku-4-5"].inputPerMTokUsd < MODEL_PRICING["claude-sonnet-5"].inputPerMTokUsd);
});

// ---- extraction ----

test("extraction is inert (disabled) when no client is provided", async () => {
  const outcome = await extractLineItems("Netflix 649\nSpotify 119", 768, { client: null });
  assert.equal(outcome.status, "disabled");
});

test("extraction degrades to budget-exceeded before making a call", async () => {
  let called = false;
  const client = fakeClient({ text: '{"lines":[]}' }, () => {
    called = true;
  });
  const outcome = await extractLineItems("x".repeat(400), 100, {
    client,
    budget: { spent: 999_999, cap: 1_000_000 },
  });
  assert.equal(outcome.status, "budget-exceeded");
  assert.equal(called, false, "budget gate must run before any spend");
});

test("extraction accepts when the model's lines reconcile to the parsed total", async () => {
  let params: Record<string, unknown> = {};
  const client = fakeClient(
    { text: '{"lines":[{"description":"Netflix","amount":649},{"description":"Spotify","amount":119}]}' },
    (p) => {
      params = p as Record<string, unknown>;
    },
  );
  const outcome = await extractLineItems("doc", 768, { client });
  assert.equal(outcome.status, "accepted");
  assert.equal(params.model, "claude-haiku-4-5", "extraction runs on the cheap tier");
  const outputConfig = params.output_config as { format?: unknown; effort?: unknown };
  assert.ok(outputConfig?.format, "structured outputs must be requested");
  assert.equal(params.thinking, undefined, "Haiku 4.5 does not accept thinking config");
  assert.equal(outputConfig?.effort, undefined, "Haiku 4.5 does not accept the effort parameter");
});

test("a fabricated line breaks the sum and degrades to needs-review", async () => {
  const client = fakeClient({
    text: '{"lines":[{"description":"Netflix","amount":649},{"description":"phantom","amount":5000}]}',
  });
  const outcome = await extractLineItems("doc", 649, { client });
  assert.equal(outcome.status, "needs-review");
});

test("a model refusal degrades to a safe error, never a wrong number", async () => {
  const client = fakeClient({ stopReason: "refusal", text: undefined });
  const outcome = await extractLineItems("doc", 100, { client });
  assert.equal(outcome.status, "error");
  if (outcome.status === "error") assert.equal(outcome.reason, "refusal");
});

test("unparseable model output degrades to a safe error", async () => {
  const client = fakeClient({ text: "not json at all" });
  const outcome = await extractLineItems("doc", 100, { client });
  assert.equal(outcome.status, "error");
  if (outcome.status === "error") assert.equal(outcome.reason, "unparseable");
});

// ---- narration (the cite-or-shut-up guardrail on live output) ----

test("narration is inert (disabled) when no client is provided", async () => {
  const outcome = await narrateAudit({ context: "audit", validEvidenceIds: ["ev_1"] }, { client: null });
  assert.equal(outcome.status, "disabled");
});

test("narration drops any claim whose evidence does not resolve, keeps the rest", async () => {
  let params: Record<string, unknown> = {};
  const client = fakeClient(
    {
      text: JSON.stringify({
        claims: [
          { text: "Netflix renews on the 6th for ₹649.", citedIds: ["ev_1"] },
          { text: "Your spend will double.", citedIds: [] },
          { text: "You paid AWS $20.", citedIds: ["ev_hallucinated"] },
        ],
      }),
    },
    (p) => {
      params = p as Record<string, unknown>;
    },
  );
  const outcome = await narrateAudit({ context: "audit", validEvidenceIds: ["ev_1"] }, { client });
  assert.equal(outcome.status, "narrated");
  if (outcome.status === "narrated") {
    assert.equal(outcome.cited.length, 1);
    assert.equal(outcome.dropped.length, 2);
    assert.ok(outcome.text.includes("Netflix"));
    assert.ok(!outcome.text.includes("double"), "an uncited claim never reaches the user");
  }
  assert.equal(params.model, "claude-sonnet-5", "narration runs on the reasoning tier");
  const outputConfig = params.output_config as { effort?: unknown };
  assert.equal(outputConfig?.effort, "low", "narration uses low effort to stay cost-efficient");
});
