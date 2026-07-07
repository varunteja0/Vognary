import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { runConnectorSyncJob } from "@/lib/server/connector-sync-runner";
import { isDatabaseConfigured } from "@/lib/server/database";
import { requireInternalSecret } from "@/lib/server/internal-auth";
import { listDueConnectorSyncJobs } from "@/lib/server/sync-job-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = requireCronSecret(request);
  if (auth) return auth;

  return runDueJobs(request);
}

export async function POST(request: Request) {
  const auth = requireInternalSecret(request);
  if (auth) return auth;

  return runDueJobs(request);
}

async function runDueJobs(request: Request) {
  const limit = await rateLimit(request, { namespace: "internal-sync-due-run", limit: 20, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  if (!isDatabaseConfigured()) {
    return Response.json({
      status: "not-configured",
      requiredEnv: ["DATABASE_URL"],
      message: "DATABASE_URL is required for due sync-job execution.",
    }, { status: 501 });
  }

  const url = new URL(request.url);
  const batchSize = clampNumber(Number.parseInt(url.searchParams.get("limit") ?? "5", 10), 1, 10);
  const jobs = await listDueConnectorSyncJobs(batchSize);
  const results = [];

  for (const job of jobs) {
    try {
      results.push(await runConnectorSyncJob(job.id));
    } catch (error) {
      results.push({
        status: "failed" as const,
        jobId: job.id,
        error: error instanceof Error ? error.message : "Sync job failed before execution.",
      });
    }
  }

  const failed = results.filter((result) => result.status === "failed").length;
  return Response.json({
    status: failed ? "completed-with-failures" : "completed",
    schedule: request.headers.get("x-vercel-cron-schedule"),
    selectedJobs: jobs.length,
    failed,
    results,
  }, { status: failed ? 207 : 200 });
}

function requireCronSecret(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return Response.json({
      status: "not-configured",
      requiredEnv: ["CRON_SECRET"],
      message: "Configure CRON_SECRET in Vercel before enabling scheduled sync execution.",
    }, { status: 501 });
  }

  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized cron invocation." }, { status: 401 });
  }

  return null;
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(value, max));
}