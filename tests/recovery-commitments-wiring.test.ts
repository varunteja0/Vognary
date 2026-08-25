import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const commitmentsSource = readFileSync("src/app/workspace/recovery/recovery-commitments.tsx", "utf8");

test("commitment choices use the same three choices, in the same order, as the Now queue", () => {
  const primaryDecisionSource = commitmentsSource.match(/const primaryDecisions = \[([^\]]+)\] as const/);

  assert.ok(primaryDecisionSource, "primary decisions must be declared explicitly");
  assert.deepEqual(primaryDecisionSource[1].match(/[A-Z]+/g), ["KEEP", "MONITOR", "CANCEL"]);
  assert.match(commitmentsSource, /\{primaryDecisions\.map\(\(decision\) =>/);
  assert.match(commitmentsSource, /aria-label="Your choice"/);
});

test("planning a cancellation records intent without claiming provider action", () => {
  assert.match(
    commitmentsSource,
    /Planning to cancel records your intent. Vognary does not cancel the service./,
  );
});

test("commitment detail keeps evidence inspection and correction controls", () => {
  assert.match(commitmentsSource, /label: "Why"/);
  assert.match(commitmentsSource, /<EvidenceRow[\s\S]*?onInspect=\{\(\) => handlers\.onInspectEvidence/);
  assert.match(commitmentsSource, /handlers\.onEvidencePage/);
  assert.match(commitmentsSource, /handlers\.onCorrect/);
  assert.match(commitmentsSource, /<CorrectionHistory/);
  assert.match(commitmentsSource, /<details className="mt-3">[\s\S]*?>More<\/summary>/);
});

test("commitment decisions delegate to handlers without calling provider APIs", () => {
  const decisionHandlers = commitmentsSource.match(/onClick=\{\(\) => handlers\.onDecide\(detail, decision\)\}/g) ?? [];
  const imports = [...commitmentsSource.matchAll(/from "([^"]+)";/g)].map((match) => match[1]);

  assert.equal(decisionHandlers.length, 2, "primary and secondary choices must use handlers.onDecide");
  assert.deepEqual(imports, [
    "react",
    "@/lib/recovery/contracts",
    "./labels",
    "./present",
    "./recovery-evidence-panels",
    "./recovery-states",
    "./state",
    "./ui/disclosure-tabs",
  ]);
  assert.doesNotMatch(commitmentsSource, /\b(?:fetch|XMLHttpRequest|EventSource|WebSocket)\b/);
  assert.doesNotMatch(commitmentsSource, /["'`]\/api\//);
  assert.doesNotMatch(commitmentsSource, /\b(?:connector|concierge|cancellationProvider)\s*\.[A-Za-z_$][\w$]*\s*\(/i);
});
