import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync("src/app/page.tsx", "utf8");
const landingSource = readFileSync("src/app/launch-landing.tsx", "utf8");
const appPageSource = readFileSync("src/app/app/page.tsx", "utf8");
const experienceSource = readFileSync("src/app/app/experience-client.tsx", "utf8");
const loginSource = readFileSync("src/app/login/login-client.tsx", "utf8");
const layoutSource = readFileSync("src/app/layout.tsx", "utf8");

test("the public page resolves receipt inbox readiness at request time", () => {
  assert.match(pageSource, /export const dynamic = "force-dynamic"/);
  assert.match(pageSource, /receiptInboxAvailable=\{await isReceiptInboxPubliclyAvailable\(\)\}/);
});

test("the landing selects the proven entry path without demo or instant-audit surfaces", () => {
  assert.match(landingSource, /const primaryHref = "\/login\?next=\/app";/);
  assert.match(landingSource, /const primaryLabel = "See my commitments";/);
  assert.doesNotMatch(landingSource, /sample|demo|InstantAudit|instant audit/i);
});

test("the landing states the inbound and retention boundaries without unsupported claims", () => {
  assert.match(landingSource, /Messages sent to your private Vognary address are processed as receipt evidence/);
  assert.match(landingSource, /Provider-held email copies follow Resend's own retention schedule and are not immediately deletable by Vognary/);
  assert.doesNotMatch(landingSource, /30 days/i);
  assert.doesNotMatch(landingSource, /only billing evidence you intentionally forward/i);
  assert.doesNotMatch(landingSource, /Gmail/i);
  assert.doesNotMatch(landingSource, /(?:bank|UPI)[^.\n]{0,60}(?:connect|sync|scan|access|read)|(?:connect|sync|scan|access|read)[^.\n]{0,60}(?:bank|UPI)/i);
  assert.doesNotMatch(landingSource, /verified savings/i);
  assert.doesNotMatch(landingSource, /(?:automatic|automated|automation)[^.\n]{0,40}cancel|cancel[^.\n]{0,40}(?:automatic|automated|automation)/i);
});

test("the app route is signed-only and strips retired guest query modes", () => {
  assert.match(appPageSource, /Object\.hasOwn\(params, "demo"\).*Object\.hasOwn\(params, "guest"\)/);
  assert.match(appPageSource, /if \(!session\) redirect\("\/login\?next=\/app"\)/);
  assert.doesNotMatch(experienceSource, /GuestAuditClient|gmailConnect/);
});

test("login presents Google only as sign-in and exposes one primary Google action", () => {
  assert.match(loginSource, /Google is only for sign-in\. Vognary does not access Gmail\./);
  assert.equal((loginSource.match(/Continue with Google/g) ?? []).length, 1);
});

test("static layout metadata remains readiness-neutral", () => {
  const metadataStart = layoutSource.indexOf("export const metadata");
  const metadataEnd = layoutSource.indexOf("export const viewport");
  assert.ok(metadataStart >= 0 && metadataEnd > metadataStart);
  const metadataSource = layoutSource.slice(metadataStart, metadataEnd);

  assert.match(metadataSource, /Vognary - Know what your company is already committed to/);
  assert.match(metadataSource, /Commitment Intelligence for 2–20 person software teams/);
  assert.doesNotMatch(metadataSource, /\b(?:forward(?:ed|ing)?|Gmail|bank|UPI|cancel(?:s|led|ling|lation|lations)?)\b/i);
});
