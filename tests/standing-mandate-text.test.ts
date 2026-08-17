import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  hashStandingMandateText,
  standingMandateSignedText,
  standingMandateTermsVersion,
  standingMandateTextHash,
} from "../src/lib/recovery/standing-mandate";
import {
  defaultPerActionCeilingMinor,
  defaultRolling30dCeilingMinor,
  formatStandingMandateCeiling,
  standingMandateCurrency,
} from "../src/lib/recovery/standing-mandate-text";

test("signed mandate text, terms version, and hash agree and name both INR ceilings", () => {
  assert.equal(standingMandateTermsVersion, "standing-mandate-2026-08-16");
  assert.equal(formatStandingMandateCeiling(defaultPerActionCeilingMinor, standingMandateCurrency), "INR ₹50,000");
  assert.equal(formatStandingMandateCeiling(defaultRolling30dCeilingMinor, standingMandateCurrency), "INR ₹2,00,000");
  assert.match(standingMandateSignedText, /INR ₹50,000 per action/);
  assert.match(standingMandateSignedText, /INR ₹2,00,000 rolling 30-day ceiling/);
  assert.equal(hashStandingMandateText(standingMandateSignedText), standingMandateTextHash());
  assert.equal(
    standingMandateTextHash(),
    createHash("sha256").update(standingMandateSignedText).digest("hex"),
  );
  const textSource = readFileSync("src/lib/recovery/standing-mandate-text.ts", "utf8");
  assert.doesNotMatch(textSource, /node:crypto|server-only/);
  const hashSource = readFileSync("src/lib/recovery/standing-mandate.ts", "utf8");
  assert.match(hashSource, /import "server-only"/);
  assert.match(hashSource, /from "node:crypto"/);
  const mandateUi = readFileSync("src/app/workspace/recovery/recovery-mandate.tsx", "utf8");
  assert.match(mandateUi, /from "@\/lib\/recovery\/standing-mandate-text"/);
  assert.doesNotMatch(mandateUi, /from "@\/lib\/recovery\/standing-mandate"/);
});
