import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const recoveryDir = "src/app/workspace/recovery";
const workspaceSource = readFileSync(`${recoveryDir}/recovery-workspace-client.tsx`, "utf8");
const sourcesSource = readFileSync(`${recoveryDir}/recovery-sources.tsx`, "utf8");
const homeSource = readFileSync(`${recoveryDir}/recovery-home.tsx`, "utf8");
const sourcesRoute = readFileSync("src/app/api/workspaces/current/sources/route.ts", "utf8");
const inboundStore = readFileSync("src/lib/server/recovery-inbound-store.ts", "utf8");

test("the workspace wires Sources and delegates account settings to the profile route", () => {
  assert.match(workspaceSource, /import \{ RecoverySources \} from "\.\/recovery-sources"/);
  assert.match(workspaceSource, /<RecoverySources/);
  assert.match(workspaceSource, /href="\/profile"/);
  assert.match(workspaceSource, /primaryViews.length === 4 \? "grid-cols-4" : "grid-cols-3"/);
  assert.doesNotMatch(workspaceSource, /grid-cols-5/);
  assert.doesNotMatch(workspaceSource, /RecoveryProfile/);
  assert.doesNotMatch(workspaceSource, /\bPROFILE\b/);
});

test("Sources fails closed on authentication and preserves every fallback control", () => {
  assert.match(sourcesSource, /import \{ AuthRequiredBlock, LoadingBlock, StateBlock \}/);
  assert.match(sourcesSource, /sourceStatus\.kind === "AUTH_REQUIRED" \? \([\s\S]*?<AuthRequiredBlock \/>/);
  assert.match(sourcesSource, /Manual fallback/);
  assert.match(sourcesSource, /onRotate/);
  assert.match(sourcesSource, /Rotate address/);
  assert.match(sourcesSource, /onRevoke/);
  assert.match(sourcesSource, /Stop receiving/);
});

test("Sources stays available for manual evidence when receipt forwarding is not configured", () => {
  assert.match(sourcesRoute, /configurationRequired: false/);
  assert.match(inboundStore, /state: "UNAVAILABLE"/);
  assert.match(sourcesSource, /receiptInbox\?\.state === "UNAVAILABLE"/);
  assert.match(sourcesSource, /Use the manual fallback below/);
});

test("Sources describes forwarding without pretending sender intent or inbox access is enforced", () => {
  assert.doesNotMatch(sourcesSource, /only messages you choose to send/i);
  assert.doesNotMatch(sourcesSource, /(?:Vognary|we) (?:access|scan|read|monitor)s? your inbox/i);
  assert.match(sourcesSource, /Messages sent to that private address are processed as receipt evidence/);
});

test("Sources translates internal source kinds and classification state into customer language", () => {
  assert.match(sourcesSource, /sourceLabels\[source\.kind\]/);
  assert.doesNotMatch(sourcesSource, /\{source\.kind\}/);
  assert.doesNotMatch(sourcesSource, /not in the current classification/);
  assert.match(sourcesSource, /not currently supporting a commitment/);
});

test("failed receipt states surface the last failure code without inventing a renewal", () => {
  assert.match(sourcesSource, /status\.lastFailureCode/);
  assert.match(sourcesSource, /no receipt could be read from it \(\$\{status\.lastFailureCode\}\)/);
});

test("a Gmail forwarding confirmation is not rendered as a failed billing receipt", () => {
  assert.match(sourcesSource, /if \(status\.gmailVerification\) return null;/);
  assert.match(sourcesSource, /receiptInbox\.state === "READY" && !receiptInbox\.gmailVerification/);
  assert.match(readFileSync("src/app/workspace/recovery/recovery-billing-setup.tsx", "utf8"), /GmailForwardingConfirmation/);
  assert.match(readFileSync("src/app/workspace/recovery/recovery-gmail-confirmation.tsx", "utf8"), /Confirm forwarding with Google/);
});

test("the canonical Home keeps server-published action and coverage fields", () => {
  assert.match(homeSource, /home\.needsMe/);
  assert.match(homeSource, /home\.next/);
  assert.match(homeSource, /home\.coverage/);
});

test("the canonical Home renders server totals without doing money math itself", () => {
  assert.match(homeSource, /home\.monthlyTotals/);
  assert.match(homeSource, /home\.next30DayTotals/);
  assert.doesNotMatch(homeSource, /\.reduce\(|BigInt\(|parseFloat\(|Number\(/);
});

test("Source Hub does not style an unconnected billing inbox as already connected", () => {
  assert.match(sourcesSource, /availability === "SETUP" \? "pill pill-partial"/);
  assert.doesNotMatch(sourcesSource, /availability === "CONNECTED" \|\| entry\.availability === "SETUP"/);
  assert.doesNotMatch(sourcesSource, /Connect Google|Connect Gmail|Connect Microsoft|Connect Zoho/i);
});
