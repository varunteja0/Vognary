import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import { parse } from "yaml";

import { combineCorpusScores, evaluateCorpusCase, type CorpusCommitment } from "../src/lib/corpus-evaluation";
import { hasReadablePdfTextLayer } from "../src/lib/pdf-ingest";
import { analyzeStatements } from "../src/lib/recurring-audit";
import { redactText } from "../src/lib/redaction";
import { convertSpreadsheetToCsv } from "../src/lib/server/spreadsheet-ingest";

const minimumRealFixtures = 100;
const minimumPrecision = 0.97;
const minimumRecall = 0.92;
const strict = process.argv.includes("--strict");
const corpusRoot = path.resolve(process.env.STATEMENT_CORPUS_DIR || "corpus/statement-fixtures");
const manifestPath = path.join(corpusRoot, "manifest.yaml");
const reportPath = path.resolve("output/corpus-report.json");

type ManifestFixture = {
  file: string;
  institution: string;
  provenance: "synthetic" | "consented-redacted-real";
  consentReference?: string;
  expected: { recurring: CorpusCommitment[] };
};

type Manifest = { version: 1; fixtures: ManifestFixture[] };

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Statement corpus evaluation failed.");
  process.exitCode = 1;
});

async function main() {
  let manifest: Manifest;
  try {
    manifest = parse(await readFile(manifestPath, "utf8")) as Manifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await emitReport({
      status: "collection-required",
      corpusRoot,
      realFixtureCount: 0,
      syntheticFixtureCount: 0,
      thresholds: thresholdSummary(false),
      score: emptyScore(),
      cases: [],
    });
    if (strict) process.exitCode = 1;
    return;
  }

  validateManifest(manifest);
  const cases = [];
  for (const fixture of manifest.fixtures) {
    const sourcePath = resolveFixturePath(fixture.file);
    const text = await readStatementText(sourcePath);
    if (fixture.provenance === "consented-redacted-real" && redactText(text).redactedCount > 0) {
      throw new Error(`${fixture.file} still contains identifier-shaped values. Redact it before corpus use.`);
    }
    const audit = analyzeStatements([{ name: path.basename(sourcePath), text }]);
    const score = evaluateCorpusCase(fixture.expected.recurring, audit.recurringItems.map((item) => ({
      merchant: item.merchant,
      currency: item.currency,
      frequency: item.frequency,
      averageAmount: item.averageAmount,
    })));
    cases.push({
      file: fixture.file,
      institution: fixture.institution,
      provenance: fixture.provenance,
      score,
    });
  }

  const realCases = cases.filter((fixture) => fixture.provenance === "consented-redacted-real");
  const realFixtureCount = realCases.length;
  const score = realCases.length ? combineCorpusScores(realCases.map((fixture) => fixture.score)) : emptyScore();
  const thresholdActive = realFixtureCount >= minimumRealFixtures;
  const qualityReady = thresholdActive && score.precision !== null && score.recall !== null
    && score.precision >= minimumPrecision && score.recall >= minimumRecall;
  const status = qualityReady ? "ready" : thresholdActive ? "regression" : "collecting";
  await emitReport({
    status,
    corpusRoot,
    realFixtureCount,
    syntheticFixtureCount: cases.length - realFixtureCount,
    thresholds: thresholdSummary(thresholdActive),
    score,
    cases,
  });

  if ((thresholdActive && !qualityReady) || (strict && !qualityReady)) process.exitCode = 1;
}

function validateManifest(value: Manifest) {
  if (value?.version !== 1 || !Array.isArray(value.fixtures)) throw new Error("Corpus manifest must use version 1 and a fixtures array.");
  for (const fixture of value.fixtures) {
    if (!fixture.file || !fixture.institution || !["synthetic", "consented-redacted-real"].includes(fixture.provenance)) {
      throw new Error("Every corpus fixture needs file, institution, and an allowlisted provenance.");
    }
    if (fixture.provenance === "consented-redacted-real" && !/^consent-[A-Za-z0-9._-]{6,80}$/.test(fixture.consentReference ?? "")) {
      throw new Error(`${fixture.file} requires an opaque consentReference beginning with consent-.`);
    }
    if (!Array.isArray(fixture.expected?.recurring)) throw new Error(`${fixture.file} requires expected.recurring.`);
  }
}

function resolveFixturePath(relativePath: string) {
  const resolved = path.resolve(corpusRoot, relativePath);
  if (resolved !== corpusRoot && !resolved.startsWith(`${corpusRoot}${path.sep}`)) throw new Error("Corpus fixture path escapes the corpus directory.");
  return resolved;
}

async function readStatementText(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".csv" || extension === ".txt") return readFile(filePath, "utf8");
  if (extension === ".xls" || extension === ".xlsx") return convertSpreadsheetToCsv(await readFile(filePath)).csv;
  if (extension === ".pdf") {
    const parser = new PDFParse({ data: await readFile(filePath) });
    try {
      const parsed = await parser.getText();
      if (!hasReadablePdfTextLayer(parsed.text)) throw new Error(`${path.basename(filePath)} has no readable PDF text layer.`);
      return parsed.text;
    } finally {
      await parser.destroy();
    }
  }
  throw new Error(`Unsupported corpus fixture extension: ${extension}`);
}

async function emitReport(report: Record<string, unknown>) {
  const document = { generatedAt: new Date().toISOString(), ...report };
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(document, null, 2)}\n`);
  console.log(JSON.stringify(document, null, 2));
}

function thresholdSummary(active: boolean) {
  return { active, minimumRealFixtures, minimumPrecision, minimumRecall };
}

function emptyScore() {
  return { expected: 0, detected: 0, matched: 0, falsePositives: 0, falseNegatives: 0, precision: null, recall: null };
}