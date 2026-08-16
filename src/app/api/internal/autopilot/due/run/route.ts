import { requireCronSecret, requireInternalSecret } from "@/lib/server/internal-auth";
import { isDatabaseConfigured } from "@/lib/server/database";
import { isAutopilotExecutionEnabled, isAutopilotNoticeEnabled } from "@/lib/recovery/autopilot-switch";
import { authorizeSilentCases, expireUnboundNoticeEvents, measureShadowGate, queueDueNotices, readAutopilotOpsMetrics } from "@/lib/server/recovery-autopilot-store";
import { autopilotSloBreaches } from "@/lib/recovery/autopilot-metrics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "cache-control": "no-store" };

async function run() {
  if (!isDatabaseConfigured()) {
    return Response.json({ status: "not-configured" }, { status: 501, headers });
  }
  const shadow = await measureShadowGate();
  const notices = isAutopilotNoticeEnabled() ? await queueDueNotices() : { queued: 0, delivered: 0 };
  const expiredPending = await expireUnboundNoticeEvents();
  const authorized = isAutopilotExecutionEnabled() && shadow.passed
    ? await authorizeSilentCases()
    : { authorized: 0 };
  const metrics = await readAutopilotOpsMetrics();
  return Response.json({
    status: "completed",
    executionEnabled: isAutopilotExecutionEnabled(),
    noticeEnabled: isAutopilotNoticeEnabled(),
    shadow,
    notices,
    expiredPending,
    authorized,
    metrics,
    sloBreaches: autopilotSloBreaches(metrics),
  }, { headers });
}

export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;
  return run();
}

export async function POST(request: Request) {
  const unauthorized = requireInternalSecret(request);
  if (unauthorized) return unauthorized;
  return run();
}
