import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { deleteAuditSnapshots, getLatestAuditSnapshot, saveAuditSnapshot, type AuditSnapshotSummary } from "@/lib/server/audit-snapshot-store";
import { isDatabaseConfigured } from "@/lib/server/database";
import { checkTokenVaultConfiguration } from "@/lib/server/token-vault";
import { readLimitedJson, RequestBodyTooLargeError, UnsupportedContentTypeError } from "@/lib/server/request-body";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import { requireSession } from "@/lib/server/workspace-auth";
import { WorkspaceStateValidationError } from "@/lib/server/workspace-state-materializer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SnapshotRequest = {
  title?: string;
  summary?: Partial<AuditSnapshotSummary>;
  snapshot?: unknown;
  expectedRevision?: number | null;
};

const maxSnapshotRequestBytes = 12 * 1024 * 1024;

export async function GET(request: Request) {
  const limit = await rateLimit(request, { namespace: "audit-snapshot-read", limit: 60, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const ready = await getSnapshotReadiness(request);
  if (ready instanceof Response) return ready;

  const snapshot = await getLatestAuditSnapshot(ready.workspaceId);
  return Response.json({ status: snapshot ? "ok" : "empty", snapshot });
}

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;

  const limit = await rateLimit(request, { namespace: "audit-snapshot-save", limit: 20, windowMs: 60 * 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const ready = await getSnapshotReadiness(request);
  if (ready instanceof Response) return ready;

  const body = await readSnapshotJson(request);
  if (body instanceof Response) return body;
  if (!isWorkspaceSnapshot(body.snapshot)) {
    return Response.json({ error: "Valid Vognary workspace snapshot is required." }, { status: 400 });
  }
  if (body.expectedRevision != null && normalizeRevision(body.expectedRevision) === null) {
    return Response.json({ error: "expectedRevision must be a positive safe integer or null." }, { status: 400 });
  }

  const summary = normalizeSummary(body.summary);
  let saved: Awaited<ReturnType<typeof saveAuditSnapshot>>;
  try {
    saved = await saveAuditSnapshot({
      workspaceId: ready.workspaceId,
      userId: ready.session.userId,
      title: body.title?.trim() || "Vognary workspace snapshot",
      summary,
      snapshot: body.snapshot,
      expectedRevision: normalizeRevision(body.expectedRevision),
    });
  } catch (error) {
    if (error instanceof WorkspaceStateValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({ error: "Workspace state could not be stored." }, { status: 502 });
  }

  if (saved.status === "conflict") {
    return Response.json({
      error: "Workspace state changed on another device. Reload before saving again.",
      code: "workspace_revision_conflict",
      currentRevision: saved.currentRevision,
    }, { status: 409 });
  }

  return Response.json({ status: "saved", snapshot: saved }, { status: 201 });
}

export async function DELETE(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;

  const limit = await rateLimit(request, { namespace: "audit-snapshot-delete", limit: 8, windowMs: 60 * 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const ready = await getSnapshotReadiness(request);
  if (ready instanceof Response) return ready;

  const deletedCount = await deleteAuditSnapshots({ workspaceId: ready.workspaceId, userId: ready.session.userId });
  return Response.json({ status: "deleted", deletedCount });
}

async function getSnapshotReadiness(request: Request) {
  const session = await requireSession(request);
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

async function readSnapshotJson(request: Request): Promise<SnapshotRequest | Response> {
  try {
    return await readLimitedJson<SnapshotRequest>(request, maxSnapshotRequestBytes);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return Response.json({ error: "Workspace snapshot is too large." }, { status: 413 });
    if (error instanceof UnsupportedContentTypeError) return Response.json({ error: "Content-Type must be application/json." }, { status: 415 });
    return Response.json({ error: "Workspace snapshot must be valid JSON." }, { status: 400 });
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

function normalizeRevision(value: unknown) {
  if (value == null) return null;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}
