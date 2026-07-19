import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../scripts/check-release-gate.mjs", import.meta.url), "utf8");

test("release gate keeps tests off production data and owns every ship-blocking proof", () => {
  assert.match(source, /RELEASE_DATABASE_URL/);
  assert.match(source, /releaseDatabaseIdentity !== productionDatabaseIdentity/);
  assert.match(source, /databaseIdentity/);
  assert.match(source, /RELEASE_CONFIRM_DISPOSABLE/);
  assert.match(source, /baseEnvironment\.DATABASE_URL = ""/);
  assert.match(source, /sanitizeLocalEnvironment/);
  assert.match(source, /readLocalEnvironmentNames/);
  assert.match(source, /output\[name\] = ""/);
  assert.match(source, /"GOOGLE_"/);
  assert.match(source, /"RAZORPAY_"/);
  assert.match(source, /PLAYWRIGHT_EXTERNAL_SERVER: "1"/);
  assert.match(source, /VOGNARY_E2E_EVIDENCE_DIR: "output\/release-evidence"/);
  assert.match(source, /\["run", "ci"\]/);
  assert.match(source, /\["run", "ci:database"\]/);
  assert.match(source, /\["run", "test:e2e"\]/);
  assert.match(source, /\["run", "corpus:strict"\]/);
  assert.match(source, /\["run", "receipt-corpus:strict"\]/);
  assert.match(source, /scripts\/smoke-test\.mjs/);
  assert.match(source, /scripts\/check-load-budget\.mjs/);
  assert.match(source, /delete from rate_limit_buckets/);
  assert.match(source, /scripts\/check-production-activation\.mjs", target, "--strict"/);
  assert.doesNotMatch(source, /shell:\s*true/);
});

test("release gate rejects alternate URLs that resolve to the same database identity", () => {
  const result = spawnSync(process.execPath, ["scripts/check-release-gate.mjs", "--plan", "https://www.vognary.com"], {
    cwd: new URL("../", import.meta.url),
    env: {
      PATH: process.env.PATH ?? "",
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://production@db.example/vognary?sslmode=require",
      RELEASE_DATABASE_URL: "postgresql://disposable@DB.EXAMPLE:5432/vognary?sslmode=disable",
    },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout) as { requirements: Array<{ label: string; ready: boolean }> };
  assert.ok(report.requirements.some((entry) => entry.label === "RELEASE_DATABASE_URL must differ from DATABASE_URL" && !entry.ready));
});

test("release gate plan mode is non-mutating and reports missing operator prerequisites", () => {
  const result = spawnSync(process.execPath, ["scripts/check-release-gate.mjs", "--plan", "https://www.vognary.com"], {
    cwd: new URL("../", import.meta.url),
    env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout) as {
    status: string;
    requirements: Array<{ label: string; ready: boolean }>;
    steps: Array<{ id: string }>;
  };
  assert.equal(report.status, "plan");
  assert.ok(report.requirements.some((entry) => entry.label === "RELEASE_DATABASE_URL" && !entry.ready));
  assert.deepEqual(report.steps.map((entry) => entry.id), [
    "code-ci",
    "database",
    "browser",
    "local-smoke",
    "local-load",
    "statement-corpus",
    "receipt-corpus",
    "operations",
    "production",
  ]);
});
