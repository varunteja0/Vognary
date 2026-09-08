import { createRecoveryRequestId, RecoveryServiceError, recoveryFailureResponse } from "@/lib/server/recovery-api";
import { readRecoveryJson, runRecoveryRoute } from "@/lib/server/recovery-route";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import { configuredZohoBooksService } from "@/lib/server/zoho-books-configuration";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "cache-control": "private, no-store" };
type Context = { params: Promise<{ billId: string }> };

export async function GET(request: Request, context: Context) {
  return runRecoveryRoute(request, { namespace: "zoho-bill-detail", limit: 240, windowMs: 60_000 }, async ({ session }) => {
    const { billId } = await context.params;
    const query = new URL(request.url).searchParams;
    const data = await configuredZohoBooksService(session.workspaceId).detail(session.workspaceId, session.userId, billId, {
      cursor: query.get("cursor") ?? undefined, eventCursor: query.get("eventCursor") ?? undefined, followUpCursor: query.get("followUpCursor") ?? undefined,
      sequence: query.get("revision") ?? undefined,
    });
    return Response.json({ data }, { headers });
  });
}

export async function POST(request: Request, context: Context) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return recoveryFailureResponse(new RecoveryServiceError("FORBIDDEN"), createRecoveryRequestId());
  return runRecoveryRoute(request, { namespace: "zoho-bill-disposition", financialIntake: true, limit: 60, windowMs: 60_000 }, async ({ session }) => {
    const { billId } = await context.params;
    const body = await readRecoveryJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new RecoveryServiceError("INVALID_EVIDENCE");
    const data = await configuredZohoBooksService(session.workspaceId).disposition(session.workspaceId, session.userId, {
      ...body, billId, idempotencyKey: request.headers.get("idempotency-key") ?? "",
    });
    return Response.json({ data }, { headers });
  });
}
