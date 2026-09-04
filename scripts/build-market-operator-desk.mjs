import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildMarketOperatorDesk,
  formatMarketOperatorDeskSummary,
  mergeMarketSendLog,
} from "./lib/market-operator-desk.mjs";
import { parseMarketTestCsv } from "./lib/market-test-report.mjs";

const crmPath = fileURLToPath(new URL("../docs/execution/private-commitment-control-pilot-crm.csv", import.meta.url));
const outputDirectory = fileURLToPath(new URL("../.fallow/outreach-2026-09-03", import.meta.url));
const followUpDirectory = join(outputDirectory, "follow-ups");
const sendLogPath = join(outputDirectory, "send-log.csv");

try {
  const rows = parseMarketTestCsv(await readFile(crmPath, "utf8"));
  const desk = buildMarketOperatorDesk(rows);
  await Promise.all([
    mkdir(outputDirectory, { recursive: true }),
    mkdir(followUpDirectory, { recursive: true }),
  ]);

  for (const draft of desk.firstTouches) {
    await writePrivateFile(join(outputDirectory, `${draft.cell}-${safeFilePart(draft.id)}.txt`), draft.content);
  }
  for (const draft of desk.followUps) {
    await writePrivateFile(join(followUpDirectory, `${draft.cell}-${safeFilePart(draft.id)}.txt`), draft.content);
  }

  const existingSendLog = await readOptionalFile(sendLogPath);
  await Promise.all([
    writePrivateFile(sendLogPath, mergeMarketSendLog(existingSendLog, desk.logEntries)),
    writePrivateFile(join(outputDirectory, "interview-guide.txt"), desk.interviewGuide),
  ]);
  console.log(formatMarketOperatorDeskSummary(desk.summary));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Market operator desk generation failed.");
  process.exitCode = 1;
}

async function readOptionalFile(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return "";
    throw error;
  }
}

async function writePrivateFile(filePath, content) {
  await writeFile(filePath, content, { encoding: "utf8", mode: 0o600 });
}

function safeFilePart(value) {
  if (!/^[A-Z0-9_-]+$/.test(value)) throw new Error("Market CRM contains an unsafe opaque id.");
  return value;
}