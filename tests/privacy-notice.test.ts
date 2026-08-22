import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { currentPrivacyNoticeVersion } from "../src/lib/privacy-notice";
import { renewalAlertNoticeVersion } from "../src/lib/renewal-alerts";

test("current consent collection surfaces use the displayed Privacy Notice version", () => {
  assert.equal(currentPrivacyNoticeVersion, "privacy-2026-08-21");
  assert.equal(renewalAlertNoticeVersion, currentPrivacyNoticeVersion);
  for (const path of [
    "src/app/api/privacy/consents/route.ts",
    "src/app/api/waitlist/route.ts",
    "src/lib/server/recovery-inbound-store.ts",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /currentPrivacyNoticeVersion/, path);
    assert.doesNotMatch(source, /privacy-2026-0[78]-11/, path);
  }
});
