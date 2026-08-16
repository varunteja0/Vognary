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
  assert.match(workspaceSource, /<ul className="grid grid-cols-4 gap-1 sm:flex sm:gap-2">/);
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

test("failed receipt states surface the last failure code without inventing a renewal", () => {
  assert.match(sourcesSource, /status\.lastFailureCode/);
  assert.match(sourcesSource, /no receipt could be read from it \(\$\{status\.lastFailureCode\}\)/);
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
