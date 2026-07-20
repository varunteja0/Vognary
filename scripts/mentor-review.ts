import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getPublicTrustSignals } from "../src/lib/server/trust-signals";
import { listConnectorAdapters } from "../src/lib/connectors/adapter-registry";

export type RowId =
  | "engineering"
  | "trust"
  | "first-touch"
  | "workspace"
  | "integrations"
  | "backend"
  | "activation"
  | "validation"
  | "distribution";

export type RowReport = {
  id: RowId;
  label: string;
  score: number | null;
  evidence: string[];
  missing: string[];
  nextAction: string;
  source: "code-evidence" | "founder-ledger" | "mixed";
  stale: boolean;
};

export type FounderLedger = {
  updatedAt?: string;
  validation?: { score?: number; revenueInr?: number | null; paidAudits?: number | null; note?: string };
  distribution?: { score?: number; activeUsers?: number | null; outreachLast7d?: number | null; note?: string };
  activation?: { blockAComplete?: boolean; googleVerificationSubmitted?: boolean; note?: string };
};

type Criterion = { points: number; label: string; met: boolean };

const ledgerStaleAfterDays = 14;

export function readFounderLedger(root: string): FounderLedger | null {
  const path = resolve(root, "docs/scorecard.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as FounderLedger;
  } catch {
    return null;
  }
}

export function buildScorecard(root: string, ledger: FounderLedger | null, now: Date = new Date()): RowReport[] {
  const has = (relative: string) => existsSync(resolve(root, relative));
  const contains = (relative: string, needle: string) => {
    const path = resolve(root, relative);
    if (!existsSync(path)) return false;
    return readFileSync(path, "utf8").includes(needle);
  };
  const countFiles = (relativeDir: string, suffix: string) => {
    const path = resolve(root, relativeDir);
    if (!existsSync(path)) return 0;
    return readdirSync(path).filter((name) => name.endsWith(suffix)).length;
  };

  const stale = isLedgerStale(ledger, now);
  const rows: RowReport[] = [];

  rows.push(codeRow("engineering", "Engineering discipline", [
    { points: 2, label: "PR CI runs typecheck", met: contains(".github/workflows/ci.yml", "npm run typecheck") },
    { points: 1.5, label: "jsx-a11y recommended enforced in eslint", met: contains("eslint.config.mjs", "jsx-a11y") },
    { points: 2, label: "70+ unit test files", met: countFiles("tests", ".test.ts") >= 70 },
    { points: 1.5, label: "perf budget gated in CI", met: contains(".github/workflows/ci.yml", "perf:budget") },
    { points: 1.5, label: "coverage threshold configured (c8)", met: contains("package.json", "c8") },
    { points: 1.5, label: "npm audit gate in CI", met: contains(".github/workflows/ci.yml", "npm audit") },
  ]));

  rows.push(codeRow("trust", "Trust architecture", [
    { points: 2, label: "claims guard enforces watches-never-linked", met: contains("scripts/check-public-claims.mjs", "merchants are watched, never linked") },
    { points: 2, label: "/security renders live trust signals", met: contains("src/app/security/page.tsx", "getPublicTrustSignals") },
    { points: 1.5, label: "/beta-readiness renders live signals", met: contains("src/app/beta-readiness/page.tsx", "getPublicTrustSignals") },
    { points: 1, label: "dated restore-drill attestation supported", met: contains("src/lib/server/trust-signals.ts", "BACKUP_RESTORE_DRILL_AT") },
    { points: 1.5, label: "public /api/trust feed", met: has("src/app/api/trust/route.ts") },
    { points: 1, label: "scheduled backup-drill workflow present", met: has(".github/workflows/ops-backup-drill.yml") },
    { points: 1, label: "security.txt disclosure route", met: has("src/app/.well-known/security.txt/route.ts") || has("public/.well-known/security.txt") },
  ]));

  rows.push(codeRow("first-touch", "First-touch experience", [
    { points: 3, label: "landing performs the audit in place", met: contains("src/app/page.tsx", "InstantAudit") },
    { points: 1.5, label: "landing instant-audit e2e spec", met: has("tests/e2e/landing-instant-audit.spec.ts") },
    { points: 1, label: "sample receipt chip on landing", met: contains("src/app/instant-audit.tsx", "sample") },
    { points: 2, label: "journey spine site header", met: has("src/app/site-header.tsx") },
    { points: 1.5, label: "Nakul narrated sample demo", met: has("src/app/nakul-demo.tsx") },
    { points: 1, label: "verifiable proof wall on landing", met: contains("src/app/page.tsx", "proof-wall") || has("src/app/proof-wall.tsx") },
  ]));

  rows.push(codeRow("workspace", "Workspace UX", [
    { points: 1.5, label: "offline banner mounted", met: contains("src/app/vognary-mvp-client.tsx", "OfflineBanner") },
    { points: 1.5, label: "route loading skeletons", met: has("src/app/sources/loading.tsx") && has("src/app/profile/loading.tsx") },
    { points: 2, label: "monolith sections extracted to workspace/", met: countFiles("src/app/workspace", ".tsx") >= 3 },
    { points: 2, label: "zero-dead-end e2e walk", met: has("tests/e2e/workspace-dead-ends.spec.ts") },
    { points: 2, label: "freshness visible in workspace", met: contains("src/app/vognary-mvp-client.tsx", "Fresh as of") },
    { points: 1, label: "command palette", met: has("src/app/command-palette.tsx") },
  ]));

  rows.push(codeRow("integrations", "Real integrations", [
    { points: 2, label: "10 adapters registered", met: listConnectorAdapters().length >= 10 },
    { points: 1, label: "Gmail read-only adapter present", met: has("src/lib/connectors/gmail-readonly-adapter.ts") },
    { points: 2, label: "per-provider scoped-token guides", met: has("src/app/workspace/token-guides.ts") || contains("src/app/vognary-mvp-client.tsx", "scoped-token guide") },
    { points: 2, label: "token-rail connect e2e spec", met: has("tests/e2e/connect-token-rail.spec.ts") },
    { points: 2, label: "stale-on-open auto refresh", met: contains("src/app/vognary-mvp-client.tsx", "staleSourceRefresh") },
    { points: 1, label: "Setu sandbox journey spec", met: has("tests/e2e/setu-sandbox.spec.ts") },
  ]));

  rows.push(codeRow("backend", "Backend robustness", [
    { points: 2, label: "15+ Postgres integration tests", met: countFiles("tests/postgres", ".test.ts") >= 15 },
    { points: 1.5, label: "sync-job recovery drill", met: countFiles("tests/postgres", ".test.ts") > 0 && readdirSync(resolve(root, "tests/postgres")).some((f) => f.includes("sync-job-recovery")) },
    { points: 2, label: "funnel summary route (product events)", met: has("src/app/api/internal/product-events/summary/route.ts") },
    { points: 1.5, label: "webhook ingestion proof test", met: has("tests/connector-webhook-proof.test.ts") || has("tests/e2e/webhook-ingestion.spec.ts") },
    { points: 1.5, label: "rate-limit burst e2e", met: has("tests/e2e/rate-limit-burst.spec.ts") },
    { points: 1.5, label: "shared rate limiting + encrypted vault present", met: has("src/lib/server/token-vault.ts") && has("src/lib/rate-limit.ts") },
  ]));

  const signals = getPublicTrustSignals();
  const proven = signals.filter((signal) => signal.state === "proven").length;
  const configured = signals.filter((signal) => signal.state === "configured").length;
  const activationLedger = ledger?.activation;
  const activationCriteria: Criterion[] = [
    { points: 2, label: "founder Block A complete (ledger)", met: activationLedger?.blockAComplete === true },
    { points: 2, label: "Google verification submitted (ledger)", met: activationLedger?.googleVerificationSubmitted === true },
    { points: 3, label: `operator attestations proven in this environment (${proven}/${signals.length})`, met: proven >= 4 },
    { points: 3, label: `core configuration active in this environment (${configured} configured)`, met: configured >= 3 },
  ];
  rows.push({
    ...codeRow("activation", "Production activation", activationCriteria),
    source: "mixed",
    stale,
  });

  rows.push(ledgerRow("validation", "Business validation", ledger?.validation?.score, stale, [
    ledger?.validation ? `ledger: revenue INR ${formatLedgerNumber(ledger.validation.revenueInr)}, paid audits ${formatLedgerNumber(ledger.validation.paidAudits)}` : "ledger row missing",
    ledger?.validation?.note ?? "no note recorded",
  ], "Real paid audits move this row: run the outreach cadence (docs/private-audit-outreach-kit.md) and record real numbers in docs/scorecard.json."));

  rows.push(ledgerRow("distribution", "Distribution", ledger?.distribution?.score, stale, [
    ledger?.distribution ? `ledger: active users ${formatLedgerNumber(ledger.distribution.activeUsers)}, outreach last 7d ${formatLedgerNumber(ledger.distribution.outreachLast7d)}` : "ledger row missing",
    ledger?.distribution?.note ?? "no note recorded",
  ], "Ship the share loops (PR-6b) and start the daily outreach cadence; record real counts in docs/scorecard.json."));

  return rows;
}

export function findFloorRow(rows: RowReport[]): RowReport {
  const unknown = rows.find((row) => row.score === null);
  if (unknown) return unknown;
  return [...rows].sort((left, right) => (left.score ?? 0) - (right.score ?? 0))[0];
}

function codeRow(id: RowId, label: string, criteria: Criterion[]): RowReport {
  const total = criteria.reduce((sum, criterion) => sum + criterion.points, 0);
  const earned = criteria.filter((criterion) => criterion.met).reduce((sum, criterion) => sum + criterion.points, 0);
  const missing = criteria.filter((criterion) => !criterion.met).map((criterion) => criterion.label);
  return {
    id,
    label,
    score: Math.round((earned / total) * 100) / 10,
    evidence: criteria.filter((criterion) => criterion.met).map((criterion) => criterion.label),
    missing,
    nextAction: missing[0] ?? "hold the bar - keep gates green",
    source: "code-evidence",
    stale: false,
  };
}

function ledgerRow(id: RowId, label: string, score: number | undefined, stale: boolean, evidence: string[], nextAction: string): RowReport {
  return {
    id,
    label,
    score: typeof score === "number" ? score : null,
    evidence,
    missing: typeof score === "number" ? [] : ["score not recorded in docs/scorecard.json"],
    nextAction: typeof score === "number" ? nextAction : "Record a real score in docs/scorecard.json - the mentor never invents this number.",
    source: "founder-ledger",
    stale,
  };
}

function isLedgerStale(ledger: FounderLedger | null, now: Date): boolean {
  if (!ledger?.updatedAt) return true;
  const updated = new Date(`${ledger.updatedAt}T00:00:00Z`).getTime();
  if (Number.isNaN(updated)) return true;
  return now.getTime() - updated > ledgerStaleAfterDays * 24 * 60 * 60 * 1000;
}

function formatLedgerNumber(value: number | null | undefined): string {
  return typeof value === "number" ? String(value) : "not recorded";
}

function main() {
  const root = process.cwd();
  const ledger = readFounderLedger(root);
  const rows = buildScorecard(root, ledger);
  const floor = findFloorRow(rows);

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ rows, floor: floor.id }, null, 2));
    return;
  }

  console.log("Vognary Mentor - evidence-based scorecard (docs/mentor.md is the doctrine)\n");
  for (const row of rows) {
    const scoreText = row.score === null ? "UNKNOWN" : row.score.toFixed(1);
    const staleText = row.stale && row.source !== "code-evidence" ? " [ledger stale - update docs/scorecard.json]" : "";
    console.log(`${row.label.padEnd(24)} ${scoreText.padStart(7)}  (${row.source})${staleText}`);
    if (row.missing.length) console.log(`  next: ${row.nextAction}`);
  }
  console.log(`\nFLOOR ROW: ${floor.label} (${floor.score === null ? "UNKNOWN" : floor.score.toFixed(1)})`);
  console.log(`DO THIS NEXT: ${floor.nextAction}`);
  console.log("\nStanding nags: Google verification submitted? Block A complete? (docs/founder-activation-checklist.md)");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
