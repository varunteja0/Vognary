import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { deleteAuditSnapshots, getLatestAuditSnapshot, saveAuditSnapshot, type AuditSnapshotSummary } from "@/lib/server/audit-snapshot-store";
import { isDatabaseConfigured } from "@/lib/server/database";
import { checkTokenVaultConfiguration } from "@/lib/server/token-vault";
import { requireSession } from "@/lib/server/workspace-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SnapshotRequest = {
  title?: string;
  summary?: Partial<AuditSnapshotSummary>;
  snapshot?: unknown;
};

export async function GET(request: Request) {
  const limit = rateLimit(request, { namespace: "audit-snapshot-read", limit: 60, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const ready = getSnapshotReadiness(request);
  if (ready instanceof Response) return ready;

  const snapshot = await getLatestAuditSnapshot(ready.workspaceId);
  return Response.json({ status: snapshot ? "ok" : "empty", snapshot });
}

export async function POST(request: Request) {
  const limit = rateLimit(request, { namespace: "audit-snapshot-save", limit: 20, windowMs: 60 * 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const ready = getSnapshotReadiness(request);
  if (ready instanceof Response) return ready;

  const body = await readJson(request);
  if (!isWorkspaceSnapshot(body.snapshot)) {
    return Response.json({ error: "Valid Vognary workspace snapshot is required." }, { status: 400 });
  }

  const summary = normalizeSummary(body.summary);
  const saved = await saveAuditSnapshot({
    workspaceId: ready.workspaceId,
    userId: ready.session.userId,
    title: body.title?.trim() || "Vognary workspace snapshot",
    summary,
    snapshot: body.snapshot,
  });

  return Response.json({ status: "saved", snapshot: saved }, { status: 201 });
}

export async function DELETE(request: Request) {
  const limit = rateLimit(request, { namespace: "audit-snapshot-delete", limit: 8, windowMs: 60 * 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const ready = getSnapshotReadiness(request);
  if (ready instanceof Response) return ready;

  const deletedCount = await deleteAuditSnapshots({ workspaceId: ready.workspaceId, userId: ready.session.userId });
  return Response.json({ status: "deleted", deletedCount });
}

function getSnapshotReadiness(request: Request) {
  const session = requireSession(request);
  if (session instanceof Response) return session;
  if (!session.workspaceId) return Response.json({ error: "Session has no workspace. Sign in again." }, { status: 400 });
  if (!isDatabaseConfigured()) return Response.json({ status: "not-configured", requiredEnv: ["DATABASE_URL"] }, { status: 501 });

  const tokenVault = checkTokenVaultConfiguration();
  if (tokenVault.status !== "ready") {
    return Response.json({
      status: "not-configured",
      requiredEnv: ["TOKEN_ENCRYPTION_KEY"],
      message: tokenVault.message ?? "Encrypted audit snapshot storage requires TOKEN_ENCRYPTION_KEY.",
    }, { status: 501 });
  }

  return { session, workspaceId: session.workspaceId };
}

async function readJson(request: Request): Promise<SnapshotRequest> {
  try {
    return await request.json() as SnapshotRequest;
  } catch {
    return {};
  }
}

function isWorkspaceSnapshot(value: unknown): value is { version: 1; statementSources: unknown[]; manualItems: unknown[] } {
  return Boolean(
    value
    && typeof value === "object"
    && "version" in value
    && (value as { version?: unknown }).version === 1
    && Array.isArray((value as { statementSources?: unknown }).statementSources)
    && Array.isArray((value as { manualItems?: unknown }).manualItems),
  );
}

function normalizeSummary(summary: Partial<AuditSnapshotSummary> | undefined): AuditSnapshotSummary {
  return {
    recurringCount: cleanNumber(summary?.recurringCount),
    monthlyRecurringSpend: cleanNumber(summary?.monthlyRecurringSpend),
    annualRecurringSpend: cleanNumber(summary?.annualRecurringSpend),
    reviewableMonthlySpend: cleanNumber(summary?.reviewableMonthlySpend),
    sourceCount: cleanNumber(summary?.sourceCount),
    manualCount: cleanNumber(summary?.manualCount),
  };
}

function cleanNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}