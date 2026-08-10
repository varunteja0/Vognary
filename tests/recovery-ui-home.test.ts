import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import {
  attentionReasons,
  cadences,
  changeKinds,
  commitmentStatuses,
  confidenceStates,
  correctionFields,
  correctionStatuses,
  coverageStates,
  decisions,
  evidenceProvenanceKinds,
  recoveryErrorCodes,
  sourceTypes,
} from "../src/lib/recovery/contracts";
import {
  attentionReasonLabels,
  cadenceLabels,
  changeKindLabels,
  commitmentStatusLabels,
  confidenceLabels,
  confidenceUncertainty,
  correctionFieldLabels,
  correctionStatusLabels,
  coverageLabels,
  coverageMeanings,
  decisionLabels,
  decisionMeanings,
  decisionStamps,
  errorCopy,
  formatDay,
  formatMoment,
  provenanceLabels,
  sourceLabels,
} from "../src/app/workspace/recovery/labels";
import { recoveryViewLabels, recoveryViews } from "../src/app/workspace/recovery/state";

const recoveryDir = "src/app/workspace/recovery";
const recoveryFiles = readdirSync(recoveryDir).filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));
const sourceOf = (file: string) => readFileSync(`${recoveryDir}/${file}`, "utf8");
const allSource = recoveryFiles.map(sourceOf).join("\n");
const homeSource = sourceOf("recovery-home.tsx");
const clientSource = sourceOf("recovery-workspace-client.tsx");
const dialogSource = sourceOf("recovery-dialog.tsx");
const statesSource = sourceOf("recovery-states.tsx");
const profileSource = sourceOf("recovery-profile.tsx");

test("every contract enum has presentation copy, so a contract change cannot render a blank", () => {
  const cases: [readonly string[], Record<string, unknown>][] = [
    [decisions, decisionLabels],
    [decisions, decisionMeanings],
    [decisions, decisionStamps],
    [cadences, cadenceLabels],
    [sourceTypes, sourceLabels],
    [commitmentStatuses, commitmentStatusLabels],
    [confidenceStates, confidenceLabels],
    [confidenceStates, confidenceUncertainty],
    [correctionFields, correctionFieldLabels],
    [correctionStatuses, correctionStatusLabels],
    [changeKinds, changeKindLabels],
    [attentionReasons, attentionReasonLabels],
    [coverageStates, coverageLabels],
    [coverageStates, coverageMeanings],
    [evidenceProvenanceKinds, provenanceLabels],
    [recoveryErrorCodes, errorCopy],
  ];
  for (const [values, map] of cases) {
    assert.deepEqual(Object.keys(map).sort(), [...values].sort());
    for (const value of values) assert.ok(map[value], `${value} needs copy`);
  }
});

test("primary navigation is exactly Home, Commitments, Add evidence, Profile", () => {
  assert.deepEqual([...recoveryViews], ["HOME", "COMMITMENTS", "ADD_EVIDENCE", "PROFILE"]);
  assert.deepEqual(Object.values(recoveryViewLabels), ["Home", "Commitments", "Add evidence", "Profile"]);
  assert.match(clientSource, /<nav aria-label="Primary"/);
  assert.match(clientSource, /aria-current=\{state\.view === view \? "page" : undefined\}/);
});

test("home renders the four required sections and the honest no-baseline state", () => {
  for (const heading of ["WHAT NEEDS ME?", "WHAT CHANGED?", "WHAT HAPPENS NEXT?", "COVERAGE"]) {
    assert.ok(homeSource.includes(heading), `home must render ${heading}`);
  }
  assert.match(homeSource, /home\.changed\.state === "NO_PRIOR_BASELINE"/);
  assert.match(homeSource, /There is nothing earlier to compare this against/);
  assert.match(homeSource, /Currencies are never combined into one number/);
  assert.match(homeSource, /onInspectEvidence/);
  assert.match(homeSource, /item\.evidenceIds\[0\]/);
  assert.match(homeSource, /item\.provenance\.evidenceIds\[0\]/);
  assert.match(clientSource, /transport\.evidence\(/);
});

test("money is only ever the server's own display string", () => {
  assert.match(statesSource, /\{amount\.display\}/);
  assert.doesNotMatch(allSource, /formatMoney|Intl\.NumberFormat\(/);
  assert.doesNotMatch(allSource, /\.minor\s*[*/+-]/);
  assert.doesNotMatch(allSource, /toFixed/);
  assert.doesNotMatch(allSource, /\.sort\(/, "server ordering is authoritative");
});

test("the workspace never imports a local financial engine", () => {
  for (const forbidden of ["recurring-audit", "audit-report", "receipt-parser", "first-action", "renewal-timeline", "twin"]) {
    assert.doesNotMatch(allSource, new RegExp(`from "@/lib/${forbidden}`), `${forbidden} must not be imported`);
  }
  assert.doesNotMatch(allSource, /connector|Account Aggregator|Razorpay|verified saving/i);
});

test("landmarks, live status, and alerts are present for assistive technology", () => {
  assert.match(clientSource, /<main id="recovery-workspace"/);
  assert.equal((clientSource.match(/<h1/g) ?? []).length, 1);
  assert.match(clientSource, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(clientSource, /role="alert"/);
  assert.match(statesSource, /role="alert"/);
});

test("dialogs are modal, labelled, trapped, and give focus back", () => {
  assert.match(dialogSource, /role="dialog"/);
  assert.match(dialogSource, /aria-modal="true"/);
  assert.match(dialogSource, /aria-labelledby=\{titleId\}/);
  assert.match(dialogSource, /event\.key === "Escape"/);
  assert.match(dialogSource, /event\.key !== "Tab"/);
  assert.match(dialogSource, /restoreTarget\?\.focus\(\)/);
});

test("deletion is destructive-confirmed and never silently performed by this view", () => {
  assert.match(clientSource, /DELETE_WORKSPACE_DATA/);
  assert.match(clientSource, /Type DELETE to confirm/);
  assert.match(clientSource, /deleteConfirmation !== "DELETE"/);
  assert.match(clientSource, /Nothing is deleted by this dialog/);
  assert.match(clientSource, /href="\/profile#delete-account"/);
});

test("Recovery delegates export authority to the canonical privacy lifecycle", () => {
  assert.match(profileSource, /href="\/profile#privacy-export"/);
  assert.doesNotMatch(clientSource, /createObjectURL|new Blob|exportWorkspace/);
  assert.doesNotMatch(profileSource, /Download this workspace as JSON|already on screen/);
});

test("dates are formatted for reading without shifting a calendar day", () => {
  assert.equal(formatDay("2026-08-06"), "6 Aug 2026");
  assert.equal(formatDay("not-a-date"), "not-a-date");
  assert.match(formatMoment("2026-08-09T10:00:00.000Z"), /2026/);
  assert.equal(formatMoment("still-not-a-date"), "still-not-a-date");
});

test("evidence inspection exposes every fact the reader needs to check a rupee", () => {
  const panels = sourceOf("recovery-evidence-panels.tsx");
  for (const label of ["Observed fact (exact excerpt)", "Source", "Date", "Amount and currency", "Provenance", "Confidence and uncertainty"]) {
    assert.ok(panels.includes(label), `evidence inspection must show ${label}`);
  }
  assert.match(panels, /\{evidence\.excerpt\}/);
  assert.match(panels, /excerptTruncated/);
  assert.match(panels, /evidence\.source\.label/);
  assert.match(panels, /evidence\.provenance\.reference/);
  assert.match(statesSource, /confidenceUncertainty\[confidence\.state\]/);
  assert.match(panels, /correction\.authoritativeAmount/);
  assert.doesNotMatch(panels, /Amount set to.*smallest currency unit/);
});

test("motion is left to the token layer, so reduced motion is honoured globally", () => {
  assert.doesNotMatch(allSource, /scrollIntoView|requestAnimationFrame|behavior: "smooth"/);
  const globals = readFileSync("src/app/globals.css", "utf8");
  assert.match(globals, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(globals, /animation-duration: 0\.001ms !important/);
  assert.match(globals, /transition-duration: 0\.001ms !important/);
});
