import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { currentPrivacyNoticeVersion } from "../src/lib/privacy-notice";
import { renewalAlertNoticeVersion } from "../src/lib/renewal-alerts";

test("current consent collection surfaces use the displayed Privacy Notice version", () => {
  assert.equal(currentPrivacyNoticeVersion, "privacy-2026-07-13");
  assert.equal(renewalAlertNoticeVersion, currentPrivacyNoticeVersion);
  for (const path of [
    "src/app/api/audit-intake/route.ts",
    "src/app/api/connectors/[id]/start/route.ts",
    "src/app/api/integrations/gmail/callback/route.ts",
    "src/app/api/privacy/consents/route.ts",
    "src/app/api/waitlist/route.ts",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /currentPrivacyNoticeVersion/, path);
    assert.doesNotMatch(source, /privacy-2026-07-11/, path);
  }
});