import { requireInternalSecret } from "@/lib/server/internal-auth";
import { isDatabaseConfigured } from "@/lib/server/database";
import { RecoveryServiceError, recoveryFailureResponse, createRecoveryRequestId } from "@/lib/server/recovery-api";
import { recordOperatorExecution } from "@/lib/server/recovery-autopilot-store";
import { readLimitedJson, RequestBodyTooLargeError, UnsupportedContentTypeError } from "@/lib/server/request-body";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "cache-control": "no-store" };

export async function POST(request: Request) {
  const unauthorized = requireInternalSecret(request);
  if (unauthorized) return unauthorized;
  if (!isDatabaseConfigured()) {
    return Response.json({ status: "not-configured" }, { status: 501, headers });
  }
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 160) {
    return recoveryFailureResponse(
      new RecoveryServiceError("INVALID_EVIDENCE", "Operator execution needs an Idempotency-Key."),
      createRecoveryRequestId(),
    );
  }
  try {
    const body = await readLimitedJson<Record<string, unknown>>(request, 8 * 1024);
    const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : "";
    const candidateId = typeof body.candidateId === "string" ? body.candidateId : "";
    const actorUserId = typeof body.actorUserId === "string" ? body.actorUserId : "";
    const minutes = typeof body.minutes === "number" ? body.minutes : Number.NaN;
    const outcome = body.outcome;
    if (!workspaceId || !candidateId || !actorUserId || !Number.isFinite(minutes) || minutes < 0) {
      throw new RecoveryServiceError("INVALID_EVIDENCE", "Operator execution needs workspace, candidate, actor, and minutes.");
    }
    if (outcome !== "EXECUTED" && outcome !== "EXCEPTION" && outcome !== "FAILED") {
      throw new RecoveryServiceError("INVALID_EVIDENCE", "Operator outcome must be EXECUTED, EXCEPTION, or FAILED.");
    }
    const result = await recordOperatorExecution({
      workspaceId,
      actorUserId,
      candidateId,
      minutes,
      outcome,
      idempotencyKey,
      proofKind: typeof body.proofKind === "string" ? body.proofKind : undefined,
      proofReference: typeof body.proofReference === "string" ? body.proofReference : undefined,
      failureReason: typeof body.failureReason === "string" ? body.failureReason : undefined,
    });
    return Response.json({
      status: result.replayed ? "replayed" : "recorded",
      outcome: result.outcome,
      attemptNo: result.attemptNo,
      operationKey: result.operationKey,
    }, { status: result.replayed ? 200 : 201, headers });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return Response.json({ error: "Operator execution payload is too large." }, { status: 413, headers });
    }
    if (error instanceof UnsupportedContentTypeError) {
      return Response.json({ error: "Content-Type must be application/json." }, { status: 415, headers });
    }
    if (error instanceof RecoveryServiceError) {
      return recoveryFailureResponse(error, createRecoveryRequestId());
    }
    throw error;
  }
}
