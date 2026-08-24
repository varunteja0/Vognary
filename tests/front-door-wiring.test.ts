import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync("src/app/page.tsx", "utf8");
const landingSource = readFileSync("src/app/launch-landing.tsx", "utf8");
const landingPreviewSource = readFileSync("src/app/landing-decision-preview.tsx", "utf8");
const appPageSource = readFileSync("src/app/app/page.tsx", "utf8");
const experienceSource = readFileSync("src/app/app/experience-client.tsx", "utf8");
const loginSource = readFileSync("src/app/login/login-client.tsx", "utf8");
const layoutSource = readFileSync("src/app/layout.tsx", "utf8");

test("the public page is a cacheable readiness-neutral shell", () => {
  assert.match(pageSource, /export const revalidate = 3600/);
  assert.doesNotMatch(pageSource, /force-dynamic|isReceiptInboxPubliclyAvailable/);
});

test("the landing selects the guest-first proven entry path without instant-audit surfaces", () => {
  assert.match(landingSource, /const primaryHref = "\/start";/);
  assert.match(landingSource, /const primaryLabel = "Check a bill";/);
  assert.match(landingSource, /<LandingDecisionPreview \/>/);
  assert.doesNotMatch(landingSource, /sample|demo|InstantAudit|instant audit/i);
});

test("the landing states concise evidence and action boundaries without unsupported claims", () => {
  assert.match(landingSource, /No bank passwords/);
  assert.match(landingSource, /No mailbox access/);
  assert.match(landingPreviewSource, /From two example receipts/);
  assert.match(landingPreviewSource, /unsupported facts stay unknown/);
  assert.match(landingSource, /Vognary never cancels a service or moves money/);
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

  assert.match(metadataSource, /Vognary - Know what your company is committed to pay next/);
  assert.match(metadataSource, /Commitment Intelligence for founder-led 2–20 person software and AI companies/);
  assert.doesNotMatch(metadataSource, /\b(?:forward(?:ed|ing)?|Gmail|bank|UPI|cancel(?:s|led|ling|lation|lations)?)\b/i);
});
