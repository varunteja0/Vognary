import { getDatabasePool } from "@/lib/server/database";
import { createRecoveryRequestId, RecoveryServiceError, recoveryFailureResponse } from "@/lib/server/recovery-api";
import { readRecoveryJson, runRecoveryRoute } from "@/lib/server/recovery-route";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import { configuredZohoBooksService, requireZohoBooksConfiguration } from "@/lib/server/zoho-books-configuration";
import type { ZohoBooksSort, ZohoBooksView } from "@/lib/zoho-books/contracts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "cache-control": "private, no-store" };

export async function GET(request: Request) {
  return runRecoveryRoute(request, { namespace: "zoho-books-read", limit: 240, windowMs: 60_000 }, async ({ session }) => {
    const installed = await getDatabasePool().query("select to_regclass('recovery_provider_bill_links') as installed");
    if (!installed.rows[0]?.installed) return Response.json({ data: { configured: false, canManage: false, connection: null, organizations: [], items: [], total: 0, nextCursor: null, throughSequence: "0" }, unavailableReason: "MIGRATION_REQUIRED" }, { headers });
    const url = new URL(request.url);
    const view = url.searchParams.get("view");
    if (view !== null && !["ALL", "ATTENTION", "FOLLOW_UP", "RESOLVED"].includes(view)) throw new RecoveryServiceError("INVALID_EVIDENCE");
    const data = await configuredZohoBooksService(session.workspaceId).read(session.workspaceId, session.userId, {
      cursor: url.searchParams.get("cursor") ?? undefined,
      changesOnly: url.searchParams.get("changes") === "true",
      view: (view ?? undefined) as ZohoBooksView | undefined,
      search: url.searchParams.get("search") ?? undefined,
      sort: (url.searchParams.get("sort") ?? undefined) as ZohoBooksSort | undefined,
      currency: url.searchParams.get("currency") ?? undefined,
    });
    return Response.json({ data }, { headers });
  });
}

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return recoveryFailureResponse(new RecoveryServiceError("FORBIDDEN"), createRecoveryRequestId());
  return runRecoveryRoute(request, { namespace: "zoho-books-write", limit: 60, windowMs: 60_000 }, async ({ session }) => {
    const body = await readRecoveryJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new RecoveryServiceError("INVALID_EVIDENCE", "A source action object is required.");
    const input = body as Record<string, unknown>;
    const service = configuredZohoBooksService(session.workspaceId);
    if (input.action === "AUTHORIZE") {
      requireZohoBooksConfiguration(session.workspaceId);
      if (input.consentVersion !== "zoho-books-read-v1") throw new RecoveryServiceError("INVALID_EVIDENCE", "Confirm the read-only source notice before continuing.");
      return Response.json({ data: await service.begin(session.workspaceId, session.userId) }, { headers });
    }
    if (typeof input.revision !== "string" || !/^[1-9]\d{0,18}$/.test(input.revision)) throw new RecoveryServiceError("INVALID_EVIDENCE", "The source revision is required.");
    if (input.action === "SELECT") {
      requireZohoBooksConfiguration(session.workspaceId);
      if (typeof input.organizationId !== "string") throw new RecoveryServiceError("INVALID_EVIDENCE");
      await service.select(session.workspaceId, session.userId, input.organizationId, input.revision);
      await service.runDue(new Date(), { limit: 1, maxSteps: 1, workspaceId: session.workspaceId });
    } else if (input.action === "REVIEW") {
      if (!Array.isArray(input.sequences) || !input.sequences.every(sequence => typeof sequence === "string")) throw new RecoveryServiceError("INVALID_EVIDENCE");
      await service.review(session.workspaceId, session.userId, input.sequences, input.revision);
    } else if (input.action === "RESUME") {
      if (typeof input.incidentId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.incidentId)) throw new RecoveryServiceError("INVALID_EVIDENCE");
      await service.resume(session.workspaceId, session.userId, input.incidentId, input.revision);
    } else if (input.action === "ESCALATE") {
      if (typeof input.incidentId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.incidentId)) throw new RecoveryServiceError("INVALID_EVIDENCE");
      await service.escalate(session.workspaceId, session.userId, input.incidentId, input.revision);
    } else if (input.action === "DISCONNECT") {
      await service.disconnect(session.workspaceId, session.userId, input.revision);
    } else if (input.action === "ERASE" && input.confirmation === "DELETE_OBSERVATIONS") {
      if (Object.keys(input).some(key => !["action", "confirmation", "revision", "retentionAcknowledgement"].includes(key))) {
        throw new RecoveryServiceError("INVALID_EVIDENCE", "Source erasure has an unknown field.");
      }
      await service.erase(session.workspaceId, session.userId, input.revision, input.retentionAcknowledgement);
    } else throw new RecoveryServiceError("INVALID_EVIDENCE", "Choose a supported source action.");
    return Response.json({ data: await service.read(session.workspaceId, session.userId) }, { headers });
  });
}
