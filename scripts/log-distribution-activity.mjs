import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  unlink,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { readRequiredOptionValue } from "./lib/command-arguments.mjs";
import { parseDistributionActivityLedger } from "./lib/distribution-activity.mjs";

const defaultLedgerPath = ".fallow/distribution/activity-ledger.jsonl";
const maxEventBytes = 4 * 1024;

await main();

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    fail(error instanceof Error ? error.message : "Distribution activity arguments are invalid.");
    return;
  }

  if (options.help) {
    console.log(`Append one validated event to the private distribution activity ledger.

Usage:
  node scripts/log-distribution-activity.mjs --event-file <one-line JSON file>
  node scripts/log-distribution-activity.mjs --ledger <private JSONL path> --event-file <one-line JSON file>

The command accepts exactly one JSON object per invocation, validates the complete ledger, and treats an exact event replay as a no-op.`);
    return;
  }

  let eventLine;
  try {
    const eventInput = await readFile(options.eventFilePath, "utf8");
    const lines = eventInput.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length !== 1) {
      throw new Error("Distribution activity event file must contain exactly one JSON object on one line.");
    }
    eventLine = lines[0];
    if (Buffer.byteLength(eventLine, "utf8") > maxEventBytes) {
      throw new Error(`Distribution activity event exceeds ${maxEventBytes} bytes.`);
    }
  } catch (error) {
    const safeMessage = error instanceof Error && error.message.startsWith("Distribution activity event")
      ? error.message
      : "Distribution activity event file could not be read.";
    fail(safeMessage);
    return;
  }

  let ledgerPath;
  try {
    ledgerPath = await canonicalLedgerPath(options.ledgerPath);
  } catch (error) {
    fail(error instanceof Error ? error.message : "Distribution activity unchanged: ledger path is invalid.");
    return;
  }
  const lockPath = `${ledgerPath}.lock`;
  let lockHandle;
  try {
    lockHandle = await open(lockPath, "wx", 0o600);
  } catch (error) {
    const reason = error && typeof error === "object" && "code" in error && error.code === "EEXIST"
      ? "another append is in progress"
      : "the private lock could not be created";
    fail(`Distribution activity unchanged: ${reason}.`);
    return;
  }

  let outcomeMessage = "";
  let ledgerHandle;
  try {
    ledgerHandle = await openPrivateLedger(ledgerPath);
    const ledgerIdentity = await validateLedgerHandle(ledgerHandle);
    const existingInput = await ledgerHandle.readFile("utf8");
    const existingEvents = parseDistributionActivityLedger(existingInput);
    const combinedInput = existingInput.trim()
      ? `${existingInput.trimEnd()}\n${eventLine}`
      : eventLine;
    const combinedEvents = parseDistributionActivityLedger(combinedInput);
    const candidate = JSON.parse(eventLine);
    const alreadyRecorded = existingEvents.some((event) => event.event_id === candidate.event_id);
    if (alreadyRecorded) {
      outcomeMessage = `Distribution activity already recorded: ${candidate.event_type}.`;
    } else if (combinedEvents.length !== existingEvents.length + 1) {
      throw new Error("Distribution activity unchanged: event did not produce one append.");
    } else {
      const separator = existingInput && !existingInput.endsWith("\n") ? "\n" : "";
      await ledgerHandle.appendFile(`${separator}${eventLine}\n`, "utf8");
      await ledgerHandle.chmod(0o600);
      await verifyLedgerPathIdentity(ledgerPath, ledgerIdentity);
      outcomeMessage = `Distribution activity recorded: ${candidate.event_type}.`;
    }
  } catch (error) {
    const safeMessage = error instanceof Error && error.message.startsWith("Distribution activity")
      ? error.message
      : "Distribution activity unchanged: private ledger operation failed.";
    fail(safeMessage);
  } finally {
    let cleanupFailed = false;
    if (ledgerHandle) {
      try {
        await ledgerHandle.close();
      } catch {
        cleanupFailed = true;
      }
    }
    try {
      await lockHandle.close();
    } catch {
      cleanupFailed = true;
    }
    try {
      await unlink(lockPath);
    } catch {
      cleanupFailed = true;
    }
    if (cleanupFailed) {
      fail("Distribution activity lock cleanup failed; inspect the private ledger lock before retrying.");
    }
  }
  if (!process.exitCode && outcomeMessage) console.log(outcomeMessage);
}

function parseArguments(arguments_) {
  const parsed = {
    help: false,
    ledgerPath: defaultLedgerPath,
    eventFilePath: "",
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--help") {
      parsed.help = true;
      continue;
    }
    if (argument === "--ledger" || argument === "--event-file") {
      const value = readRequiredOptionValue(arguments_, index, argument, "Distribution activity");
      if (argument === "--ledger") parsed.ledgerPath = value;
      if (argument === "--event-file") parsed.eventFilePath = value;
      index += 1;
      continue;
    }
    throw new Error("Distribution activity arguments are invalid. Run with --help for usage.");
  }
  if (!parsed.help && !parsed.eventFilePath) {
    throw new Error("Distribution activity arguments are invalid: --event-file is required.");
  }
  return parsed;
}

async function openPrivateLedger(path) {
  const existingFlags = fsConstants.O_RDWR | fsConstants.O_APPEND | fsConstants.O_NOFOLLOW;
  try {
    return await open(path, existingFlags);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw new Error("Distribution activity unchanged: private ledger could not be opened.");
    }
  }
  try {
    return await open(
      path,
      existingFlags | fsConstants.O_CREAT | fsConstants.O_EXCL,
      0o600,
    );
  } catch {
    throw new Error("Distribution activity unchanged: private ledger could not be created.");
  }
}

async function validateLedgerHandle(handle) {
  let metadata;
  try {
    metadata = await handle.stat();
  } catch {
    throw new Error("Distribution activity unchanged: private ledger could not be inspected.");
  }
  if (!metadata.isFile() || metadata.nlink !== 1) {
    throw new Error("Distribution activity unchanged: private ledger must be one regular file with no aliases.");
  }
  return { dev: metadata.dev, ino: metadata.ino };
}

async function verifyLedgerPathIdentity(path, expected) {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch {
    throw new Error("Distribution activity changed on disk during append; inspect the private ledger before retrying.");
  }
  if (
    !metadata.isFile()
    || metadata.isSymbolicLink()
    || metadata.nlink !== 1
    || metadata.dev !== expected.dev
    || metadata.ino !== expected.ino
  ) {
    throw new Error("Distribution activity changed on disk during append; inspect the private ledger before retrying.");
  }
}

async function canonicalLedgerPath(path) {
  const absolutePath = resolve(path);
  await mkdir(dirname(absolutePath), { recursive: true });
  const realParent = await realpath(dirname(absolutePath));
  const candidate = join(realParent, basename(absolutePath));
  try {
    const metadata = await lstat(candidate);
    if (metadata.isSymbolicLink()) {
      throw new Error("Distribution activity unchanged: ledger symlinks are not allowed.");
    }
    if (!metadata.isFile()) {
      throw new Error("Distribution activity unchanged: ledger path is not a regular file.");
    }
    if (metadata.nlink !== 1) {
      throw new Error("Distribution activity unchanged: ledger hard links are not allowed.");
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return candidate;
    throw error;
  }
  return candidate;
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}