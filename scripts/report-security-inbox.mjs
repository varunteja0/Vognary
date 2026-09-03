import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  formatSecurityInboxSummary,
  isSecurityInboxReviewRef,
  summarizeSecurityInbox,
} from "./lib/security-inbox-report.mjs";

const receivedEmailsUrl = "https://api.resend.com/emails/receiving?limit=100";
const reviewStatePath = ".fallow/company-mail/security-inbox-review-state.json";

let options;
try {
  options = parseArguments(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Security inbox arguments are invalid.");
  process.exit(1);
}

if (options.help) {
  console.log(`Report privacy-minimized metadata for security@vognary.com without a browser login.

Usage:
  npm run security:inbox
  npm run security:inbox -- --json
  npm run security:inbox -- --mark-handled <review-ref>

Required env:
  RESEND_API_KEY  Read access to the Vognary Resend account.

The default report is read-only. Repeat --mark-handled to record multiple reviewed messages in an ignored local ledger.
The report never prints or stores message IDs, names, address local parts, subjects, bodies, headers, attachments, or links.`);
  process.exit(0);
}

const apiKey = process.env.RESEND_API_KEY?.trim();
if (!apiKey) {
  console.error("Security inbox unavailable: RESEND_API_KEY is not configured.");
  process.exit(1);
}

const response = await fetch(receivedEmailsUrl, {
  headers: { authorization: `Bearer ${apiKey}` },
  signal: AbortSignal.timeout(8_000),
});
if (!response.ok) {
  console.error(`Security inbox unavailable: provider returned HTTP ${response.status}.`);
  process.exit(1);
}

let payload;
try {
  payload = await response.json();
} catch {
  console.error("Security inbox unavailable: provider returned invalid JSON.");
  process.exit(1);
}

const messages = Array.isArray(payload?.data) ? payload.data : [];
let handledReviewRefs;
try {
  handledReviewRefs = await readHandledReviewRefs(reviewStatePath);
} catch {
  console.error("Security inbox unavailable: local review state is invalid or unreadable.");
  process.exit(1);
}

let summary = summarizeSecurityInbox(messages, { handledReviewRefs });
if (options.markHandledRefs.length > 0) {
  const knownReviewRefs = new Set(
    summary.messages.map((message) => message.reviewRef).filter(Boolean),
  );
  if (options.markHandledRefs.some((reviewRef) => !knownReviewRefs.has(reviewRef))) {
    console.error("Security inbox unchanged: a review ref is not present in the current inbox.");
    process.exit(1);
  }
  handledReviewRefs = [...new Set([...handledReviewRefs, ...options.markHandledRefs])].sort();
  try {
    await writeHandledReviewRefs(reviewStatePath, handledReviewRefs);
  } catch {
    console.error("Security inbox unchanged: local review state could not be written.");
    process.exit(1);
  }
  summary = summarizeSecurityInbox(messages, { handledReviewRefs });
}

console.log(options.json ? JSON.stringify(summary, null, 2) : formatSecurityInboxSummary(summary));

function parseArguments(args) {
  const parsed = { help: false, json: false, markHandledRefs: [] };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help") {
      parsed.help = true;
      continue;
    }
    if (argument === "--json") {
      parsed.json = true;
      continue;
    }
    if (argument === "--mark-handled") {
      const reviewRef = args[index + 1];
      if (!isSecurityInboxReviewRef(reviewRef)) {
        throw new Error("Security inbox arguments are invalid: --mark-handled requires one 64-character review ref.");
      }
      parsed.markHandledRefs.push(reviewRef);
      index += 1;
      continue;
    }
    throw new Error("Security inbox arguments are invalid. Run with --help for usage.");
  }
  return parsed;
}

async function readHandledReviewRefs(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return [];
    throw error;
  }
  const state = JSON.parse(text);
  if (
    state?.version !== 1
    || !Array.isArray(state.handledReviewRefs)
    || state.handledReviewRefs.some((reviewRef) => !isSecurityInboxReviewRef(reviewRef))
  ) {
    throw new Error("Invalid security inbox review state.");
  }
  return [...new Set(state.handledReviewRefs)].sort();
}

async function writeHandledReviewRefs(path, handledReviewRefs) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify({ version: 1, handledReviewRefs }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await rename(temporaryPath, path);
}