import {
  aggregateInsightMaxCommitmentsPerWorkspace,
  aggregateInsightMinimumWorkspaces,
} from "@/lib/aggregate-insights";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { listPrivacySafeAggregateInsights } from "@/lib/server/aggregate-insight-store";
import { hasActiveConsentGrant } from "@/lib/server/consent-store";
import { isDatabaseConfigured } from "@/lib/server/database";
import { requireSession, requireWorkspaceRole } from "@/lib/server/workspace-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const limit = await rateLimit(request, { namespace: "workspace-benchmarks-read", limit: 30, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);
  const session = await requireSession(request);
  if (session instanceof Response) return session;
  if (!session.workspaceId) return Response.json({ error: "Session has no workspace." }, { status: 400 });
  if (!isDatabaseConfigured()) return Response.json({ status: "not-configured" }, { status: 501 });
  const authorization = await requireWorkspaceRole(request, session.workspaceId, "viewer");
  if (authorization instanceof Response) return authorization;
  const consented = await hasActiveConsentGrant({
    userId: session.userId,
    email: session.email,
    workspaceId: session.workspaceId,
    purpose: "merchant-intelligence-opt-in",
  });
  if (!consented) return Response.json({
    error: "Anonymous category benchmarks require an explicit opt-in.",
    code: "benchmark-consent-required",
  }, { status: 403, headers: { "cache-control": "private, no-store" } });
  return Response.json({
    status: "ok",
    privacy: {
      minimumWorkspaceCohort: aggregateInsightMinimumWorkspaces,
      maximumCommitmentsPerWorkspaceAndCohort: aggregateInsightMaxCommitmentsPerWorkspace,
      publicationCadence: "daily",
      coarsening: "workspace and commitment counts are banded; monthly costs are currency-rounded",
      dimensions: ["category", "currency", "frequency"],
      excluded: ["merchant", "workspace", "user", "date", "evidence", "notes", "provider account"],
    },
    benchmarks: await listPrivacySafeAggregateInsights(),
  }, { headers: { "cache-control": "private, no-store" } });
}
