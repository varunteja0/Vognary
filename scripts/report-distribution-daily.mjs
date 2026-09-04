import { readFile } from "node:fs/promises";

import { parseWindowedReportArguments } from "./lib/command-arguments.mjs";
import {
  buildDistributionDailyDesk,
  formatDistributionDailyDesk,
} from "./lib/distribution-daily-desk.mjs";
import {
  parseDistributionActivityLedger,
  summarizeDistributionActivity,
} from "./lib/distribution-activity.mjs";
import { buildMarketOperatorDesk } from "./lib/market-operator-desk.mjs";
import {
  parseMarketTestCsv,
  summarizeMarketTest,
} from "./lib/market-test-report.mjs";

const defaultCrmPath = "docs/execution/private-commitment-control-pilot-crm.csv";
const defaultLedgerPath = ".fallow/distribution/activity-ledger.jsonl";

let options;
try {
  options = parseArguments(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Distribution daily desk arguments are invalid.");
  process.exit(1);
}

if (options.help) {
  console.log(`Build one privacy-minimized daily distribution decision desk.

Usage:
  node scripts/report-distribution-daily.mjs --since <UTC timestamp> --as-of <UTC timestamp>
  node scripts/report-distribution-daily.mjs --since <UTC timestamp> --as-of <UTC timestamp> --json

The command is read-only. It prints aggregate queue counts and one primary founder action; it never sends outreach or mutates CRM evidence.`);
  process.exit(0);
}

let crmInput;
let ledgerInput;
try {
  [crmInput, ledgerInput] = await Promise.all([
    readFile(options.crmPath, "utf8"),
    readFile(options.ledgerPath, "utf8"),
  ]);
} catch {
  console.error("Distribution daily desk unavailable: a configured private source could not be read.");
  process.exit(1);
}

try {
  const marketRows = parseMarketTestCsv(crmInput);
  const market = summarizeMarketTest(marketRows);
  const operator = buildMarketOperatorDesk(marketRows);
  const distribution = summarizeDistributionActivity(
    parseDistributionActivityLedger(ledgerInput),
    { since: options.since, asOf: options.asOf },
  );
  const desk = buildDistributionDailyDesk({
    asOf: options.asOf,
    market,
    operator,
    distribution,
  });
  console.log(options.json ? JSON.stringify(desk, null, 2) : formatDistributionDailyDesk(desk));
} catch (error) {
  const safeMessage = error instanceof Error && [
    "Distribution",
    "Market CRM",
    "Cannot schedule follow-up",
  ].some((prefix) => error.message.startsWith(prefix))
    ? error.message
    : "Distribution daily desk failed because a private source is invalid.";
  console.error(safeMessage);
  process.exitCode = 1;
}

function parseArguments(arguments_) {
  return parseWindowedReportArguments(arguments_, {
    scope: "Distribution daily desk",
    defaults: {
      crmPath: defaultCrmPath,
      ledgerPath: defaultLedgerPath,
    },
    optionFields: {
      "--crm": "crmPath",
      "--ledger": "ledgerPath",
    },
  });
}