import { readFile } from "node:fs/promises";

import { validateMarketCopy } from "../src/lib/market-claims";

const canonicalOutreachPath = "docs/templates/outreach-scripts.md";

let options: ReturnType<typeof parseArguments>;
try {
  options = parseArguments(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Market claims arguments are invalid.");
  process.exit(1);
}

if (options.help) {
  console.log(`Check canonical market copy and optional private drafts without printing their contents.

Usage:
  npm run market:claims
  npm run market:claims -- --draft <private file>

Repeat --draft to check more than one private file. Canonical outreach must contain the complete current offer; private drafts are checked for prohibited claims.`);
  process.exit(0);
}

void main().catch(() => {
  console.error("Market claims check failed unexpectedly.");
  process.exitCode = 1;
});

async function main() {
  const surfaces: Array<{
    label: string;
    text: string;
    requireOfferContract: boolean;
  }> = [];

  try {
    surfaces.push({
      label: "canonical-outreach",
      text: await readFile(canonicalOutreachPath, "utf8"),
      requireOfferContract: true,
    });
  } catch {
    console.error("Market claims check unavailable: canonical outreach could not be read.");
    process.exit(1);
  }

  for (const draftPath of options.draftPaths) {
    try {
      surfaces.push({
        label: "private-draft",
        text: await readFile(draftPath, "utf8"),
        requireOfferContract: false,
      });
    } catch {
      console.error("Market claims check unavailable: a private draft could not be read.");
      process.exit(1);
    }
  }

  const failures = surfaces.flatMap((surface, surfaceIndex) => validateMarketCopy(surface.text, {
    requireOfferContract: surface.requireOfferContract,
  }).map((violation) => ({
    label: surface.label === "private-draft" ? `private-draft-${surfaceIndex}` : surface.label,
    ...violation,
  })));

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`${failure.label}:${failure.line} ${failure.code} - ${failure.remediation}`);
    }
    process.exit(1);
  }

  console.log(`Market claims check passed: ${surfaces.length} surface${surfaces.length === 1 ? "" : "s"}.`);
}

function parseArguments(arguments_: string[]) {
  const parsed = { help: false, draftPaths: [] as string[] };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--help") {
      parsed.help = true;
      continue;
    }
    if (argument === "--draft") {
      const value = arguments_[index + 1]?.trim();
      if (!value || value.startsWith("--")) {
        throw new Error("Market claims arguments are invalid: --draft requires one file.");
      }
      parsed.draftPaths.push(value);
      index += 1;
      continue;
    }
    throw new Error("Market claims arguments are invalid. Run with --help for usage.");
  }
  return parsed;
}