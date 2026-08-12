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
const addEvidenceSource = sourceOf("recovery-add-evidence.tsx");
const clientSource = sourceOf("recovery-workspace-client.tsx");
const commitmentsSource = sourceOf("recovery-commitments.tsx");
const dialogSource = sourceOf("recovery-dialog.tsx");
const statesSource = sourceOf("recovery-states.tsx");
const landingSource = readFileSync("src/app/launch-landing.tsx", "utf8");
const loginSource = readFileSync("src/app/login/login-client.tsx", "utf8");
const appPageSource = readFileSync("src/app/app/page.tsx", "utf8");
const experienceSource = readFileSync("src/app/app/experience-client.tsx", "utf8");
const sourcesSource = sourceOf("recovery-sources.tsx");
const accountSectionsSource = readFileSync("src/app/profile/profile-sections.tsx", "utf8");
const inboundStoreSource = readFileSync("src/lib/server/recovery-inbound-store.ts", "utf8");

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

test("primary navigation is exactly Home, Subscriptions, Sources, with Account outside the tabs", () => {
  assert.deepEqual([...recoveryViews], ["HOME", "COMMITMENTS", "ADD_EVIDENCE"]);
  assert.deepEqual(Object.values(recoveryViewLabels), ["Home", "Subscriptions", "Sources"]);
  assert.match(clientSource, /<nav aria-label="Primary"/);
  assert.match(clientSource, /aria-current=\{state\.view === view \? "page" : undefined\}/);
  assert.match(clientSource, /href="\/profile"/);
  assert.doesNotMatch(clientSource, /state\.view === "PROFILE"/);
});

test("landing, login, and empty Home tell one receipts-to-decision product story", () => {
  for (const source of [landingSource, loginSource, homeSource]) {
    assert.match(source, /billing receipts you already have/);
    assert.match(source, /what renews next/);
  }
  assert.match(landingSource, /Want it done for you\?/);
  assert.match(landingSource, /href="\/private-audit"/);
  assert.match(clientSource, /Your renewal review/);
  assert.match(landingSource, /No bank passwords\. No mailbox access\. You choose which billing text to add\./);
  assert.doesNotMatch(landingSource, /redaction-first source plan|Private software renewal review/);
});

test("home leads with action, only shows real changes, and keeps source freshness compact", () => {
  for (const heading of ["Needs attention", "Since your last visit", "Coming up", "Receipts checked"]) {
    assert.ok(homeSource.includes(heading), `home must render ${heading}`);
  }
  assert.match(homeSource, /home\.changed\.state === "COMPARED"/);
  assert.doesNotMatch(homeSource, /WHAT NEEDS ME\?|WHAT CHANGED\?|WHAT HAPPENS NEXT\?|COVERAGE/);
  assert.doesNotMatch(homeSource, /TotalsStrip|Server totals|Compared version|No prior baseline/);
  assert.match(homeSource, /onInspectEvidence/);
  assert.match(homeSource, /item\.evidenceIds\[0\]/);
  assert.match(homeSource, /item\.provenance\.evidenceIds\[0\]/);
  assert.match(clientSource, /transport\.evidence\(/);
});

test("returning Home leads with proven change and exports only the Recovery projection", () => {
  assert.ok(homeSource.indexOf("Since your last visit") < homeSource.indexOf("Needs attention"));
  assert.match(homeSource, /Sheets go stale when new charges land/);
  assert.match(homeSource, /This is a floor from receipts checked, not every debit in India\./);
  assert.match(homeSource, /renderRecoveryShareText\(home\)/);
  assert.match(homeSource, /Copy for WhatsApp/);
  assert.doesNotMatch(homeSource, /renderAuditReportShareText|buildAuditReport/);
});

test("an empty Home loads and surfaces the receipt source before manual evidence", () => {
  assert.match(clientSource, /void loadSources\(\)/);
  assert.match(clientSource, /receiptInbox=\{state\.receiptInbox\}/);
  assert.match(homeSource, /Your Vognary receipt address/);
  assert.match(homeSource, /Copy address/);
  assert.match(homeSource, /Set up receipt address/);
  assert.match(homeSource, /Add receipts manually/);
});

test("canonical Recovery advertises the receipt inbox only behind public launch readiness", () => {
  assert.match(appPageSource, /isReceiptInboxPubliclyAvailable/);
  assert.match(appPageSource, /receiptInboxPubliclyAvailable=\{receiptInboxPubliclyAvailable\}/);
  assert.match(experienceSource, /receiptInboxPubliclyAvailable/);
  assert.match(clientSource, /if \(!receiptInboxPubliclyAvailable\) return/);
  assert.match(homeSource, /receiptInboxPubliclyAvailable/);
  assert.match(sourcesSource, /if \(!receiptInboxPubliclyAvailable\)/);
  assert.match(sourcesSource, /Manual evidence only/);
});

test("one observation is coached toward a second matching receipt instead of rendering a false all-clear", () => {
  assert.match(clientSource, /commitmentTotal=\{state\.commitmentTotal\}/);
  assert.match(homeSource, /home\.coverage\.evidenceCount > 0 && commitmentTotal === 0/);
  for (const copy of [
    "Seen once",
    "Saved proof",
    "Not called recurring yet",
    "Add a matching receipt",
    "One charge is evidence, not a pattern",
    "Inspect exact evidence",
    "Copy for WhatsApp",
    "This is a floor from receipts checked, not every debit in India.",
  ]) {
    assert.ok(homeSource.includes(copy), `one-observation Home must render ${copy}`);
  }
  assert.match(homeSource, /home\.recentObservations\.map/);
  assert.match(homeSource, /observation\.merchant/);
  assert.match(homeSource, /observation\.amount/);
  assert.match(homeSource, /observation\.date/);
  for (const step of [
    "Paste 2-3 billing emails or invoices",
    "Use the same service twice",
    "See monthly burn, the next expected charge, and one decision",
  ]) {
    assert.ok(addEvidenceSource.includes(step), `first-value guide must render ${step}`);
  }
});

test("subscriptions use ordinary language and three primary choices", () => {
  assert.deepEqual(decisionLabels, {
    KEEP: "Keep",
    MONITOR: "Review later",
    DOWNGRADE: "Consider a cheaper plan",
    CANCEL: "Plan to cancel",
    INVESTIGATE: "I don’t recognize this",
  });
  assert.match(commitmentsSource, /const primaryDecisions = \["KEEP", "CANCEL", "MONITOR"\]/);
  assert.match(commitmentsSource, /What do you want to do\?/);
  assert.match(commitmentsSource, /Planning to cancel records your intent; Vognary does not cancel the service\./);
  assert.match(commitmentsSource, /Why Vognary thinks this/);
  assert.doesNotMatch(commitmentsSource, />Your decision</);
  assert.doesNotMatch(commitmentsSource, />Evidence behind this</);
});

test("Sources makes receipt forwarding primary and keeps manual evidence behind a fallback", () => {
  assert.ok(recoveryFiles.includes("recovery-sources.tsx"), "Recovery Sources view must exist");
  const sourcesSource = sourceOf("recovery-sources.tsx");
  for (const copy of [
    "Your Vognary receipt address",
    "Vognary never accesses or scans your inbox",
    "Create receipt address",
    "Waiting for a receipt",
    "Receipt received",
    "Looking for renewals",
    "Keep Vognary current",
    "Rotate address",
    "Stop receiving",
    "Manual fallback",
    "do not use this address in Gmail’s automatic-forwarding setup yet",
  ]) {
    assert.ok(sourcesSource.includes(copy), `Sources must render ${copy}`);
  }
  assert.match(clientSource, /<RecoverySources/);
  assert.match(clientSource, /manualFallback=\{/);
  assert.match(clientSource, /window\.setInterval\(\(\) => void loadSources\(\), 10_000\)/);
  assert.match(clientSource, /state\.sourceStatus\.kind === "READY" && state\.refreshRequired[\s\S]*void loadSnapshot\(\)/);
  assert.match(clientSource, /state\.receiptInbox\?\.alias/);
  assert.match(sourcesSource, /Source update failed/);
  assert.match(inboundStoreSource, /and \(\$2::uuid is null or alias_id = \$2\)/);
  assert.doesNotMatch(clientSource, /workspaceEmpty && state\.view === "HOME"/);
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

test("workspace delegates destructive account controls to the canonical Account route", () => {
  assert.match(clientSource, /href="\/profile"/);
  assert.doesNotMatch(clientSource, /DELETE_WORKSPACE_DATA|deleteConfirmation|Type DELETE to confirm/);
});

test("Recovery delegates export authority to the canonical privacy lifecycle", () => {
  assert.match(accountSectionsSource, /id="privacy-export"/);
  assert.match(clientSource, /href="\/profile"/);
  assert.doesNotMatch(clientSource, /createObjectURL|new Blob|exportWorkspace/);
  assert.doesNotMatch(accountSectionsSource, /Download this workspace as JSON|already on screen/);
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
