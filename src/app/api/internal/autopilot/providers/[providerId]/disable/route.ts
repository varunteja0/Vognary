import { requireInternalSecret } from "@/lib/server/internal-auth";
import { isDatabaseConfigured } from "@/lib/server/database";
import { RecoveryServiceError, recoveryFailureResponse, createRecoveryRequestId } from "@/lib/server/recovery-api";
import { disableProviderEmergency } from "@/lib/server/recovery-autopilot-store";
import { readLimitedJson, RequestBodyTooLargeError, UnsupportedContentTypeError } from "@/lib/server/request-body";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "cache-control": "no-store" };

type RouteContext = { params: Promise<{ providerId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const unauthorized = requireInternalSecret(request);
  if (unauthorized) return unauthorized;
  if (!isDatabaseConfigured()) {
    return Response.json({ status: "not-configured" }, { status: 501, headers });
  }
  try {
    const { providerId } = await context.params;
    const id = providerId.trim();
    if (!id || id.length > 80) throw new RecoveryServiceError("INVALID_EVIDENCE", "Unknown provider.");
    let reason = "emergency-disable";
    try {
      const body = await readLimitedJson<Record<string, unknown>>(request, 4 * 1024);
      if (typeof body.reason === "string" && body.reason.trim()) reason = body.reason.trim();
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError || error instanceof UnsupportedContentTypeError) throw error;
    }
    const result = await disableProviderEmergency({
      providerId: id,
      reason,
    });
    return Response.json({
      status: "disabled",
      providerId: result.providerId,
      disabled: result.disabled,
    }, { status: 200, headers });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return Response.json({ error: "Provider disable payload is too large." }, { status: 413, headers });
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
