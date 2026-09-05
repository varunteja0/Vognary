import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import test from "node:test";

import { runDependencyAudit } from "../scripts/check-dependency-audit.mjs";

function commandResult(status: number | null, report: unknown): SpawnSyncReturns<string> {
  return { pid: 1, output: [], stdout: JSON.stringify(report), stderr: "", status, signal: null };
}

function auditReport(high = 0, critical = 0) {
  return {
    auditReportVersion: 2,
    vulnerabilities: {},
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high, critical, total: high + critical } },
  };
}

const clean = () => commandResult(0, auditReport());
const unavailable = () => commandResult(1, { statusCode: 503, error: { summary: "", detail: "" } });
const timedOut = (): SpawnSyncReturns<string> => ({
  ...commandResult(null, null),
  signal: "SIGKILL",
  error: Object.assign(new Error("Audit command timed out"), { code: "ETIMEDOUT" }),
});

for (const scenario of [
  { name: "accepts a completed clean audit", results: [clean()], exit: 0 },
  { name: "retries an HTTP 503 then accepts a clean report", results: [unavailable(), clean()], exit: 0 },
  { name: "allows at most three attempts", results: [unavailable(), unavailable(), clean()], exit: 0 },
  { name: "fails after persistent HTTP 503", results: [unavailable(), unavailable(), unavailable()], exit: 1 },
  { name: "retries a killed timeout", results: [timedOut(), clean()], exit: 0 },
  { name: "fails after exhausted timeouts", results: [timedOut(), timedOut(), timedOut()], exit: 1 },
  { name: "does not retry a high-severity finding", results: [commandResult(1, auditReport(1))], exit: 1 },
  { name: "does not retry a critical finding after registry recovery", results: [unavailable(), commandResult(1, auditReport(0, 1))], exit: 1 },
  { name: "rejects a high finding even with exit zero", results: [commandResult(0, auditReport(1))], exit: 1 },
  { name: "does not retry authorization failures", results: [commandResult(1, { statusCode: 403 })], exit: 1 },
  { name: "does not retry unknown command failures", results: [commandResult(42, null)], exit: 42 },
  { name: "rejects empty output with exit zero", results: [commandResult(0, {})], exit: 1 },
  { name: "rejects invalid JSON with exit zero", results: [{ ...clean(), stdout: "not JSON" }], exit: 1 },
  { name: "does not trust a report accompanied by a process error", results: [{ ...clean(), error: Object.assign(new Error("missing npm"), { code: "ENOENT" }) }], exit: 1 },
  { name: "does not retry a finding disguised as a registry failure", results: [commandResult(1, { ...auditReport(1), statusCode: 503 })], exit: 1 },
]) {
  test(`dependency audit ${scenario.name}`, () => {
    let attempts = 0;
    const execute = (() => {
      const result = scenario.results[attempts];
      attempts += 1;
      assert.ok(result, "must not execute beyond the expected attempts");
      return result;
    }) as unknown as typeof spawnSync;

    const exitCode = runDependencyAudit({ execute, write: () => {}, warn: () => {} });
    assert.equal(exitCode, scenario.exit);
    assert.equal(attempts, scenario.results.length);
  });
}

test("dependency audit preserves severity, dependency scope, and process bounds", () => {
  for (const omitDev of [false, true]) {
    const calls: unknown[][] = [];
    const execute = ((...args: unknown[]) => {
      calls.push(args);
      return clean();
    }) as typeof spawnSync;
    assert.equal(runDependencyAudit({ omitDev, execute, write: () => {}, warn: () => {} }), 0);
    assert.equal(calls.length, 1);
    const [command, args, options] = calls[0] as [string, string[], Record<string, unknown>];
    assert.equal(command, "npm");
    assert.equal(args[0], "audit");
    assert.ok(args.includes("--json"));
    assert.ok(args.includes("--audit-level=high"));
    assert.ok(args.includes("--fetch-timeout=30000"));
    assert.ok(args.includes("--fetch-retries=0"));
    assert.equal(args.includes("--omit=dev"), omitDev);
    assert.equal(options.timeout, 120_000);
    assert.equal(options.killSignal, "SIGKILL");
  }
});