import { readFile } from "node:fs/promises";

import { parseWindowedReportArguments } from "./lib/command-arguments.mjs";
import {
  formatDistributionActivityReport,
  parseDistributionActivityLedger,
  summarizeDistributionActivity,
} from "./lib/distribution-activity.mjs";

const defaultLedgerPath = ".fallow/distribution/activity-ledger.jsonl";

let options;
try {
  options = parseArguments(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Distribution activity arguments are invalid.");
  process.exit(1);
}

if (options.help) {
  console.log(`Report privacy-minimized distribution activity for an explicit UTC window.

Usage:
  node scripts/report-distribution.mjs --since <UTC timestamp> --as-of <UTC timestamp>
  node scripts/report-distribution.mjs --since <UTC timestamp> --as-of <UTC timestamp> --json
  node scripts/report-distribution.mjs --ledger <private JSONL path> --since <UTC timestamp> --as-of <UTC timestamp>

The window is half-open: since is included and as-of is excluded. The command is read-only and never infers the current time.`);
  process.exit(0);
}

let input;
try {
  input = await readFile(options.ledgerPath, "utf8");
} catch {
  console.error("Distribution activity report unavailable: configured private ledger could not be read.");
  process.exit(1);
}

try {
  const events = parseDistributionActivityLedger(input);
  const summary = summarizeDistributionActivity(events, {
    since: options.since,
    asOf: options.asOf,
  });
  console.log(options.json ? JSON.stringify(summary, null, 2) : formatDistributionActivityReport(summary));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Distribution activity report failed.");
  process.exitCode = 1;
}

function parseArguments(arguments_) {
  return parseWindowedReportArguments(arguments_, {
    scope: "Distribution activity",
    defaults: { ledgerPath: defaultLedgerPath },
    optionFields: { "--ledger": "ledgerPath" },
  });
}