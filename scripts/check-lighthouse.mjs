import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import net from "node:net";
import lighthouse from "lighthouse";
import { launch } from "chrome-launcher";
import { runIsolatedLighthouseSample } from "./lib/lighthouse-samples.mjs";

const root = process.cwd();
const serverPath = new URL("../.next/standalone/server.js", import.meta.url);
// Every public route a stranger can reach, not a sample of three. An
// authenticated /app state needs credentials the gate does not hold, so it is
// measured separately in the signed-in capture run rather than faked here.
const routes = [
  { path: "/", categories: ["performance", "accessibility", "best-practices", "seo"] },
  { path: "/demo", categories: ["performance", "accessibility", "best-practices"] },
  { path: "/start", categories: ["performance", "accessibility", "best-practices"] },
  { path: "/pay", categories: ["performance", "accessibility", "best-practices"] },
  { path: "/security", categories: ["performance", "accessibility", "best-practices"] },
  { path: "/login?next=/app", categories: ["performance", "accessibility", "best-practices"] },
  { path: "/verify", categories: ["performance", "accessibility", "best-practices"] },
];
const runCount = 3;
const categoryThreshold = 0.95;
const lcpThreshold = 2_000;
const evidenceRoot = process.env.LIGHTHOUSE_EVIDENCE_DIR || join(root, ".fallow", "lighthouse");
mkdirSync(evidenceRoot, { recursive: true });
const evidenceDirectory = mkdtempSync(join(evidenceRoot, "run-"));
const outcomes = [];

if (!existsSync(serverPath)) {
  throw new Error("Production build output is missing. Run `npm run build` before `npm run perf:lighthouse`.");
}

const port = await findOpenPort();
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["scripts/start-standalone.mjs", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: root,
  env: { ...process.env, NODE_ENV: "production" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverOutput = "";
server.stdout.on("data", (chunk) => { serverOutput += chunk; });
server.stderr.on("data", (chunk) => { serverOutput += chunk; });

const failures = [];

try {
  await waitForServer(origin, server);

  for (const route of routes) {
    const samples = [];
    for (let run = 0; run < runCount; run += 1) {
      const name = `${routes.indexOf(route) + 1}-${run + 1}`;
      try {
        const sample = await runIsolatedLighthouseSample(
          () => launch({
            chromePath: process.env.CHROME_PATH || undefined,
            chromeFlags: ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage"],
          }),
          port => lighthouse(`${origin}${route.path}`, {
            port,
            output: "json",
            logLevel: "error",
            formFactor: "mobile",
            throttlingMethod: "devtools",
            onlyCategories: route.categories,
          }),
          route.categories,
          result => {
            writeFileSync(join(evidenceDirectory, `${name}-report.json`), JSON.stringify(result?.lhr ?? null) + "\n");
            writeFileSync(join(evidenceDirectory, `${name}-trace.json`), JSON.stringify(result?.artifacts?.Trace ?? result?.artifacts?.traces ?? null) + "\n");
            writeFileSync(join(evidenceDirectory, `${name}-devtools.json`), JSON.stringify(result?.artifacts?.DevtoolsLog ?? result?.artifacts?.devtoolsLogs ?? null) + "\n");
          },
        );
        samples.push(sample);
        outcomes.push({ route: route.path, sample: run + 1, valid: true, measurement: sample, artifacts: name });
      } catch (error) {
        outcomes.push({ route: route.path, sample: run + 1, valid: false, error: error.message, artifacts: name });
        writeFileSync(join(evidenceDirectory, `${name}-error.json`), JSON.stringify({ message: error.message, stack: error.stack }) + "\n");
        failures.push(`${route.path}: sample ${run + 1} is invalid: ${error.message}. Inspect ${evidenceDirectory}/${name}-trace.json; do not combine samples across runs.`);
      }
      writeFileSync(join(evidenceDirectory, "results.json"), JSON.stringify({ runCount, categoryThreshold, lcpThreshold, outcomes }, null, 2) + "\n");
    }

    if (samples.length !== runCount) {
      console.error(`${route.path}: only ${samples.length}/${runCount} valid samples; no passing median can be reported.`);
      continue;
    }

    const lcp = median(samples.map((sample) => sample.lcp));
    const categories = Object.fromEntries(
      route.categories.map((category) => [category, median(samples.map((sample) => sample.categories[category]))]),
    );
    const scores = Object.entries(categories)
      .map(([key, score]) => `${key} ${Math.round(score * 100)}`)
      .join(" | ");
    const lcpSamples = samples.map((sample) => Math.round(sample.lcp)).sort((left, right) => left - right).join(", ");

    console.log(`${route.path.padEnd(7)} LCP ${formatMilliseconds(lcp)} / ${formatMilliseconds(lcpThreshold)} [${lcpSamples}] | ${scores}`);

    if (lcp > lcpThreshold) failures.push(`${route.path}: median LCP ${formatMilliseconds(lcp)} exceeds ${formatMilliseconds(lcpThreshold)}`);
    for (const [category, score] of Object.entries(categories)) {
      if (score < categoryThreshold) failures.push(`${route.path}: median ${category} score ${Math.round(score * 100)} is below 95`);
    }
  }
} finally {
  writeFileSync(join(evidenceDirectory, "server.log"), serverOutput);
  console.log(`Lighthouse evidence: ${evidenceDirectory}`);
  server.kill("SIGTERM");
}

if (failures.length) {
  console.error("\nLighthouse budget failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`Lighthouse budgets passed for all ${routes.length} measured public routes.`);
}

async function findOpenPort() {
  return new Promise((resolve, reject) => {
    const candidate = net.createServer();
    candidate.once("error", reject);
    candidate.listen(0, "127.0.0.1", () => {
      const address = candidate.address();
      candidate.close(() => resolve(address.port));
    });
  });
}

async function waitForServer(origin, child) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Standalone server exited before Lighthouse ran.\n${serverOutput}`);
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // The server has not bound its port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Standalone server did not become ready at ${origin}.\n${serverOutput}`);
}

function formatMilliseconds(value) {
  return `${Math.round(value)} ms`;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}
