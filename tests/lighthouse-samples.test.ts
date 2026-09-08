import assert from "node:assert/strict";
import test from "node:test";
import { readLighthouseSample, runIsolatedLighthouseSample } from "../scripts/lib/lighthouse-samples.mjs";

function report(lcp: unknown = 1_000, score: unknown = 0.99) {
  return {
    audits: { "largest-contentful-paint": { numericValue: lcp } },
    categories: { performance: { score } },
  };
}

test("Lighthouse samples retain valid measured values without changing thresholds", () => {
  assert.deepEqual(readLighthouseSample(report(), ["performance"]), {
    lcp: 1_000,
    categories: { performance: 0.99 },
  });
  assert.equal(readLighthouseSample(report(5_000, 0), ["performance"]).lcp, 5_000);
});

test("Lighthouse samples reject missing, non-finite, and non-positive LCP", () => {
  for (const value of [null, Number.NaN, Number.POSITIVE_INFINITY, 0, -1, "1000"]) {
    assert.throws(() => readLighthouseSample(report(value), ["performance"]), /Invalid LCP/);
  }
  assert.throws(() => readLighthouseSample({ categories: report().categories }, ["performance"]), /Invalid LCP/);
  assert.throws(() => readLighthouseSample(null, ["performance"]), /Invalid LCP/);
});

test("Lighthouse samples reject missing and out-of-range category scores", () => {
  for (const value of [null, Number.NaN, Number.POSITIVE_INFINITY, -0.1, 1.01, "0.99"]) {
    assert.throws(() => readLighthouseSample(report(1_000, value), ["performance"]), /Invalid performance score/);
  }
  assert.throws(() => readLighthouseSample(report(), ["accessibility"]), /Invalid accessibility score/);
});

test("Lighthouse runtime and audit errors cannot become passing samples", () => {
  assert.throws(() => readLighthouseSample({
    ...report(),
    runtimeError: { code: "NO_LCP", message: "No LCP was observed" },
  }, ["performance"]), /NO_LCP/);
  assert.throws(() => readLighthouseSample({
    ...report(),
    audits: { "largest-contentful-paint": { numericValue: 1_000, errorMessage: "Trace incomplete" } },
  }, ["performance"]), /Trace incomplete/);
});

test("each Lighthouse sample launches and cleans up its own browser, including invalid traces", async () => {
  let launched = 0;
  const stopped: number[] = [];
  const launchBrowser = async () => {
    const port = ++launched;
    return { port, kill: async () => { stopped.push(port); } };
  };
  const runAudit = async (port: number) => ({ lhr: port === 2 ? { runtimeError: { code: "NO_NAVSTART", message: "Synthetic incomplete trace" } } : report() });
  assert.equal((await runIsolatedLighthouseSample(launchBrowser, runAudit, ["performance"])).lcp, 1000);
  await assert.rejects(runIsolatedLighthouseSample(launchBrowser, runAudit, ["performance"]), /NO_NAVSTART/);
  assert.equal((await runIsolatedLighthouseSample(launchBrowser, runAudit, ["performance"])).lcp, 1000);
  assert.equal(launched, 3);
  assert.deepEqual(stopped, [1, 2, 3]);
  await assert.rejects(runIsolatedLighthouseSample(launchBrowser, async () => { throw new Error("Synthetic navigation failed"); }, ["performance"]), /navigation failed/);
  assert.deepEqual(stopped, [1, 2, 3, 4]);
});

test("Lighthouse retains the raw invalid sample before rejecting it and still closes the browser", async () => {
  const result = { lhr: { runtimeError: { code: "NO_NAVSTART", message: "Synthetic incomplete trace" } }, artifacts: { Trace: { traceEvents: [{ name: "SyntheticTrace" }] } } };
  const retained: unknown[] = [];
  let stopped = false;
  await assert.rejects(runIsolatedLighthouseSample(
    async () => ({ port: 1, kill: async () => { stopped = true; } }),
    async () => result,
    ["performance"],
    async (sample: unknown) => { retained.push(sample); },
  ), /NO_NAVSTART/);
  assert.deepEqual(retained, [result]);
  assert.equal(stopped, true);
});
