import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { standingMandateSignedText } from "../src/lib/recovery/standing-mandate-text";

const mandateSource = readFileSync("src/app/workspace/recovery/recovery-mandate.tsx", "utf8");
const autopilotHomeSource = readFileSync("src/app/workspace/recovery/recovery-autopilot-home.tsx", "utf8");
const landingSource = readFileSync("src/app/launch-landing.tsx", "utf8");
const homeSource = readFileSync("src/app/workspace/recovery/recovery-home.tsx", "utf8");

test("mandate UI shows the exact signed text and does not claim execution is live", () => {
  assert.match(mandateSource, /from "@\/lib\/recovery\/standing-mandate-text"/);
  assert.doesNotMatch(mandateSource, /from "@\/lib\/recovery\/standing-mandate"/);
  assert.match(mandateSource, /standingMandateSignedText/);
  assert.match(mandateSource, /No merchant cancellation route is proven yet/);
  assert.match(mandateSource, /Execution stays off until the founder switch is on|Off — no cancellation is executed/);
  assert.match(mandateSource, /Operators cannot mark financial savings verified/);
  assert.match(mandateSource, /Attempt history|No operator attempts are on file/);
  assert.match(mandateSource, /founder\/internal-operator only/);
  assert.doesNotMatch(mandateSource, /Emergency disable/);
  assert.doesNotMatch(mandateSource, /money stops without chores|we cancelled|guaranteed savings/i);
});

test("exception-only home is honest about shadow mode and missing coverage", () => {
  assert.match(autopilotHomeSource, /Exception-only home/);
  assert.match(autopilotHomeSource, /Watching/);
  assert.match(autopilotHomeSource, /48-hour veto window/);
  assert.match(autopilotHomeSource, /Delivery pending/);
  assert.match(autopilotHomeSource, /Handled for you/);
  assert.match(autopilotHomeSource, /Needs your help/);
  assert.match(autopilotHomeSource, /Proof and savings/);
  assert.match(autopilotHomeSource, /Fees and refunds/);
  assert.match(autopilotHomeSource, />Mandate</);
  assert.match(autopilotHomeSource, /missing \$\{window\.currency\} coverage is not a zero saving/);
  assert.match(autopilotHomeSource, /Fee collection stays fail-closed|not charging — fail-closed/);
  assert.doesNotMatch(autopilotHomeSource, /money stops without chores/i);
  assert.doesNotMatch(autopilotHomeSource, /title="Connected"|Cancelled for you|Saved ₹|Paid in full/);
});

test("active mandate still publishes the first-value spend strip when no recurring amount is cited", () => {
  assert.ok(
    homeSource.indexOf("<RecoveryFirstValueMetrics") < homeSource.indexOf("<RecoveryAutopilotHome"),
    "cited spend metrics must render above the exception-only Autopilot home",
  );
  const metricsFn = homeSource.slice(homeSource.indexOf("function RecoveryFirstValueMetrics"));
  assert.match(metricsFn, /label="Monthly software spend"/);
  assert.match(metricsFn, /empty="No recurring amount yet"/);
  assert.doesNotMatch(metricsFn, /if \(!hasTotals\) return null/);
});

test("landing copy stays the audit generation; autopilot claims do not leak onto public pages", () => {
  assert.match(landingSource, /billing receipts you already have/);
  assert.doesNotMatch(landingSource, /standing mandate|Exception-only home|money stops without chores/i);
  assert.match(homeSource, /home\.autopilot\?\.mandate\?\.status === "ACTIVE"/);
});

test("signed mandate text is the frozen terms, not a paraphrase", () => {
  assert.match(standingMandateSignedText, /48-hour veto notice/);
  assert.match(standingMandateSignedText, /EMI, SIP, insurance, utilities, and cloud infrastructure cannot enter execution/);
  assert.match(standingMandateSignedText, /INR ₹50,000 per action/);
  assert.match(standingMandateSignedText, /INR ₹2,00,000 rolling 30-day ceiling/);
});

test("exception-only home never prints raw minor units and only calls a delivered clock a veto window", () => {
  assert.doesNotMatch(autopilotHomeSource, /minor units/);
  assert.match(autopilotHomeSource, /MoneyValue/);
  assert.match(autopilotHomeSource, /48-hour veto window/);
  assert.match(autopilotHomeSource, /Delivery pending/);
  const presentation = readFileSync("src/lib/recovery/notice-presentation.ts", "utf8");
  assert.match(presentation, /Delivery is pending/);
  assert.match(presentation, /no active veto countdown/);
  const mandate = readFileSync("src/app/workspace/recovery/recovery-mandate.tsx", "utf8");
  assert.match(mandate, /autopilotNoticeReadinessCopy\(noticeReadiness\.state\)/);
  const readiness = readFileSync("src/lib/recovery/notice-readiness.ts", "utf8");
  assert.doesNotMatch(readiness, /Enabled/);
  const store = readFileSync("src/lib/server/recovery-autopilot-store.ts", "utf8");
  assert.match(store, /deliveryProven: false/);
  assert.match(store, /credentialsPresent: Boolean\(autopilotVetoTokenSecret\(\)\)/);
  assert.match(store, /currency: row\.currency/);
  assert.match(store, /optionalSavingDto/);
});
