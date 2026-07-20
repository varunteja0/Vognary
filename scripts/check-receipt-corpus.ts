import { mkdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { parse } from "yaml";

import { extractReceiptCandidates, splitReceiptSnippets, type ReceiptCandidate } from "../src/lib/receipt-parser";
import { redactText } from "../src/lib/redaction";

const minimumRealFixtures = 200;
const minimumPrecision = 0.97;
const minimumRecall = 0.92;
const maximumP95FirstResultMs = 5_000;
const strict = process.argv.includes("--strict");
const corpusRoot = path.resolve(process.env.RECEIPT_CORPUS_DIR || "corpus/receipt-fixtures");
const manifestPath = path.join(corpusRoot, "manifest.yaml");
const reportPath = path.resolve("output/receipt-corpus-report.json");

type ExpectedCandidate = {
  merchant: string;
  amount: number;
  currency: string;
  frequency: ReceiptCandidate["frequency"];
  nextExpectedDate: string;
};

type ManifestFixture = {
  file: string;
  channel: "email" | "sms" | "invoice" | "other";
  provenance: "synthetic" | "consented-redacted-real";
  consentReference?: string;
  expected: { candidates: ExpectedCandidate[] };
};

type Manifest = { version: 1; fixtures: ManifestFixture[] };

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Receipt corpus evaluation failed.");
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
      performance: { p95FirstResultMs: null, maximumP95FirstResultMs },
      cases: [],
    });
    if (strict) process.exitCode = 1;
    return;
  }

  validateManifest(manifest);
  const cases = [];
  for (const fixture of manifest.fixtures) {
    const sourcePath = resolveFixturePath(fixture.file);
    const text = await readFile(sourcePath, "utf8");
    if (fixture.provenance === "consented-redacted-real" && redactText(text).redactedCount > 0) {
      throw new Error(`${fixture.file} still contains identifier-shaped values. Redact it before corpus use.`);
    }
    const snippets = splitReceiptSnippets(text);
    const startedAt = performance.now();
    const detected = extractReceiptCandidates(snippets);
    const firstResultMs = performance.now() - startedAt;
    const score = evaluate(fixture.expected.candidates, detected);
    cases.push({ file: fixture.file, channel: fixture.channel, provenance: fixture.provenance, firstResultMs, score });
  }

  const realCases = cases.filter((fixture) => fixture.provenance === "consented-redacted-real");
  const score = combine(realCases.map((fixture) => fixture.score));
  const p95FirstResultMs = percentile(realCases.map((fixture) => fixture.firstResultMs), 0.95);
  const thresholdActive = realCases.length >= minimumRealFixtures;
  const qualityReady = thresholdActive
    && score.precision >= minimumPrecision
    && score.recall >= minimumRecall
    && p95FirstResultMs <= maximumP95FirstResultMs;
  const status = qualityReady ? "ready" : thresholdActive ? "regression" : "collecting";
  await emitReport({
    status,
    corpusRoot,
    realFixtureCount: realCases.length,
    syntheticFixtureCount: cases.length - realCases.length,
    thresholds: thresholdSummary(thresholdActive),
    score,
    performance: { p95FirstResultMs, maximumP95FirstResultMs },
    cases,
  });
  if ((thresholdActive && !qualityReady) || (strict && !qualityReady)) process.exitCode = 1;
}

function validateManifest(value: Manifest) {
  if (value?.version !== 1 || !Array.isArray(value.fixtures)) throw new Error("Receipt corpus manifest must use version 1 and a fixtures array.");
  for (const fixture of value.fixtures) {
    if (!fixture.file || !["email", "sms", "invoice", "other"].includes(fixture.channel) || !["synthetic", "consented-redacted-real"].includes(fixture.provenance)) {
      throw new Error("Every receipt fixture needs file, channel, and an allowlisted provenance.");
    }
    if (fixture.provenance === "consented-redacted-real" && !/^consent-[A-Za-z0-9._-]{6,80}$/.test(fixture.consentReference ?? "")) {
      throw new Error(`${fixture.file} requires an opaque consentReference beginning with consent-.`);
    }
    if (!Array.isArray(fixture.expected?.candidates)) throw new Error(`${fixture.file} requires expected.candidates.`);
  }
}

function resolveFixturePath(relativePath: string) {
  const resolved = path.resolve(corpusRoot, relativePath);
  if (resolved !== corpusRoot && !resolved.startsWith(`${corpusRoot}${path.sep}`)) throw new Error("Receipt fixture path escapes the corpus directory.");
  return resolved;
}

function evaluate(expected: ExpectedCandidate[], detected: ReceiptCandidate[]) {
  const unmatched = new Set(detected.map((_, index) => index));
  let matched = 0;
  for (const target of expected) {
    const index = [...unmatched].find((candidateIndex) => candidateMatches(target, detected[candidateIndex]));
    if (index === undefined) continue;
    unmatched.delete(index);
    matched += 1;
  }
  const falsePositives = detected.length - matched;
  const falseNegatives = expected.length - matched;
  return {
    expected: expected.length,
    detected: detected.length,
    matched,
    falsePositives,
    falseNegatives,
    precision: detected.length ? matched / detected.length : expected.length ? 0 : 1,
    recall: expected.length ? matched / expected.length : 1,
  };
}

function candidateMatches(expected: ExpectedCandidate, detected: ReceiptCandidate) {
  const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();
  const amountTolerance = Math.max(1, Math.abs(expected.amount) * 0.01);
  return normalize(expected.merchant) === normalize(detected.merchant)
    && expected.currency.toUpperCase() === (detected.currency ?? "INR").toUpperCase()
    && expected.frequency === detected.frequency
    && expected.nextExpectedDate === detected.nextExpectedDate
    && Math.abs(expected.amount - detected.amount) <= amountTolerance;
}

function combine(scores: ReturnType<typeof evaluate>[]) {
  const expected = scores.reduce((total, score) => total + score.expected, 0);
  const detected = scores.reduce((total, score) => total + score.detected, 0);
  const matched = scores.reduce((total, score) => total + score.matched, 0);
  return {
    expected,
    detected,
    matched,
    falsePositives: detected - matched,
    falseNegatives: expected - matched,
    precision: detected ? matched / detected : expected ? 0 : 1,
    recall: expected ? matched / expected : 1,
  };
}

function percentile(values: number[], percentileValue: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1)];
}

async function emitReport(report: Record<string, unknown>) {
  const document = { generatedAt: new Date().toISOString(), ...report };
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(document, null, 2)}\n`);
  console.log(JSON.stringify(document, null, 2));
}

function thresholdSummary(active: boolean) {
  return { active, minimumRealFixtures, minimumPrecision, minimumRecall, maximumP95FirstResultMs };
}

function emptyScore() {
  return { expected: 0, detected: 0, matched: 0, falsePositives: 0, falseNegatives: 0, precision: 1, recall: 1 };
}
