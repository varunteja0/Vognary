import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const commitmentsSource = readFileSync("src/app/workspace/recovery/recovery-commitments.tsx", "utf8");
const homeSource = readFileSync("src/app/workspace/recovery/recovery-home.tsx", "utf8");

test("Bills ledger routes decisions to Now instead of duplicating the choice block", () => {
  assert.match(commitmentsSource, /handlers\.onDecideOnNow/);
  assert.match(commitmentsSource, /decideOnNow/);
  assert.doesNotMatch(commitmentsSource, /aria-label="Your choice"/);
  assert.doesNotMatch(commitmentsSource, /handlers\.onDecide\(/);
  assert.match(homeSource, /aria-label="Your choice"/);
});

test("planning a cancellation records intent without claiming provider action", () => {
  assert.match(
    homeSource,
    /customerPhrases\.decisionBoundary/,
  );
});

test("commitment detail keeps evidence inspection and correction controls", () => {
  assert.match(commitmentsSource, /<EvidenceRow[\s\S]*?onInspect=\{\(\) => handlers\.onInspectEvidence/);
  assert.match(commitmentsSource, /handlers\.onEvidencePage/);
  assert.match(commitmentsSource, /handlers\.onCorrect/);
  assert.match(commitmentsSource, /<CorrectionHistory/);
  assert.match(commitmentsSource, /More about this bill/);
  assert.match(commitmentsSource, /groupCommitments/);
});

test("ledger actions delegate to handlers without calling provider APIs", () => {
  const decideOnNowHandlers = commitmentsSource.match(/onClick=\{\(\) => handlers\.onDecideOnNow\(detail\.id\)\}/g) ?? [];
  const imports = [...commitmentsSource.matchAll(/from "([^"]+)";/g)].map((match) => match[1]);

  assert.equal(decideOnNowHandlers.length, 1, "Bills must route pending decisions through onDecideOnNow");
  assert.deepEqual(imports, [
    "react",
    "@/lib/recovery/contracts",
    "./labels",
    "./present",
    "./recovery-evidence-panels",
    "./recovery-states",
    "./state",
  ]);
  assert.doesNotMatch(commitmentsSource, /\b(?:fetch|XMLHttpRequest|EventSource|WebSocket)\b/);
  assert.doesNotMatch(commitmentsSource, /["'`]\/api\//);
  assert.doesNotMatch(commitmentsSource, /\b(?:connector|concierge|cancellationProvider)\s*\.[A-Za-z_$][\w$]*\s*\(/i);
});
