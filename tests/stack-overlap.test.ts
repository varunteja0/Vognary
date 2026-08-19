import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyStackOverlapFamily,
  groupStackOverlaps,
  overlapFamilyLabels,
  type StackOverlapMember,
} from "../src/lib/recovery/stack-overlap";

function member(partial: Partial<StackOverlapMember> & Pick<StackOverlapMember, "id" | "merchant">): StackOverlapMember {
  return {
    category: "Other",
    status: "ACTIVE",
    purpose: null,
    ...partial,
  };
}

test("named vendors map to conservative overlap families and unknown vendors stay ungrouped", () => {
  assert.equal(classifyStackOverlapFamily("ChatGPT Plus", "Other"), "AI_RESEARCH");
  assert.equal(classifyStackOverlapFamily("Anthropic", "Other"), "AI_RESEARCH");
  assert.equal(classifyStackOverlapFamily("Perplexity AI", "Other"), "AI_RESEARCH");
  assert.equal(classifyStackOverlapFamily("Linear", "Other"), "PROJECT_MANAGEMENT");
  assert.equal(classifyStackOverlapFamily("Notion Labs", "Productivity"), "DOCUMENTATION");
  assert.equal(classifyStackOverlapFamily("Slack", "Productivity"), "COMMUNICATION");
  assert.equal(classifyStackOverlapFamily("Figma", "Other"), "DESIGN");
  assert.equal(classifyStackOverlapFamily("GitHub", "Other"), "ENGINEERING");
  assert.equal(classifyStackOverlapFamily("Vercel", "Cloud hosting"), null);
  assert.equal(classifyStackOverlapFamily("AWS", "Cloud hosting"), null);
  assert.equal(classifyStackOverlapFamily("Open", "Other"), null);
});

test("receipt AI-tools category can group Cursor with ChatGPT without treating cloud as overlap", () => {
  assert.equal(classifyStackOverlapFamily("Cursor", "AI tools"), "AI_RESEARCH");
  assert.equal(classifyStackOverlapFamily("Render", "Cloud hosting"), null);
  assert.equal(overlapFamilyLabels.AI_RESEARCH, "AI / Research");
});

test("overlap requires two distinct active merchants in the same family", () => {
  const groups = groupStackOverlaps([
    member({ id: "c1", merchant: "ChatGPT", category: "AI tools" }),
    member({ id: "c2", merchant: "Claude", category: "AI tools" }),
    member({ id: "c3", merchant: "Slack", category: "Productivity" }),
    member({ id: "c4", merchant: "Vercel", category: "Cloud hosting" }),
    member({ id: "c5", merchant: "ChatGPT Duplicate", category: "AI tools", status: "NOT_RECURRING" }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.family, "AI_RESEARCH");
  assert.deepEqual(groups[0]?.members.map((item) => item.merchant), ["ChatGPT", "Claude"]);
});

test("two listings of the same merchant are not treated as stack overlap", () => {
  const groups = groupStackOverlaps([
    member({ id: "c1", merchant: "Notion" }),
    member({ id: "c2", merchant: "Notion Labs" }),
  ]);
  assert.equal(groups.length, 0);
});

test("Notion and Slack stay in different families even when both are Productivity", () => {
  const groups = groupStackOverlaps([
    member({ id: "c1", merchant: "Notion", category: "Productivity" }),
    member({ id: "c2", merchant: "Slack", category: "Productivity" }),
  ]);
  assert.equal(groups.length, 0);
});
