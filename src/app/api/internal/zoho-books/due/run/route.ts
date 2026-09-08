import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { isDatabaseConfigured } from "@/lib/server/database";
import { requireCronSecret, requireInternalSecret } from "@/lib/server/internal-auth";
import { reportServerError } from "@/lib/server/monitoring";
import { configuredZohoBooksService, readZohoBooksConfiguration } from "@/lib/server/zoho-books-configuration";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "cache-control": "no-store" };

export async function GET(request: Request) {
  const denied = requireCronSecret(request);
  return denied ?? run(request);
}

export async function POST(request: Request) {
  const denied = requireInternalSecret(request);
  return denied ?? run(request);
}

async function run(request: Request) {
  const limit = await rateLimit(request, { namespace: "zoho-books-worker", limit: 10, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);
  if (!isDatabaseConfigured() || !readZohoBooksConfiguration()) return Response.json({ status: "not-configured", requiredEnv: ["DATABASE_URL", "ZOHO_BOOKS_CLIENT_ID", "ZOHO_BOOKS_CLIENT_SECRET", "ZOHO_BOOKS_PILOT_WORKSPACE_IDS"] }, { status: 501, headers });
  const result = await configuredZohoBooksService().runDue();
  for (const failure of result.failures) {
    await reportServerError(new Error(`Zoho Books worker: ${failure.code}`), { path: "/api/internal/zoho-books/due/run", method: request.method, headers: {} }, { boundary: "zoho-books-worker", connectionId: failure.connectionId, code: failure.code }).catch(() => undefined);
  }
  return Response.json({ status: result.failures.length ? "completed-with-failures" : "completed", ...result }, { status: result.failures.length ? 207 : 200, headers });
}
