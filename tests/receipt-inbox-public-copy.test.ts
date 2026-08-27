import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const privacy = readFileSync("src/app/privacy/page.tsx", "utf8");
const security = readFileSync("src/app/security/page.tsx", "utf8");
const terms = readFileSync("src/app/terms/page.tsx", "utf8");

test("public trust copy states the verified inbound and identity boundaries", () => {
  for (const source of [privacy, security, terms]) {
    assert.match(source, /does not access or scan (?:Gmail|your mailbox)/i);
    assert.doesNotMatch(source, /up to 30 days|only messages you intentionally forward/i);
  }
  assert.match(privacy, /metadata-only webhook/i);
  assert.match(privacy, /cannot promise when provider-held copies are deleted/i);
  assert.match(security, /verified against the untouched request body/i);
  assert.match(terms, /does not itself cancel a service/i);
});

test("the displayed notice date and consent version move together", () => {
  assert.match(privacy, /21 August 2026/);
  assert.match(terms, /27 August 2026/);
  assert.match(readFileSync("src/lib/privacy-notice.ts", "utf8"), /privacy-2026-08-21/);
  assert.match(readFileSync("src/lib/pilot-offer.ts", "utf8"), /terms-2026-08-27/);
});
