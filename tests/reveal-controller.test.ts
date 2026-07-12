import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("scroll reveal fails open for hidden tabs and observer misses", () => {
  const source = readFileSync(new URL("../src/app/reveal-controller.tsx", import.meta.url), "utf8");
  assert.match(source, /document\.visibilityState !== "visible"/);
  assert.match(source, /const revealAll/);
  assert.match(source, /window\.setTimeout\(revealAll, 2_000\)/);
  assert.match(source, /document\.addEventListener\("visibilitychange", visibilityChanged\)/);
});