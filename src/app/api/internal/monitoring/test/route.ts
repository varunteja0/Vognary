import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { requireInternalSecret } from "@/lib/server/internal-auth";
import { sendMonitoringTestEvent } from "@/lib/server/monitoring";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = requireInternalSecret(request);
  if (auth) return auth;

  const limit = await rateLimit(request, { namespace: "internal-monitoring-test", limit: 5, windowMs: 60 * 60_000, requireShared: true });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const result = await sendMonitoringTestEvent("internal-api");
  const status = result.status === "delivered" ? 200 : result.status === "not-configured" ? 501 : 502;
  return Response.json(result, { status });
}