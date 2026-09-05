import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const transientHttpStatuses = new Set([408, 429, 500, 502, 503, 504]);
const transientNetworkCodes = new Set(["ETIMEDOUT", "ECONNRESET", "EAI_AGAIN"]);

export function runDependencyAudit({
  omitDev = false,
  execute = spawnSync,
  write = (text) => { process.stdout.write(text); },
  warn = (text) => { process.stderr.write(text); },
} = {}) {
  const args = ["audit", "--json", "--audit-level=high", "--fetch-timeout=30000", "--fetch-retries=0"];
  if (omitDev) args.push("--omit=dev");

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = execute("npm", args, {
      encoding: "utf8",
      timeout: 120_000,
      killSignal: "SIGKILL",
      maxBuffer: 8 * 1024 * 1024,
    });
    let report;
    try {
      report = JSON.parse(result.stdout);
    } catch {
      report = null;
    }
    const counts = report?.metadata?.vulnerabilities;
    const hasAuditReport = report?.auditReportVersion === 2
      && report.vulnerabilities !== null
      && typeof report.vulnerabilities === "object"
      && !Array.isArray(report.vulnerabilities)
      && Number.isSafeInteger(counts?.high) && counts.high >= 0
      && Number.isSafeInteger(counts?.critical) && counts.critical >= 0;
    const failureExit = Number.isInteger(result.status) && result.status > 0 ? result.status : 1;

    if (result.stdout) write(`${result.stdout.trimEnd()}\n`);
    if (result.stderr) warn(`${result.stderr.trimEnd()}\n`);
    if (hasAuditReport) {
      const passed = result.status === 0 && !result.error && !result.signal && !report.error
        && counts.high === 0 && counts.critical === 0;
      if (!passed) warn("Dependency audit failed. Resolve the reported findings or npm execution error before release.\n");
      return passed ? 0 : failureExit;
    }

    const errorCode = result.error?.code ?? report?.error?.code ?? report?.code;
    const transient = result.status !== 0
      && (transientHttpStatuses.has(report?.statusCode) || transientNetworkCodes.has(errorCode));
    const reason = report?.statusCode ? `HTTP ${report.statusCode}` : errorCode ?? "missing or invalid audit report";
    if (transient && attempt < 3) {
      warn(`Dependency audit inconclusive (${reason}); retrying after attempt ${attempt}/3.\n`);
      continue;
    }
    warn(`Dependency audit failed (${reason}; attempt ${attempt}/3). Restore registry access or fix npm, then rerun this gate.\n`);
    return failureExit;
  }
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--omit=dev")) {
    console.error("Usage: node scripts/check-dependency-audit.mjs [--omit=dev]");
    process.exitCode = 1;
  } else {
    process.exitCode = runDependencyAudit({ omitDev: args.includes("--omit=dev") });
  }
}