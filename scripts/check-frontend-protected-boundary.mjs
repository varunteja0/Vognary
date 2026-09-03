#!/usr/bin/env node
/**
 * Fails closed when a frontend execution touches a protected backend, domain,
 * payment, enrollment, production or private-market path.
 *
 * Compares byte manifests rather than `git diff`, so pre-existing unstaged
 * edits and brand-new untracked files cannot hide inside the boundary.
 *
 * Digest algorithm (mandate §16): sort paths by UTF-8 byte order, then hash the
 * UTF-8 sequence `path + NUL + sha256(fileBytes) + LF`.
 *
 *   node scripts/check-frontend-protected-boundary.mjs --write-baseline <path>
 *   node scripts/check-frontend-protected-boundary.mjs --baseline <path>
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..");

/** Every path below is read-only for any frontend execution. */
const PROTECTED_ROOTS = [
  // domain engines and server boundary
  "src/lib/commitment-control",
  "src/lib/server",
  "src/lib/recovery",
  "src/lib/finops-control",
  "src/lib/connectors",
  "src/lib/twin",
  // HTTP contracts
  "src/app/api",
  "src/middleware.ts",
  // persistence
  "infra/postgres",
  // payment and settlement
  "src/lib/billing.ts",
  "src/lib/pilot-payment-link.ts",
  "scripts/reconcile-billing.ts",
  "scripts/recover-razorpay-checkout.ts",
  // enrollment and readiness
  "scripts/check-control-pilot-readiness.mjs",
  "scripts/check-release-gate.mjs",
  "scripts/check-ops-preflight.mjs",
  // production configuration and operations
  "scripts/check-production-activation.mjs",
  "scripts/apply-postgres-schema.mjs",
  "scripts/apply-production-0056.mjs",
  "scripts/apply-production-0057.mjs",
  "scripts/backup-postgres.mjs",
  "scripts/restore-postgres-drill.mjs",
  "scripts/start-standalone.mjs",
  "scripts/vercel-build.mjs",
  "vercel.json",
  "Dockerfile",
  "docker-compose.yml",
];

/** Private market and customer evidence, matched by prefix anywhere. */
const PRIVATE_MARKET_PREFIXES = ["private-"];
const PRIVATE_MARKET_SCAN_DIRS = [".fallow", "docs/evidence", "corpus"];

const SKIP_DIRS = new Set([".git", "node_modules", ".next", "test-results", "playwright-report"]);

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function walk(absDir, out) {
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = join(absDir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (entry.isFile()) out.push(abs);
  }
  return out;
}

function collectPrivateMarketFiles() {
  const found = [];
  for (const dir of PRIVATE_MARKET_SCAN_DIRS) {
    const abs = join(REPO_ROOT, dir);
    if (!existsSync(abs)) continue;
    for (const file of walk(abs, [])) {
      const base = file.slice(file.lastIndexOf(sep) + 1);
      if (PRIVATE_MARKET_PREFIXES.some((prefix) => base.startsWith(prefix))) found.push(file);
    }
  }
  return found;
}

function buildManifest() {
  const absFiles = new Set();
  for (const root of PROTECTED_ROOTS) {
    const abs = join(REPO_ROOT, root);
    if (!existsSync(abs)) continue;
    if (statSync(abs).isDirectory()) for (const file of walk(abs, [])) absFiles.add(file);
    else absFiles.add(abs);
  }
  for (const file of collectPrivateMarketFiles()) absFiles.add(file);

  const files = {};
  for (const abs of absFiles) {
    files[relative(REPO_ROOT, abs).split(sep).join("/")] = sha256(readFileSync(abs));
  }

  // Sort by UTF-8 byte order, then hash `path + NUL + sha256 + LF`.
  const paths = Object.keys(files).sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
  const digest = createHash("sha256");
  for (const path of paths) digest.update(`${path}\0${files[path]}\n`, "utf8");

  return { fileCount: paths.length, digest: digest.digest("hex"), files };
}

function gitIsClean() {
  const roots = PROTECTED_ROOTS.filter((root) => existsSync(join(REPO_ROOT, root)));
  const out = execFileSync("git", ["status", "--porcelain", "--", ...roots], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
  return { clean: out === "", detail: out };
}

function fail(message, detail) {
  console.error(`PROTECTED FRONTEND BOUNDARY VIOLATED\n${message}`);
  if (detail) console.error(detail);
  process.exit(1);
}

const args = process.argv.slice(2);
const writeIndex = args.indexOf("--write-baseline");
const verifyIndex = args.indexOf("--baseline");

if (writeIndex !== -1) {
  const target = resolve(REPO_ROOT, args[writeIndex + 1]);
  const git = gitIsClean();
  if (!git.clean) {
    fail("Refusing to record a baseline: protected paths already differ from HEAD.", git.detail);
  }
  const manifest = buildManifest();
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(
    target,
    `${JSON.stringify(
      {
        purpose: "Frontend execution must not change any protected path.",
        algorithm: "sha256 over sorted `path + NUL + sha256(fileBytes) + LF`",
        recordedAt: new Date().toISOString(),
        headSha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim(),
        gitCleanAgainstHead: true,
        roots: PROTECTED_ROOTS,
        privateMarketScan: { dirs: PRIVATE_MARKET_SCAN_DIRS, prefixes: PRIVATE_MARKET_PREFIXES },
        ...manifest,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Baseline recorded: ${manifest.fileCount} protected files, digest ${manifest.digest}`);
  console.log(`Written to ${relative(REPO_ROOT, target)}`);
  process.exit(0);
}

if (verifyIndex === -1) {
  console.error("Usage: --write-baseline <path> | --baseline <path>");
  process.exit(2);
}

const baselinePath = resolve(REPO_ROOT, args[verifyIndex + 1]);
if (!existsSync(baselinePath)) fail(`Baseline not found: ${relative(REPO_ROOT, baselinePath)}`);

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const current = buildManifest();

if (current.digest !== baseline.digest) {
  const added = [];
  const removed = [];
  const changed = [];
  for (const path of Object.keys(current.files)) {
    if (!(path in baseline.files)) added.push(path);
    else if (current.files[path] !== baseline.files[path]) changed.push(path);
  }
  for (const path of Object.keys(baseline.files)) {
    if (!(path in current.files)) removed.push(path);
  }
  const detail = [
    changed.length ? `changed:\n  ${changed.join("\n  ")}` : "",
    added.length ? `added:\n  ${added.join("\n  ")}` : "",
    removed.length ? `removed:\n  ${removed.join("\n  ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  fail(
    `Digest mismatch.\n  baseline ${baseline.digest} (${baseline.fileCount} files)\n  current  ${current.digest} (${current.fileCount} files)`,
    detail,
  );
}

const git = gitIsClean();
if (!git.clean) fail("Byte digest matched but git reports protected-path changes.", git.detail);

console.log(`PROTECTED FRONTEND BOUNDARY UNCHANGED`);
console.log(`${current.fileCount} files · digest ${current.digest}`);
