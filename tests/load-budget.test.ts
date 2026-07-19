import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../scripts/check-load-budget.mjs", import.meta.url), "utf8");

test("load budget owns the exact audit and maximum-size PDF release profile", () => {
  assert.match(source, /auditRequestsPerSecond = 200/);
  assert.match(source, /auditDurationSeconds = 10/);
  assert.match(source, /auditP95BudgetMs = 300/);
  assert.match(source, /ingestConcurrency = 20/);
  assert.match(source, /pdfBytes = 8 \* 1024 \* 1024/);
  assert.match(source, /response\.status !== 200/);
  assert.match(source, /audit\.p95Ms >= auditP95BudgetMs/);
  assert.match(source, /buildReadablePdf/);
  assert.match(source, /Readable Vognary load-test statement/);
});

test("load budget cannot target production or another remote host", () => {
  assert.match(source, /assertLoopbackTarget\(target\)/);
  assert.doesNotMatch(source, /ALLOW_REMOTE|allowRemote/);
  const result = spawnSync(process.execPath, ["scripts/check-load-budget.mjs", "http://www.vognary.com"], {
    cwd: new URL("../", import.meta.url),
    env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" },
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /refuses non-loopback targets/);
});
