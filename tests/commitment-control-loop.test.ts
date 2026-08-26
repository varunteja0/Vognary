import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  activeCommitmentControlStep,
  COMMITMENT_CONTROL_STEPS,
  commitmentControlStepLabel,
} from "../src/lib/commitment-control-loop";

const idle = {
  citedEvidence: false,
  hasPolicy: false,
  awaitingHumanDecision: false,
  authorizedAwaitingEvidence: false,
};

test("the unique loop is five sentences and never auto-decides", () => {
  assert.equal(COMMITMENT_CONTROL_STEPS.length, 5);
  assert.match(COMMITMENT_CONTROL_STEPS[2], /does not decide/);
  assert.match(COMMITMENT_CONTROL_STEPS[3], /named owner or admin freezes a cap/);
  assert.doesNotMatch(COMMITMENT_CONTROL_STEPS.join(" "), /auto-approv|keep|plan to cancel/i);
});

test("a waiting human decision is always the current unique step", () => {
  assert.equal(
    activeCommitmentControlStep({ ...idle, hasPolicy: true, citedEvidence: true, awaitingHumanDecision: true }),
    4,
  );
  assert.equal(
    activeCommitmentControlStep({
      ...idle,
      hasPolicy: true,
      citedEvidence: true,
      awaitingHumanDecision: true,
      authorizedAwaitingEvidence: true,
    }),
    4,
  );
});

test("after a cap is frozen, the current work is later cited evidence", () => {
  assert.equal(
    activeCommitmentControlStep({
      ...idle,
      hasPolicy: true,
      citedEvidence: true,
      authorizedAwaitingEvidence: true,
    }),
    5,
  );
});

test("without a policy version the desk cannot evaluate a proposal", () => {
  assert.equal(activeCommitmentControlStep({ ...idle, citedEvidence: true }), 3);
  assert.equal(activeCommitmentControlStep(idle), 3);
});

test("policy in force and no cited bill still asks for evidence first", () => {
  assert.equal(activeCommitmentControlStep({ ...idle, hasPolicy: true }), 1);
});

test("cited evidence and policy, nothing waiting, means the next assumption", () => {
  assert.equal(
    activeCommitmentControlStep({ ...idle, hasPolicy: true, citedEvidence: true }),
    2,
  );
});

test("step labels stay numbered from the same five sentences", () => {
  assert.equal(commitmentControlStepLabel(4), "4 · A named owner or admin freezes a cap, or declines.");
});

test("public and desk surfaces import the same loop, so the USP cannot drift", () => {
  const landing = readFileSync("src/app/launch-landing.tsx", "utf8");
  const about = readFileSync("src/app/about/page.tsx", "utf8");
  const start = readFileSync("src/app/start/start-client.tsx", "utf8");
  const login = readFileSync("src/app/login/login-client.tsx", "utf8");
  const home = readFileSync("src/app/workspace/recovery/recovery-home.tsx", "utf8");
  const control = readFileSync("src/app/workspace/recovery/control/control-view.tsx", "utf8");
  const agent = readFileSync("src/lib/agent-content.ts", "utf8");
  for (const source of [landing, about, start, login, home, control]) {
    assert.match(source, /AuthorizationLoop/);
  }
  assert.match(agent, /COMMITMENT_CONTROL_STEPS/);
});
