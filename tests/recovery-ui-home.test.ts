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
  decisionLabels,
  decisionMeanings,
  decisionStamps,
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
const recoveryFiles = readdirSync(recoveryDir).filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));
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

test("primary navigation keeps Mandate hidden until delivery is proven or authority already exists", () => {
  assert.deepEqual([...recoveryViews], ["HOME", "COMMITMENTS", "ADD_EVIDENCE", "MANDATE"]);
  assert.deepEqual(Object.values(recoveryViewLabels), ["Home", "Commitments", "Sources", "Mandate"]);
  assert.match(clientSource, /<nav aria-label="Primary"/);
  assert.match(clientSource, /mandateAvailable/);
  assert.match(clientSource, /noticeReadiness\.state === "proven-ready"/);
  assert.match(clientSource, /primaryViews\.map/);
  assert.match(clientSource, /aria-current=\{state\.view === view \? "page" : undefined\}/);
  assert.match(clientSource, /href="\/profile"/);
  assert.doesNotMatch(clientSource, /state\.view === "PROFILE"/);
  assert.match(clientSource, /primaryViews\.length === 4 \? "grid-cols-4" : "grid-cols-3"/);
});

test("landing, login, and empty Home tell one receipts-to-decision product story", () => {
  for (const source of [landingSource, loginSource, homeSource]) {
    assert.match(source, /billing receipts you already have/);
  }
  assert.match(landingSource, /what renews next/);
  assert.match(loginSource, /what renews next/);
  assert.match(homeSource, /upcoming renewals and changes from the evidence/);
  assert.match(landingSource, /Want it done for you\?/);
  assert.match(landingSource, /href="\/private-audit"/);
  assert.match(clientSource, /Your commitments/);
  assert.match(landingSource, /No bank passwords\. No mailbox access\. You choose which billing text to add\./);
  assert.doesNotMatch(landingSource, /redaction-first source plan|Private software renewal review/);
  assert.doesNotMatch(landingSource, /Set up billing forwarding once so matching mail keeps arriving/);
});

test("home leads with action, only shows real changes, and keeps source freshness compact", () => {
  for (const heading of ["What we found", "Decisions worth reviewing", "Needs attention", "Since your last visit", "Coming up", "Currently committed", "Receipts checked"]) {
    assert.ok(homeSource.includes(heading), `home must render ${heading}`);
  }
  for (const label of ["Monthly recurring amount", "Annualized estimate", "Next 30 days", "Active commitments", "Needs review"]) {
    assert.ok(homeSource.includes(label), `home must render ${label}`);
  }
  assert.match(homeSource, /home\.annualizedEstimateTotals/);
  assert.match(homeSource, /home\.activeCommitmentCount/);
  assert.match(homeSource, /home\.reviewItemCount/);
  assert.match(homeSource, /12 × the cited monthly equivalent from receipts\. It is not a historical yearly total\./);
  assert.match(homeSource, /12 × the cited monthly equivalent, including a saved correction\. It is not a historical yearly total\./);
  assert.match(homeSource, /projectionAmountProvenanceLabels\[total\.provenance\]/);
  assert.equal(projectionAmountProvenanceLabels.RECEIPT, "From checked receipts only.");
  assert.equal(projectionAmountProvenanceLabels.USER_CORRECTED, "Includes a saved correction.");
  assert.match(homeSource, /onCitedPictureRendered/);
  assert.match(homeSource, /hasCitedRecurringSpendPicture/);
  assert.match(clientSource, /recordCitedPictureActivationWithRetry/);
  assert.match(clientSource, /workspaceActivationGate\.request\(workspaceId/);
  assert.doesNotMatch(clientSource, /activationAttemptedRef/);
  assert.match(clientSource, /onCitedPictureRendered=/);
  assert.doesNotMatch(addEvidenceSource, /recordWorkspaceActivation|onCitedPictureRendered/);
  assert.doesNotMatch(sourcesSource, /recordWorkspaceActivation|onCitedPictureRendered/);
  assert.match(homeSource, /RecoveryFirstValueMetrics/);
  assert.match(homeSource, /RecoveryProjectionDetails/);
  assert.match(homeSource, /<RecoveryAttention/);
  const populatedHome = homeSource.slice(homeSource.indexOf("<WhatWeFound"));
  const lastVisitIndex = populatedHome.indexOf('aria-labelledby="recovery-changed"');
  const graphChangesIndex = populatedHome.indexOf("<RecoveryAttention");
  const populatedNeedsAttentionIndex = populatedHome.indexOf('aria-labelledby="recovery-needs-me"');
  assert.ok(lastVisitIndex >= 0 && lastVisitIndex < graphChangesIndex, "returning-user last-visit changes must lead graph-backed What changed");
  assert.ok(graphChangesIndex >= 0 && graphChangesIndex < populatedNeedsAttentionIndex, "graph-backed What changed must lead Needs attention");
  const needsAttentionIndex = homeSource.indexOf('aria-labelledby="recovery-needs-me"');
  const secondaryProjectionIndexes = [...homeSource.matchAll(/<RecoveryProjectionDetails/g)].map((match) => match.index);
  assert.ok(
    secondaryProjectionIndexes.some((index) => index > needsAttentionIndex),
    "Needs attention must appear before annualized and next-30 secondary figures",
  );
  assert.ok(
    homeSource.indexOf("<RecoveryAutopilotHome") < homeSource.indexOf("<RecoveryFirstValueMetrics"),
    "active Autopilot actions must render above cited spend metrics",
  );
  assert.match(homeSource, /coverageLabels\[home\.coverage\.state\]/);
  assert.match(homeSource, /coverageMeanings\[home\.coverage\.state\]/);
  const mandateBranch = homeSource.slice(
    homeSource.indexOf("home.autopilot?.mandate?.status === \"ACTIVE\""),
    homeSource.indexOf("if (home.coverage.evidenceCount > 0 && commitmentTotal === 0)"),
  );
  assert.match(mandateBranch, /UpcomingTimeline/);
  assert.match(mandateBranch, /home=\{home\}/);
  assert.match(homeSource, /Coming up/);
  assert.match(homeSource, /home\.next/);
  const metricsFn = homeSource.slice(homeSource.indexOf("function RecoveryFirstValueMetrics"));
  assert.match(metricsFn, /No recurring amount yet/);
  assert.doesNotMatch(
    metricsFn,
    /if \(!hasTotals\) return null/,
    "an active mandate must still publish Monthly recurring amount when no recurring amount is cited",
  );
  assert.match(homeSource, /home\.changed\.state === "COMPARED"/);
  assert.doesNotMatch(homeSource, /WHAT NEEDS ME\?|WHAT CHANGED\?|WHAT HAPPENS NEXT\?|COVERAGE/);
  assert.doesNotMatch(homeSource, /TotalsStrip|Server totals|Compared version|No prior baseline/);
  assert.match(homeSource, /onInspectEvidence/);
  assert.match(homeSource, /item\.evidenceIds\[0\]/);
  assert.match(homeSource, /item\.provenance\.evidenceIds\[0\]/);
  assert.match(clientSource, /transport\.evidence\(/);
});

test("returning Home leads with last-visit changes, then graph-backed changes, and exports only the Recovery projection", () => {
  const populatedHome = homeSource.slice(homeSource.indexOf("<WhatWeFound"));
  assert.ok(populatedHome.indexOf("Since your last visit") < populatedHome.indexOf("<RecoveryAttention"));
  assert.ok(populatedHome.indexOf("<RecoveryAttention") < populatedHome.indexOf("Needs attention"));
  assert.match(homeSource, /Keep this current/);
  assert.doesNotMatch(homeSource, /Sheets go stale when new charges land/);
  assert.match(homeSource, /This is a floor from receipts checked, not every debit in India\./);
  assert.match(homeSource, /home\.confidenceLayers/);
  assert.match(homeSource, /confidenceTruthLayerLabels\[layer\.layer\]/);
  assert.equal(confidenceLabels.HIGH, "Confirmed");
  assert.equal(confidenceLabels.MEDIUM, "Likely");
  assert.equal(confidenceLabels.LOW, "Needs review");
  assert.equal(confidenceLabels.UNKNOWN, "Unknown");
  assert.match(homeSource, /listed twice/);
  assert.match(homeSource, /renderRecoveryShareText\(home\)/);
  assert.match(homeSource, /Copy for WhatsApp/);
  assert.doesNotMatch(homeSource, /renderAuditReportShareText|buildAuditReport/);
});

test("an empty Home leads with adding bills, not Gmail setup", () => {
  assert.match(clientSource, /void loadSources\(\)/);
  assert.match(clientSource, /receiptInbox=\{state\.receiptInbox\}/);
  assert.match(homeSource, /Add a few recent software bills/);
  assert.match(homeSource, /reconstruct your current commitments, upcoming renewals and changes/);
  assert.match(homeSource, /Keep Vognary current later/);
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
    "Paste 2–5 recent software bills, invoices, or billing emails",
    "Prefer more than one vendor, and two records from the same vendor",
    "Vognary reconstructs current commitments, upcoming renewals, and changes only when the evidence supports them",
  ]) {
    assert.ok(addEvidenceSource.includes(step), `first-value guide must render ${step}`);
  }
});

test("commitments use ordinary language and three primary choices", () => {
  assert.deepEqual(decisionLabels, {
    KEEP: "Keep",
    MONITOR: "Review",
    DOWNGRADE: "Consider a cheaper plan",
    CANCEL: "Plan to cancel",
    INVESTIGATE: "I don’t recognize this",
  });
  assert.match(commitmentsSource, /const primaryDecisions = \["KEEP", "CANCEL", "MONITOR"\]/);
  assert.match(commitmentsSource, /What do you want to do\?/);
  assert.match(commitmentsSource, /Planning to cancel records your intent; Vognary does not cancel the service\./);
  assert.match(commitmentsSource, /Why Vognary thinks this/);
  assert.match(commitmentsSource, /Expected vs observed/);
  assert.match(commitmentsSource, /Amount history/);
  assert.match(commitmentsSource, /Absence is not treated as cancellation/);
  assert.match(commitmentsSource, /detail\.expectation/);
  assert.match(commitmentsSource, /detail\.memory/);
  assert.doesNotMatch(commitmentsSource, />Your decision</);
  assert.doesNotMatch(commitmentsSource, />Evidence behind this</);
});

test("Sources keeps forwarding as stay-current infrastructure and paste as the empty-workspace first action", () => {
  assert.ok(recoveryFiles.includes("recovery-sources.tsx"), "Recovery Sources view must exist");
  const sourcesSource = sourceOf("recovery-sources.tsx");
  for (const copy of [
    "Your Vognary receipt address",
    "Vognary never accesses or scans your inbox",
    "Create receipt address",
    "Waiting for a receipt",
    "Receipt received",
    "Looking for renewals",
    "Matching billing mail should arrive on its own",
    "Rotate address",
    "Stop receiving",
    "Add more bills",
    "Keep Vognary current",
    "How Vognary stays current",
    "If Gmail sends a confirmation challenge",
    "Planned sources are listed honestly and cannot be connected",
  ]) {
    assert.ok(sourcesSource.includes(copy), `Sources must render ${copy}`);
  }
  assert.doesNotMatch(sourcesSource, /Sources are sensors/);
  assert.doesNotMatch(sourcesSource, /gmailOauthReady:\s*true/);
  assert.match(sourcesSource, /availability === "SETUP" \? "pill pill-partial"/);
  assert.doesNotMatch(sourcesSource, /Connect Google|Connect Gmail|Connect Microsoft|Connect Zoho/i);
  assert.match(clientSource, /<RecoverySources/);
  assert.match(clientSource, /firstValue=\{workspaceEmpty\}/);
  assert.match(clientSource, /keepCurrentOpen=\{keepCurrentOpen\}/);
  assert.match(clientSource, /onDisconnectEvidenceSource/);
  assert.match(clientSource, /onReconnectEvidenceSource/);
  assert.match(sourcesSource, /Disconnect source/);
  assert.match(sourcesSource, /Reconnect source/);
  assert.match(sourcesSource, /stops it supporting future facts/);
  assert.match(sourcesSource, /withdraws affected queued Autopilot cases/);
  assert.match(sourcesSource, /does not rotate the receipt address/);
  assert.match(sourcesSource, /old notice, 48-hour clock, or authorization is never restored/);
  assert.doesNotMatch(sourcesSource, /Nothing is connected|does not currently surface|do not use this address/i);
  assert.match(clientSource, /manualFallback=\{/);
  assert.match(clientSource, /window\.setInterval\(\(\) => void loadSources\(\), 10_000\)/);
  assert.match(clientSource, /state\.sourceStatus\.kind === "READY" && state\.refreshRequired[\s\S]*void loadSnapshot\(\)/);
  assert.match(clientSource, /state\.receiptInbox\?\.alias/);
  assert.match(sourcesSource, /Source update failed/);
  assert.match(inboundStoreSource, /and \(\$2::uuid is null or alias_id = \$2\)/);
  assert.doesNotMatch(clientSource, /workspaceEmpty && state\.view === "HOME"/);
});

test("Sources carries a user through billing-only forwarding and historical backfill", () => {
  const onboarding = `${sourcesSource}\n${billingSetupSource}`;
  for (const copy of [
    "Address ready",
    "Verify the forwarding address",
    "Keep global forwarding disabled",
    "Create one billing-only Gmail filter",
    "Forward it to",
    "Filters affect new matching mail only",
    "Forward as attachment",
    "batches of up to 20",
    "Gmail address verified",
    "First matching billing email received",
    "Historical backfill complete",
    "Copy Gmail search",
  ]) {
    assert.ok(onboarding.includes(copy), `Sources onboarding must render ${copy}`);
  }
  assert.match(billingSetupSource, /receiptInbox\.setupCompletedAt/);
  assert.match(billingSetupSource, /receiptInbox\.forwardingVerifiedAt/);
  assert.match(billingSetupSource, /receiptInbox\.backfillCompletedAt/);
  assert.match(billingSetupSource, /gmailForwardingHelpUrl|answer\/10957/);
  assert.match(billingSetupSource, /gmailFilterHelpUrl|answer\/6579/);
  assert.match(billingSetupSource, /gmailAttachmentHelpUrl|answer\/9261412/);
  assert.match(billingSetupSource, /Leave &quot;Forward a copy of incoming mail to&quot; off/);
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
