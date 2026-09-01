import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const motto = "Take smart risks. Do not play safe.";

const historicalOrArtifactPaths = new Set([
  "docs/billing-activation-runbook.md",
  "docs/execution/SEND-TODAY.md",
  "docs/execution/people-conversation-learning.md",
  "docs/research-content-pack-2026-07-16.md",
  "docs/vulnerability-disclosure-policy.md",
]);

function isHistoricalOrArtifact(path: string): boolean {
  return path.startsWith(".agent-coordination/")
    || path.startsWith("docs/archive/")
    || path.startsWith("docs/templates/")
    || historicalOrArtifactPaths.has(path);
}

test("every active Markdown document starts from the smart-risk doctrine", () => {
  const trackedMarkdown = execFileSync("git", ["ls-files", "*.md"], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);
  const activeMarkdown = trackedMarkdown.filter((path) => !isHistoricalOrArtifact(path));

  assert.ok(activeMarkdown.length >= 20, `expected the active Markdown authority set, received ${activeMarkdown.length}`);
  for (const path of activeMarkdown) {
    const opening = readFileSync(path, "utf8").slice(0, 1_200);
    assert.match(opening, new RegExp(motto.replaceAll(".", "\\.")), `${path} must carry the operating motto near the top`);
  }
});

test("the supreme smart-risk doctrine requires falsification and bounded downside", () => {
  const law = readFileSync("docs/THE-LAW.md", "utf8");

  assert.match(law, /Founder motto — supreme operating principle/);
  assert.match(law, /cheapest real-world test that can disprove it/);
  assert.match(law, /owner, deadline, success threshold, and kill threshold/);
  assert.match(law, /bounded and preferably reversible downside/);
  assert.match(law, /this doctrine wins \*\*on strategy\*\*/);
  assert.match(law, /Smart risk is not reckless risk/);
  assert.match(law, /invented\s+claims,\s+uncited money, fake readiness, PII exposure/);
});

test("the live authority set locks the human-approved Commitment Control pilot", () => {
  const authorityPaths = [
    "docs/THE-LAW.md",
    "docs/CONTINUE-HERE.md",
    "docs/execution/phase-a-market-contact.md",
    "docs/execution/phase-b-loop-shipping.md",
    "docs/execution/scoreboard.md",
  ];
  const authority = authorityPaths.map((path) => readFileSync(path, "utf8")).join("\n");
  const law = readFileSync("docs/THE-LAW.md", "utf8");
  const normalizedAuthority = authority.replace(/\s+/g, " ");

  assert.ok(/Commitment Control replaces Commitment Intelligence/.test(authority), "Commitment Control must replace the prior direction");
  assert.ok(/proposal.*policy.*human (?:decision|authorization).*reconciliation/i.test(normalizedAuthority), "the complete control loop must be canonical");
  assert.ok(/never auto-approves, auto-denies, purchases, provisions, cancels, or moves money/.test(authority), "V0 must preserve the human-only boundary");
  assert.ok(/one-time ₹14,999/.test(authority), "the paid-pilot price and billing mode must be explicit");
  assert.ok(/five qualified plus fifteen (?:explicitly )?exploratory/i.test(normalizedAuthority), "the two outreach cohorts must stay separate");
  assert.ok(/two upfront payments by Day 7/.test(authority), "the Day 7 success gate must be explicit");
  assert.ok(/zero of ten offers pay/.test(authority), "the offer-failure gate must be explicit");
  assert.ok(/independent security (?:assessment|review).*before any real customer (?:financial )?data/i.test(normalizedAuthority), "real customer data must wait for independent assurance");
  assert.doesNotMatch(law, /human-authorized commitment firewall/i, "V0 must not claim enforcement it does not provide");
});