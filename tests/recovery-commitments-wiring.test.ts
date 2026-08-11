import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const commitmentsSource = readFileSync("src/app/workspace/recovery/recovery-commitments.tsx", "utf8");

test("commitment choices lead with keep, cancel, and monitor", () => {
  const primaryDecisionSource = commitmentsSource.match(/const primaryDecisions = \[([^\]]+)\] as const/);

  assert.ok(primaryDecisionSource, "primary decisions must be declared explicitly");
  assert.deepEqual(primaryDecisionSource[1].match(/[A-Z]+/g), ["KEEP", "CANCEL", "MONITOR"]);
  assert.match(commitmentsSource, /\{primaryDecisions\.map\(\(decision\) =>/);
  assert.match(commitmentsSource, />What do you want to do\?<\/h4>/);
});

test("planning a cancellation records intent without claiming provider action", () => {
  assert.match(
    commitmentsSource,
    /Planning to cancel records your intent; Vognary does not cancel the service\./,
  );
});

test("commitment detail keeps evidence inspection and correction controls", () => {
  assert.match(commitmentsSource, />Why Vognary thinks this<\/h4>/);
  assert.match(commitmentsSource, /<EvidenceRow[\s\S]*?onInspect=\{\(\) => handlers\.onInspectEvidence/);
  assert.match(commitmentsSource, /handlers\.onEvidencePage/);
  assert.match(commitmentsSource, /handlers\.onCorrect/);
  assert.match(commitmentsSource, /<CorrectionHistory/);
  assert.match(commitmentsSource, /<details className="mt-3">[\s\S]*?>More choices<\/summary>/);
});

test("commitment decisions delegate to handlers without calling provider APIs", () => {
  const decisionHandlers = commitmentsSource.match(/onClick=\{\(\) => handlers\.onDecide\(detail, decision\)\}/g) ?? [];
  const imports = [...commitmentsSource.matchAll(/from "([^"]+)";/g)].map((match) => match[1]);

  assert.equal(decisionHandlers.length, 2, "primary and secondary choices must use handlers.onDecide");
  assert.deepEqual(imports, [
    "@/lib/recovery/contracts",
    "./labels",
    "./recovery-evidence-panels",
    "./recovery-states",
    "./state",
  ]);
  assert.doesNotMatch(commitmentsSource, /\b(?:fetch|XMLHttpRequest|EventSource|WebSocket)\b/);
  assert.doesNotMatch(commitmentsSource, /["'`]\/api\//);
  assert.doesNotMatch(commitmentsSource, /\b(?:connector|concierge|cancellationProvider)\s*\.[A-Za-z_$][\w$]*\s*\(/i);
});