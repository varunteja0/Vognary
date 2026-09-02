import { readFile } from "node:fs/promises";

import {
  formatMarketTestReport,
  parseMarketTestCsv,
  summarizeMarketTest,
} from "./lib/market-test-report.mjs";

const crmPath = new URL("../docs/execution/private-commitment-control-pilot-crm.csv", import.meta.url);
const requireCohorts = process.argv.includes("--require-cohorts");

try {
  const rows = parseMarketTestCsv(await readFile(crmPath, "utf8"));
  const summary = summarizeMarketTest(rows);
  if (process.argv.includes("--json")) console.log(JSON.stringify(summary, null, 2));
  else console.log(formatMarketTestReport(summary));
  if (requireCohorts && summary.cohortGate.status !== "READY") process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : "Market test report failed.");
  process.exitCode = 1;
}