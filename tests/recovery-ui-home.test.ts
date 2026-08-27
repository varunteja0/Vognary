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
  decisionCycleActions,
  decisionOutcomeKinds,
  decisionReasonKeys,
  decisionReviewSnoozes,
  decisionVerificationOutcomes,
  evidenceProvenanceKinds,
  commitmentImportances,
  commitmentOwners,
  commitmentPurposes,
  confidenceTruthLayers,
  expectedVsObservedStatuses,
  projectionAmountProvenances,
  recoveryErrorCodes,
  sourceTypes,
} from "../src/lib/recovery/contracts";
import {
  attentionReasonLabels,
  cadenceLabels,
  changeKindLabels,
  commitmentStatusLabels,
  confidenceLabels,
  confidenceTruthLayerLabels,
  confidenceUncertainty,
  correctionFieldLabels,
  correctionStatusLabels,
  coverageLabels,
  coverageMeanings,
  decisionCycleActionLabels,
  decisionLabels,
  decisionMeanings,
  decisionOutcomeKindLabels,
  decisionReasonKeyLabels,
  decisionReviewSnoozeLabels,
  decisionStamps,
  decisionVerificationOutcomeLabels,
  errorCopy,
  expectedVsObservedLabels,
  formatDay,
  formatMoment,
  formatObservedInstant,
  importanceLabels,
  ownerLabels,
  projectionAmountProvenanceLabels,
  provenanceLabels,
  purposeLabels,
  sourceLabels,
} from "../src/app/workspace/recovery/labels";
import { recoveryViewLabels, recoveryViews } from "../src/app/workspace/recovery/state";

const recoveryDir = "src/app/workspace/recovery";
const recoveryFiles = readdirSync(recoveryDir, { recursive: true }).filter((file): file is string => typeof file === "string" && (file.endsWith(".ts") || file.endsWith(".tsx")));
const sourceOf = (file: string) => readFileSync(`${recoveryDir}/${file}`, "utf8");
const allSource = recoveryFiles.map(sourceOf).join("\n");
const homeSource = sourceOf("recovery-home.tsx");
const addEvidenceSource = sourceOf("recovery-add-evidence.tsx");
const clientSource = sourceOf("recovery-workspace-client.tsx");
const commitmentsSource = sourceOf("recovery-commitments.tsx");
const dialogSource = sourceOf("recovery-dialog.tsx");
const statesSource = sourceOf("recovery-states.tsx");
const evidencePanelsSource = sourceOf("recovery-evidence-panels.tsx");
const landingSource = readFileSync("src/app/launch-landing.tsx", "utf8");
const loginSource = readFileSync("src/app/login/login-client.tsx", "utf8");
const appPageSource = readFileSync("src/app/app/page.tsx", "utf8");
const experienceSource = readFileSync("src/app/app/experience-client.tsx", "utf8");
const sourcesSource = sourceOf("recovery-sources.tsx");
const billingSetupSource = sourceOf("recovery-billing-setup.tsx");
const accountSectionsSource = readFileSync("src/app/profile/profile-sections.tsx", "utf8");
const inboundStoreSource = readFileSync("src/lib/server/recovery-inbound-store.ts", "utf8");

test("every contract enum has presentation copy, so a contract change cannot render a blank", () => {
  const cases: [readonly string[], Record<string, unknown>][] = [
    [decisions, decisionLabels],
    [decisions, decisionMeanings],
    [decisions, decisionStamps],
    [decisionCycleActions, decisionCycleActionLabels],
    [decisionReviewSnoozes, decisionReviewSnoozeLabels],
    [decisionReasonKeys, decisionReasonKeyLabels],
    [decisionVerificationOutcomes, decisionVerificationOutcomeLabels],
    [decisionOutcomeKinds, decisionOutcomeKindLabels],
    [commitmentPurposes, purposeLabels],
    [commitmentImportances, importanceLabels],
    [commitmentOwners, ownerLabels],
    [cadences, cadenceLabels],
    [sourceTypes, sourceLabels],
    [commitmentStatuses, commitmentStatusLabels],
    [confidenceStates, confidenceLabels],
    [confidenceStates, confidenceUncertainty],
    [confidenceTruthLayers, confidenceTruthLayerLabels],
    [expectedVsObservedStatuses, expectedVsObservedLabels],
    [correctionFields, correctionFieldLabels],
    [correctionStatuses, correctionStatusLabels],
    [changeKinds, changeKindLabels],
    [attentionReasons, attentionReasonLabels],
    [coverageStates, coverageLabels],
    [coverageStates, coverageMeanings],
    [evidenceProvenanceKinds, provenanceLabels],
    [projectionAmountProvenances, projectionAmountProvenanceLabels],
    [recoveryErrorCodes, errorCopy],
  ];
  for (const [values, map] of cases) {
    assert.deepEqual(Object.keys(map).sort(), [...values].sort());
    for (const value of values) assert.ok(map[value], `${value} needs copy`);
  }
});

test("primary navigation keeps Control and Mandate hidden until each is genuinely available", () => {
  assert.deepEqual([...recoveryViews], ["CONTROL", "HOME", "COMMITMENTS", "ADD_EVIDENCE", "MANDATE"]);
  assert.deepEqual(Object.values(recoveryViewLabels), ["Control", "Now", "Bills", "Sources", "Automation"]);
  assert.match(clientSource, /<nav aria-label="Primary"/);
  assert.match(clientSource, /view !== "MANDATE"/);
  assert.match(clientSource, /view !== "CONTROL" \|\| controlAvailable/);
  assert.match(clientSource, /primaryViews\.map/);
  assert.match(clientSource, /aria-current=\{state\.view === view \? "page" : undefined\}/);
  assert.match(clientSource, /href="\/profile"/);
  assert.doesNotMatch(clientSource, /state\.view === "PROFILE"/);
  assert.match(clientSource, /primaryViews\.length === 4 \? "grid-cols-4" : "grid-cols-3"/);
});

test("landing, login, and empty Home tell one receipts-to-decision product story", () => {
  assert.match(landingSource, /One receipt is enough to begin/);
  assert.match(landingSource, /Decide before the obligation exists/);
  assert.match(loginSource, /Control desk/);
  assert.match(allSource, /Start with a cited bill/);
  assert.match(allSource, /Add a receipt. Now, Bills, and Sources hold cited evidence/);
  assert.doesNotMatch(landingSource, /Want it done for you\?/);
  assert.doesNotMatch(landingSource, /href="\/private-audit"/);
  assert.match(clientSource, />Vognary</);
  assert.match(landingSource, /No account required/);
  assert.match(landingSource, /No bank passwords/);
  assert.match(landingSource, /No mailbox access/);
  assert.match(landingSource, /AuthorizationLoop/);
  assert.match(landingSource, /No auto-approve, auto-deny, or vendor payment/);
  assert.doesNotMatch(landingSource, /redaction-first source plan|Private software renewal review/);
  assert.doesNotMatch(landingSource, /Set up billing forwarding once so matching mail keeps arriving/);
});

test("the decision card puts cited evidence and cycle memory on the same object as Keep / Review later / Plan to cancel", () => {
  assert.match(homeSource, /decision-merchant/);
  assert.match(homeSource, /decision-amount/);
  assert.match(homeSource, /chargeDueDisplay/);
  assert.match(homeSource, /inWindow \? <p className="decision-cue">/);
  assert.match(homeSource, /card\.excerpt/);
  assert.match(homeSource, /keepIsPrimary\(card\.reasonKeys\)/);
  assert.match(homeSource, /decisionHookCopy/);
  assert.match(homeSource, /customerPhrases\.seeCitedReceipt/);
  assert.match(homeSource, /customerPhrases\.rememberedThisCycle/);
  assert.match(homeSource, /Why a decision is needed now|whyThisNeedsAttention/);
  assert.match(allSource, /See the cited receipt/);
  assert.match(allSource, /Remembered for this billing cycle/);
  assert.match(homeSource, /queue\.map\(\(card, index\)/);
  assert.doesNotMatch(homeSource, /card=\{queue\[0\]!\}/);
  assert.doesNotMatch(homeSource, /citedEvidenceLine\(card\.evidenceIds\.length\)/);
});

test("home leads with the pre-renewal decision queue and cited spend activation", () => {
  for (const heading of ["Decide now", "Next charges", "What changed"]) {
    assert.ok(homeSource.includes(heading), `home must render ${heading}`);
  }
  assert.doesNotMatch(homeSource, /What we found/);
  assert.doesNotMatch(homeSource, /Currently committed/);
  assert.doesNotMatch(homeSource, /Receipts checked/);
  assert.doesNotMatch(homeSource, /Annualized estimate/);
  assert.match(homeSource, /onCitedPictureRendered/);
  assert.match(homeSource, /hasCitedRecurringSpendPicture/);
  assert.match(clientSource, /recordCitedPictureActivationWithRetry/);
  assert.match(clientSource, /workspaceActivationGate\.request\(workspaceId/);
  assert.doesNotMatch(clientSource, /activationAttemptedRef/);
  assert.match(clientSource, /onCitedPictureRendered=/);
  assert.doesNotMatch(addEvidenceSource, /recordWorkspaceActivation|onCitedPictureRendered/);
  assert.doesNotMatch(sourcesSource, /recordWorkspaceActivation|onCitedPictureRendered/);
  assert.match(homeSource, /SpendHero/);
  assert.doesNotMatch(homeSource, /<RecoveryAttention/);
  assert.doesNotMatch(homeSource, /FirstResultHome|showFirstResult/);
  assert.doesNotMatch(clientSource, /FIRST_RESULT_DISMISSED|onDismissFirstResult/);
  const quietHome = homeSource.slice(homeSource.indexOf("className=\"stack-page\""));
  assert.ok(quietHome.indexOf("<DecisionQueue") < quietHome.indexOf("<ComingLater"), "Decision queue must lead Coming later");
  assert.doesNotMatch(homeSource, /RecoveryAutopilotHome/);
  assert.match(homeSource, /Next charges/);
  assert.match(homeSource, /comingLaterItems\(home\)/);
  assert.doesNotMatch(homeSource, /home\.next\.map/);
  assert.match(homeSource, /No recurring amount yet/);
  assert.match(homeSource, /shouldShowRecentChange/);
  assert.doesNotMatch(homeSource, /WHAT NEEDS ME\?|WHAT CHANGED\?|WHAT HAPPENS NEXT\?|COVERAGE/);
  assert.doesNotMatch(homeSource, /TotalsStrip|Server totals|Compared version|No prior baseline/);
  assert.match(clientSource, /transport\.evidence\(/);
});

test("returning Home stays quiet unless a real change or attention item exists", () => {
  assert.match(allSource, /Set up receipt forwarding/);
  assert.doesNotMatch(homeSource, /Sheets go stale when new charges land/);
  assert.doesNotMatch(homeSource, /This is a floor from receipts checked, not every software bill\./);
  assert.doesNotMatch(homeSource, /home\.confidenceLayers/);
  assert.equal(confidenceLabels.HIGH, "Confirmed");
  assert.equal(confidenceLabels.MEDIUM, "Likely");
  assert.equal(confidenceLabels.LOW, "Needs review");
  assert.equal(confidenceLabels.UNKNOWN, "Unknown");
  assert.doesNotMatch(homeSource, /renderRecoveryShareText\(home\)/);
  assert.doesNotMatch(homeSource, /Copy summary/);
  assert.doesNotMatch(homeSource, /renderAuditReportShareText|buildAuditReport/);
});

test("an empty Home leads with adding bills, not Gmail setup", () => {
  assert.match(clientSource, /void loadSources\(\)/);
  assert.match(clientSource, /receiptInbox=\{state\.receiptInbox\}/);
  assert.match(allSource, /Start with a cited bill/);
  assert.match(allSource, /Add a receipt. Now, Bills, and Sources hold cited evidence/);
  assert.match(allSource, /No mailbox access required/);
  assert.match(clientSource, /onOpenSources=/);
  assert.doesNotMatch(homeSource, /Finish one-time billing setup/);
  assert.doesNotMatch(homeSource, /Set up receipt address/);
  assert.doesNotMatch(homeSource, /Add receipts manually/);
  assert.doesNotMatch(homeSource, /Your Vognary receipt address/);
  assert.doesNotMatch(homeSource, /Recommended first step/);
});

test("canonical Recovery advertises the receipt inbox only behind public launch readiness", () => {
  assert.match(appPageSource, /isReceiptInboxPubliclyAvailable/);
  assert.match(appPageSource, /receiptInboxPubliclyAvailable=\{receiptInboxPubliclyAvailable\}/);
  assert.match(experienceSource, /receiptInboxPubliclyAvailable/);
  assert.match(clientSource, /if \(!receiptInboxPubliclyAvailable\) return/);
  assert.match(homeSource, /receiptInboxPubliclyAvailable/);
  assert.match(sourcesSource, /if \(!receiptInboxPubliclyAvailable\)/);
  assert.match(sourcesSource, /Automatic forwarding is not available yet/);
});

test("one observation is coached toward a second matching receipt instead of rendering a false all-clear", () => {
  assert.match(clientSource, /commitmentTotal=\{state\.commitmentTotal\}/);
  assert.match(homeSource, /home\.coverage\.evidenceCount > 0 && commitmentTotal === 0/);
  for (const copy of [
    "Not enough history yet",
    "Add another from the same tool",
  ]) {
    assert.ok(homeSource.includes(copy), `one-observation Home must render ${copy}`);
  }
  assert.match(homeSource, /home\.recentObservations\.map/);
  assert.match(homeSource, /observation\.merchant/);
  assert.match(homeSource, /observation\.amount/);
  assert.match(allSource, /Drop bills or receipts here/);
  assert.match(addEvidenceSource, /Paste text/);
});

test("commitments ledger keeps decisions on Now and groups duplicate merchants", () => {
  assert.deepEqual(decisionLabels, {
    KEEP: "Keep",
    MONITOR: "Review later",
    DOWNGRADE: "Consider a cheaper plan",
    CANCEL: "Plan to cancel",
    INVESTIGATE: "I don’t recognize this",
  });
  assert.match(commitmentsSource, /groupCommitments/);
  assert.match(commitmentsSource, /decideOnNow/);
  assert.match(commitmentsSource, /presentExpectedObservation/);
  assert.match(commitmentsSource, /detail\.memory/);
  assert.doesNotMatch(commitmentsSource, /aria-label="Your choice"/);
  assert.doesNotMatch(commitmentsSource, />Your decision</);
  assert.doesNotMatch(commitmentsSource, />Evidence behind this</);
  assert.doesNotMatch(commitmentsSource, /Suggested:/);
});

test("Now leads decisions; Bills is cited evidence with orientation copy", () => {
  assert.match(homeSource, /customerPhrases\.decideNowIntro/);
  assert.match(homeSource, /data-decision-focus/);
  assert.match(homeSource, /aria-label="Your choice"/);
  assert.match(clientSource, /nowDecisionCount/);
  assert.match(clientSource, /view === "HOME" && nowDecisionCount > 0/);
  assert.match(clientSource, /customerPhrases\.billsLedgerHint/);
  assert.match(clientSource, /AuthorizationLoop/);
  assert.match(clientSource, /DECIDE_ON_NOW_REQUESTED/);
  assert.match(clientSource, /focusDecisionCommitmentId/);
  assert.doesNotMatch(clientSource, /Workspace id:/);
});

test("Sources keeps forwarding as stay-current infrastructure and paste as a manual action", () => {
  assert.ok(recoveryFiles.includes("recovery-sources.tsx"), "Recovery Sources view must exist");
  const sourcesSource = sourceOf("recovery-sources.tsx");
  for (const copy of [
    "Stay up to date",
    "Private billing inbox",
    "Add a bill manually",
    "Rotate address",
    "Stop receiving",
    "Disconnect source",
    "Reconnect source",
  ]) {
    assert.ok(allSource.includes(copy), `Sources must render ${copy}`);
  }
  assert.doesNotMatch(sourcesSource, /Sources are sensors/);
  assert.doesNotMatch(sourcesSource, /gmailOauthReady:\s*true/);
  assert.doesNotMatch(sourcesSource, /Connect Google|Connect Gmail|Connect Microsoft|Connect Zoho/i);
  assert.match(clientSource, /<RecoverySources/);
  assert.match(clientSource, /firstValue=\{workspaceEmpty\}/);
  assert.match(clientSource, /onDisconnectEvidenceSource/);
  assert.match(clientSource, /onReconnectEvidenceSource/);
  assert.match(clientSource, /ADD_BILLS_OPENED/);
  assert.match(clientSource, /window\.setInterval\(\(\) => void loadSources\(\), 10_000\)/);
  assert.match(clientSource, /state\.sourceStatus\.kind === "READY" && state\.refreshRequired[\s\S]*void loadSnapshot\(\)/);
  assert.match(clientSource, /state\.receiptInbox\?\.alias/);
  assert.match(inboundStoreSource, /and \(\$2::uuid is null or alias_id = \$2\)/);
  assert.doesNotMatch(clientSource, /workspaceEmpty && state\.view === "HOME"/);
});

test("Sources carries a user through billing-only forwarding and historical backfill", () => {
  const onboarding = `${sourcesSource}\n${billingSetupSource}`;
  for (const copy of [
    "Verify your private Vognary address",
    "Confirm Google's request",
    "Create a billing-only filter",
    "Leave &quot;Forward a copy of incoming mail to&quot; off",
    "Copy Gmail search",
    "Forward as attachment",
    "batches of up to 20",
    "Using Outlook?",
  ]) {
    assert.ok(onboarding.includes(copy), `Sources onboarding must render ${copy}`);
  }
  assert.match(billingSetupSource, /gmailForwardingHelpUrl|answer\/10957/);
  assert.match(billingSetupSource, /gmailFilterHelpUrl|answer\/6579/);
  assert.match(billingSetupSource, /gmailAttachmentHelpUrl|answer\/9261412/);
  assert.doesNotMatch(onboarding, /For each known billing sender/);
  assert.doesNotMatch(onboarding, /Forward billing emails manually, or use Gmail/);
});

test("rollback notices name every failed authority action instead of calling it evidence", () => {
  for (const label of [
    "signing the standing mandate",
    "revoking the standing mandate",
    "vetoing that Autopilot case",
    "disconnecting that evidence source",
    "reconnecting that evidence source",
  ]) {
    assert.ok(clientSource.includes(label), `Rollback copy must name ${label}`);
  }
  assert.match(clientSource, /function rollbackAttemptLabel/);
  assert.match(clientSource, /const exhaustive: never = mutation/);
});

test("customer confidence copy uses bounded words without publishing heuristic percentages", () => {
  assert.doesNotMatch(statesSource, /confidence\.score\}%|Score \$\{confidence\.score\}/);
  assert.match(statesSource, /confidence level/i);
});

test("the evidence inspector names sender trust without exposing raw mail headers", () => {
  for (const copy of [
    "Sender authentication",
    "Verified by the receiving provider",
    "Known sender",
    "Sender not verified",
    "Sender authentication raised concerns",
    "Receiving authority",
  ]) {
    assert.ok(evidencePanelsSource.includes(copy), `evidence inspector must render ${copy}`);
  }
  assert.match(evidencePanelsSource, /evidence\.senderTrust/);
  assert.match(evidencePanelsSource, /senderTrust\.fromDomain/);
  assert.match(evidencePanelsSource, /senderTrust\.trustedAuthority/);
  assert.match(evidencePanelsSource, /senderTrust\.reasons/);
  assert.doesNotMatch(evidencePanelsSource, /Authentication-Results|DKIM-Signature|fromAddress|displayName/);
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
  assert.equal(formatObservedInstant("2026-08-01T00:00:00.000Z", "2026-08-01"), null);
  assert.match(formatObservedInstant("2026-08-17T17:22:00.000Z", "2026-08-01") ?? "", /Recorded/);
});

test("evidence inspection exposes every fact the reader needs to check a rupee", () => {
  const panels = sourceOf("recovery-evidence-panels.tsx");
  for (const label of ["Observed fact (exact excerpt)", "Source", "Charge date", "Amount and currency", "Provenance", "Confidence and uncertainty"]) {
    assert.ok(panels.includes(label), `evidence inspection must show ${label}`);
  }
  assert.match(panels, /\{evidence\.excerpt\}/);
  assert.match(panels, /excerptTruncated/);
  assert.match(panels, /evidence\.source\.label/);
  assert.doesNotMatch(panels, /evidence\.provenance\.reference/);
  assert.doesNotMatch(panels, /unpublished start|unpublished end/);
  const inspector = panels.slice(panels.indexOf("export function EvidenceInspector"), panels.indexOf("function SenderTrust"));
  assert.doesNotMatch(inspector, /smallest unit|legacy-evidence/);
  assert.match(statesSource, /confidenceUncertainty\[confidence\.state\]/);
  assert.match(panels, /correction\.authoritativeAmount/);
  assert.doesNotMatch(panels, /Amount set to.*smallest currency unit/);
  assert.doesNotMatch(panels, /smallest unit of/);
  assert.match(panels, /Enter the amount a founder would read on the receipt/);
  const attention = sourceOf("recovery-attention.tsx");
  assert.match(attention, /Yes, they are the same/);
  assert.match(attention, /No, they are different/);
  assert.match(attention, /ANSWER_DUPLICATE/);
  assert.match(attention, /card.nextStep === "CONFIRM_SAME_SUBSCRIPTION"/);
});

test("motion is left to the token layer, so reduced motion is honoured globally", () => {
  assert.doesNotMatch(allSource, /scrollIntoView|requestAnimationFrame|behavior: "smooth"/);
  const globals = readFileSync("src/app/globals.css", "utf8");
  assert.match(globals, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(globals, /animation-duration: 0\.001ms !important/);
  assert.match(globals, /transition-duration: 0\.001ms !important/);
});
