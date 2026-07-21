import assert from "node:assert/strict";
import test from "node:test";
import { ALLOWED_FILES, KNOWN_EXCEPTIONS, WP4_DEFERRED, scanContent } from "../scripts/check-design-tokens.mjs";

test("flags a complete raw hex colour with its line number", () => {
  const violations = scanContent("src/app/example.tsx", 'const a = 1;\nconst c = "#d8b87a";');
  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, "raw-hex-color");
  assert.equal(violations[0].line, 2);
  assert.equal(violations[0].text, "#d8b87a");
});

test("does not mistake an anchor href fragment for a hex colour", () => {
  const violations = scanContent("src/app/example.tsx", '<a href="#add-source">Add</a>');
  assert.equal(violations.length, 0);
});

test("flags raw colour functions but leaves color-mix alone", () => {
  const flagged = scanContent("src/app/example.tsx", 'const s = "rgba(0,0,0,0.5)";');
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].rule, "raw-color-function");
  const composed = scanContent("src/app/example.tsx", 'const s = "color-mix(in srgb, var(--gold) 40%, transparent)";');
  assert.equal(composed.length, 0);
});

test("flags quoted dimension literals inside inline style blocks only", () => {
  const flagged = scanContent("src/app/example.tsx", '<p style={{ fontSize: "0.58rem" }}>x</p>');
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].rule, "inline-dimension-literal");
  const tokenised = scanContent("src/app/example.tsx", '<p style={{ color: "var(--muted)", lineHeight: 1.2 }}>x</p>');
  assert.equal(tokenised.length, 0);
});

test("honours full-file exemptions and the WP4 quarantine", () => {
  for (const file of [...ALLOWED_FILES, ...WP4_DEFERRED]) {
    assert.deepEqual(scanContent(file, 'const bad = "#123456";'), [], `${file} should be exempt`);
  }
});

test("honours narrowly-scoped known exceptions without exempting the whole file", () => {
  const google = KNOWN_EXCEPTIONS.find((entry) => entry.file === "src/app/login/login-client.tsx");
  assert.ok(google, "google brand exception must exist");
  const allowed = scanContent(google.file, 'fill="#4285F4"');
  assert.equal(allowed.length, 0);
  const stillFlagged = scanContent(google.file, 'const stray = "#deadbe";');
  assert.equal(stillFlagged.length, 1, "non-excepted literals in the same file still fail");
});
