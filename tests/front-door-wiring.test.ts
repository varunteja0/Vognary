import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync("src/app/page.tsx", "utf8");
const landingSource = readFileSync("src/app/launch-landing.tsx", "utf8");
const sheetSource = readFileSync("src/app/record-sheet.tsx", "utf8");
const shellSource = readFileSync("src/app/public-shell.tsx", "utf8");
const workSource = readFileSync("src/app/desk-strip.tsx", "utf8");
const appPageSource = readFileSync("src/app/app/page.tsx", "utf8");
const experienceSource = readFileSync("src/app/app/experience-client.tsx", "utf8");
const loginSource = readFileSync("src/app/login/login-client.tsx", "utf8");
const layoutSource = readFileSync("src/app/layout.tsx", "utf8");
const publicFront = [landingSource, sheetSource, shellSource, workSource].join("\n");

test("the public page is a cacheable readiness-neutral shell", () => {
  assert.match(pageSource, /export const revalidate = 3600/);
  assert.doesNotMatch(pageSource, /force-dynamic|isReceiptInboxPubliclyAvailable/);
});

test("the landing leads with the decision and keeps the guest evidence path second", () => {
  // One primary command to the demonstration, one quiet secondary to the
  // visitor's own evidence. The rejected hero form is gone for good.
  assert.match(landingSource, /href="\/demo" className="btn btn-primary btn-lg"/);
  assert.match(landingSource, /href="\/start" className="home-quiet"/);
  assert.match(landingSource, /href="\/pay" prefetch=\{false\}/);
  assert.doesNotMatch(landingSource, /LandingDecisionPreview|LandingSignalRail|control-index/);
  assert.doesNotMatch(landingSource, /<form|<input|<textarea/);
  // The product is above the promise-copy, not an abstract diagram: the first
  // band renders the canonical record itself.
  assert.match(landingSource, /<RequestSheet/);
  assert.ok(
    landingSource.indexOf("<RequestSheet") < landingSource.indexOf("home-freeze"),
    "the live request appears in the first band, before the explanatory band",
  );
  // The rejected visual era does not come back through a side door.
  assert.doesNotMatch(publicFront, /AuthorityField|authority-field|home-field-narrative/);
  // The public shell offers exactly one primary command plus one menu, so a
  // phone header can never crowd three text buttons beside the brand.
  assert.match(shellSource, /pshell-primary/);
  assert.match(shellSource, /pshell-menu-button/);
  assert.match(shellSource, /aria-haspopup="dialog"/);
  // The retired sample/instant-audit surfaces stay gone, and the landing never
  // calls anything a "demo" in visible copy — the route it links to labels
  // itself a synthetic demonstration on every frame.
  assert.doesNotMatch(landingSource, /sample|InstantAudit|instant audit/i);
  assert.doesNotMatch(landingSource, />[^<]*\bdemos?\b[^<]*</i);
});

test("the landing states concise evidence and action boundaries without unsupported claims", () => {
  // Every boundary survives the redesign. They are now stated where they answer
  // a live concern rather than as a column of limitations in the first viewport.
  assert.match(publicFront, /never needs your bank\s*\n?\s*password or your mailbox/i);
  assert.match(publicFront, /never auto-approves, purchases, provisions or moves money/);
  assert.match(publicFront, /It never decides|No auto-approval/);
  assert.match(publicFront, /It never moves money/);
  assert.match(publicFront, /Payment is not activation/);
  // The desk is labelled synthetic and cannot be mistaken for customer activity.
  assert.match(workSource, /SYNTHETIC_DEMO_LABEL|SyntheticStamp/);
  assert.match(workSource, /there is no\s+\*?\s*total, no saving, no risk number/);
  // Nothing on the public front derives money; it renders canonical components.
  assert.match(workSource, /MoneyValue/);
  assert.match(sheetSource, /MoneyValue/);
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

  assert.match(metadataSource, /Vognary - Commitment Control for India-first AI companies/);
  assert.match(metadataSource, /Commitment Control for India-first 20–100 person AI-native companies/);
  assert.doesNotMatch(metadataSource, /\b(?:forward(?:ed|ing)?|Gmail|bank|UPI|cancel(?:s|led|ling|lation|lations)?)\b/i);
});
