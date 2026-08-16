import { createRecoveryRequestId, RecoveryServiceError, recoveryFailureResponse } from "@/lib/server/recovery-api";
import { vetoAutopilotCandidateByToken } from "@/lib/server/recovery-autopilot-store";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ token: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { token: rawToken } = await context.params;
  const token = decodeURIComponent(rawToken ?? "").trim();
  if (!token || token.length > 2_000) {
    return recoveryFailureResponse(new RecoveryServiceError("FORBIDDEN"), createRecoveryRequestId());
  }
  const rate = await rateLimit(request, {
    namespace: "autopilot-signed-veto",
    limit: 30,
    windowMs: 60 * 60_000,
    identity: token.slice(0, 32),
  });
  if (!rate.allowed) {
    return recoveryFailureResponse(new RecoveryServiceError("RATE_LIMITED"), createRecoveryRequestId());
  }
  try {
    const result = await vetoAutopilotCandidateByToken(token);
    return Response.json({
      status: result.replayed ? "already-vetoed" : "vetoed",
      candidateId: result.candidate.id,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof RecoveryServiceError) {
      return recoveryFailureResponse(error, createRecoveryRequestId());
    }
    throw error;
  }
}
