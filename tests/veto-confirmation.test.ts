import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  publicVetoConfirmationHtml,
  publicVetoRetryAllowed,
} from "../src/lib/recovery/veto-confirmation";

test("public veto confirmation is accessible HTML without the token or a stack trace", () => {
  const token = "secret-veto-token-value";
  for (const outcome of ["vetoed", "already-vetoed", "expired", "invalid", "rate-limited", "unavailable"] as const) {
    const html = publicVetoConfirmationHtml({ outcome });
    assert.match(html, /<!DOCTYPE html>/);
    assert.match(html, /<h1>/);
    assert.equal(html.includes(token), false);
    assert.doesNotMatch(html, /\{"/);
    assert.doesNotMatch(html, /Error:|at Object\./);
    if (outcome === "rate-limited" || outcome === "unavailable") {
      assert.match(html, /<form method="post" action=""/);
      assert.match(html, /Try again/);
    } else {
      assert.doesNotMatch(html, /Try again/);
    }
  }
  assert.equal(publicVetoRetryAllowed("vetoed"), false);
  assert.equal(publicVetoRetryAllowed("invalid"), false);
});

test("the public veto GET is a raw HTML shell without an RSC token prop", () => {
  const route = readFileSync("src/app/autopilot/veto/[token]/route.ts", "utf8");
  assert.doesNotMatch(route, /params|encodeURIComponent|action=/);
  assert.match(route, /window\.location\.pathname/);
  assert.match(route, /fetch\(\\`\/api\\\$\{path\}\\`/);
  assert.match(route, /method: "POST"/);
  assert.match(route, /result could not be confirmed/);
  assert.doesNotMatch(route, /Nothing was recorded/);
});
