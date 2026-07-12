import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { runConnectorSyncJob } from "@/lib/server/connector-sync-runner";
import { isDatabaseConfigured } from "@/lib/server/database";
import { requireInternalSecret } from "@/lib/server/internal-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type InternalSyncJobRunContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: InternalSyncJobRunContext) {
  const auth = requireInternalSecret(request);
  if (auth) return auth;

  const limit = await rateLimit(request, { namespace: "internal-sync-job-run", limit: 60, windowMs: 60_000, requireShared: true });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const { id } = await context.params;
  if (!isUuid(id)) return Response.json({ error: "Sync job id must be a UUID." }, { status: 400 });
  if (!isDatabaseConfigured()) {
    return Response.json({
      status: "not-configured",
      requiredEnv: ["DATABASE_URL"],
      message: "DATABASE_URL is required for internal sync job execution.",
    }, { status: 501 });
  }

  try {
    const result = await runConnectorSyncJob(id, "internal-api");
    const status = result.status === "not-found" ? 404 : result.status === "failed" ? 502 : 200;
    return Response.json(result, { status });
  } catch (error) {
    return Response.json({
      status: "sync-job-run-failed",
      error: error instanceof Error ? error.message : "Unable to run sync job.",
    }, { status: 500 });
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}