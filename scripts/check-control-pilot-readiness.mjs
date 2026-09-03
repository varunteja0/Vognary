import {
  evaluateControlPilotReadiness,
  formatControlPilotReadiness,
} from "./lib/control-pilot-readiness.mjs";
import { getCommitmentControlEnrollmentReadiness } from "../src/lib/commitment-control/enrollment.ts";

const args = process.argv.slice(2);
const reportOnly = args.includes("--report-only");
const json = args.includes("--json");
const targetArg = args.find((arg) => arg.startsWith("http://") || arg.startsWith("https://"));
const target = (targetArg || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");

if (args.includes("--help")) {
  console.log(`Check first-customer Commitment Control readiness without printing secrets or restricted records.

Usage:
  npm run control:preflight -- --report-only https://www.vognary.com
  npm run control:preflight -- --json https://www.vognary.com

Default exits non-zero while any customer-data gate is blocked. --report-only always returns the evidence report.`);
  process.exit(0);
}

const targetReadiness = await readTargetReadiness(target);
const enrollment = targetReadiness.enrollment ?? getCommitmentControlEnrollmentReadiness({ nodeEnv: "production" });
const result = evaluateControlPilotReadiness({
  environment: process.env,
  enrollment,
  appliedMigrations: targetReadiness.appliedMigrations,
  targetReadinessAuthenticated: targetReadiness.authenticated,
  targetCommitSha: targetReadiness.commitSha,
});

console.log(json ? JSON.stringify(result, null, 2) : formatControlPilotReadiness(result));
if (!reportOnly && result.status !== "ready") process.exitCode = 1;

async function readTargetReadiness(baseUrl) {
  if (!baseUrl) return { authenticated: false, appliedMigrations: [], enrollment: null, commitSha: null };
  const secret = process.env.PRODUCTION_INTERNAL_SYNC_SECRET?.trim()
    || process.env.INTERNAL_SYNC_SECRET?.trim()
    || "";
  if (!secret) return { authenticated: false, appliedMigrations: [], enrollment: null, commitSha: null };
  try {
    const response = await fetch(`${baseUrl}/api/readiness`, {
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { authenticated: false, appliedMigrations: [], enrollment: null, commitSha: null };
    const payload = await response.json();
    const appliedMigrations = Array.isArray(payload.capabilities?.schema?.applied)
      ? payload.capabilities.schema.applied.filter((value) => typeof value === "string")
      : [];
    const enrollmentValue = payload.hardening?.commitmentControlEnrollment;
    const enrollment = enrollmentValue && typeof enrollmentValue === "object"
      ? {
          status: typeof enrollmentValue.status === "string" ? enrollmentValue.status : "unavailable",
          enrolledWorkspaceCount: Number.isInteger(enrollmentValue.enrolledWorkspaceCount)
            ? enrollmentValue.enrolledWorkspaceCount
            : 0,
        }
      : null;
    const commitSha = typeof payload.release?.commitSha === "string"
      ? payload.release.commitSha
      : null;
    return { authenticated: true, appliedMigrations, enrollment, commitSha };
  } catch {
    return { authenticated: false, appliedMigrations: [], enrollment: null, commitSha: null };
  }
}