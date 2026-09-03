import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import lighthouse from "lighthouse";
import { launch } from "chrome-launcher";

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

let chrome;
const failures = [];

try {
  await waitForServer(origin, server);
  chrome = await launch({
    chromePath: process.env.CHROME_PATH || undefined,
    chromeFlags: ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage"],
  });

  for (const route of routes) {
    const samples = [];
    for (let run = 0; run < runCount; run += 1) {
      const result = await lighthouse(`${origin}${route.path}`, {
        port: chrome.port,
        output: "json",
        logLevel: "error",
        formFactor: "mobile",
        throttlingMethod: "devtools",
        onlyCategories: route.categories,
      });
      samples.push({
        lcp: result.lhr.audits["largest-contentful-paint"].numericValue,
        categories: Object.fromEntries(
          Object.entries(result.lhr.categories).map(([key, value]) => [key, value.score ?? 0]),
        ),
      });
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
  await chrome?.kill();
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
