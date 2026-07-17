import { getConciergeConfiguration } from "@/lib/outcome-cases";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { isDatabaseConfigured } from "@/lib/server/database";
import { requireCronSecret, requireInternalSecret } from "@/lib/server/internal-auth";
import { claimDueSavingVerifications, evaluateVerifiedSaving } from "@/lib/server/outcome-verification-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const authorization = requireCronSecret(request);
  if (authorization) return authorization;
  return runDueVerifications(request, "cron");
}

export async function POST(request: Request) {
  const authorization = requireInternalSecret(request);
  if (authorization) return authorization;
  return runDueVerifications(request, "internal-api");
}

async function runDueVerifications(request: Request, invocation: "cron" | "internal-api") {
  const limit = await rateLimit(request, { namespace: "internal-savings-verification", limit: 20, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);
  if (!isDatabaseConfigured()) return Response.json({ status: "not-configured", requiredEnv: ["DATABASE_URL"] }, { status: 501 });
  const configuration = getConciergeConfiguration();
  if (configuration.status !== "ready") {
    return Response.json({ status: "not-configured", requiredEnv: configuration.missing }, { status: 501 });
  }
  const url = new URL(request.url);
  const parsedLimit = Number.parseInt(url.searchParams.get("limit") ?? "25", 10);
  const batchSize = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(parsedLimit, 50)) : 25;
  const due = await claimDueSavingVerifications(batchSize);
  const results = [];
  for (const actionCase of due) {
    try {
      const result = await evaluateVerifiedSaving(actionCase);
      results.push({ actionCaseId: actionCase.actionCaseId, ...result });
    } catch (error) {
      results.push({
        actionCaseId: actionCase.actionCaseId,
        status: "error" as const,
        error: error instanceof Error ? error.message : "Verification failed before completion.",
      });
    }
  }
  const failures = results.filter((result) => result.status === "error").length;
  return Response.json({
    status: failures ? "completed-with-failures" : "completed",
    invocation,
    selected: due.length,
    failures,
    results,
  }, { status: failures ? 207 : 200, headers: { "cache-control": "no-store" } });
}
