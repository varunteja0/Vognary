import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { normalizeRetentionExecutionOptions } from "@/lib/privacy-lifecycle";
import { isDatabaseConfigured } from "@/lib/server/database";
import { readLimitedJson, RequestBodyTooLargeError, UnsupportedContentTypeError } from "@/lib/server/request-body";
import { requireRetentionExecutorSecret } from "@/lib/server/retention-auth";
import { executeRetentionPolicies } from "@/lib/server/retention-executor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const noStoreHeaders = { "cache-control": "no-store", pragma: "no-cache" };

export async function GET(request: Request) {
  const authorization = requireRetentionExecutorSecret(request);
  if (authorization instanceof Response) return authorization;
  return runRetention(request, {
    dryRun: false,
    workspaceId: null,
    afterWorkspaceId: null,
    workspaceLimit: 10,
    batchSize: 500,
  }, authorization.invocation);
}

export async function POST(request: Request) {
  const authorization = requireRetentionExecutorSecret(request);
  if (authorization instanceof Response) return authorization;
  const body = await readExecutionJson(request);
  if (body instanceof Response) return body;
  let options;
  try {
    options = normalizeRetentionExecutionOptions(body);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Retention request is invalid." }, { status: 400, headers: noStoreHeaders });
  }
  return runRetention(request, options, authorization.invocation);
}

async function runRetention(
  request: Request,
  options: ReturnType<typeof normalizeRetentionExecutionOptions>,
  invocation: "cron" | "internal-api",
) {
  const limit = await rateLimit(request, { namespace: "internal-privacy-retention", limit: 10, windowMs: 60 * 60_000, requireShared: true });
  if (!limit.allowed) return rateLimitExceeded(limit);
  if (!isDatabaseConfigured()) return Response.json({
    status: "not-configured",
    requiredEnv: ["DATABASE_URL"],
  }, { status: 501, headers: noStoreHeaders });

  try {
    const result = await executeRetentionPolicies(options, invocation);
    return Response.json(result, {
      status: result.status === "completed-with-failures" ? 207 : 200,
      headers: noStoreHeaders,
    });
  } catch {
    return Response.json({ error: "Retention execution failed." }, { status: 500, headers: noStoreHeaders });
  }
}

async function readExecutionJson(request: Request): Promise<Record<string, unknown> | Response> {
  try {
    return await readLimitedJson<Record<string, unknown>>(request, 4 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return Response.json({ error: "Retention request is too large." }, { status: 413, headers: noStoreHeaders });
    if (error instanceof UnsupportedContentTypeError) return Response.json({ error: "Content-Type must be application/json." }, { status: 415, headers: noStoreHeaders });
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400, headers: noStoreHeaders });
  }
}
