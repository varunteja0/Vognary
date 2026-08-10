import { recoveryLimits } from "@/lib/recovery/contracts";
import { rateLimit } from "@/lib/rate-limit";
import {
  createRecoveryRequestId,
  RecoveryServiceError,
  recoveryFailureResponse,
} from "@/lib/server/recovery-api";
import { isDatabaseConfigured } from "@/lib/server/database";
import { reportServerError } from "@/lib/server/monitoring";
import {
  readLimitedJson,
  RequestBodyTooLargeError,
  UnsupportedContentTypeError,
} from "@/lib/server/request-body";
import { readCurrentSession, type AuthSession } from "@/lib/server/session";

type RecoveryRouteContext = {
  requestId: string;
  session: AuthSession & { workspaceId: string };
};

type RecoveryRouteOptions = {
  namespace: string;
  limit: number;
  windowMs: number;
};

export async function runRecoveryRoute(
  request: Request,
  options: RecoveryRouteOptions,
  handler: (context: RecoveryRouteContext) => Promise<Response>,
) {
  const requestId = createRecoveryRequestId();
  try {
    const rate = await rateLimit(request, options);
    if (!rate.allowed) {
      if (rate.blockReason === "shared-backend-error" || rate.blockReason === "shared-backend-required") {
        throw new RecoveryServiceError("DATABASE_UNAVAILABLE", undefined, { retryable: true });
      }
      throw new RecoveryServiceError("RATE_LIMITED", undefined, {
        retryAfterSeconds: Math.max(1, rate.retryAfter),
      });
    }
    if (!isDatabaseConfigured()) {
      throw new RecoveryServiceError("DATABASE_UNAVAILABLE", undefined, { retryable: true });
    }
    const session = await readCurrentSession(request);
    if (!session) throw new RecoveryServiceError("AUTH_REQUIRED");
    if (!session.workspaceId) throw new RecoveryServiceError("FORBIDDEN");
    return await handler({ requestId, session: { ...session, workspaceId: session.workspaceId } });
  } catch (error) {
    if (shouldReportRecoveryError(error)) {
      await reportServerError(error, {
        path: new URL(request.url).pathname,
        method: request.method,
        headers: {
          "user-agent": request.headers.get("user-agent") ?? undefined,
          "x-request-id": requestId,
        },
      }, {
        boundary: "recovery-api",
        requestId,
        code: error instanceof RecoveryServiceError ? error.code : "UNKNOWN",
      }).catch(() => undefined);
    }
    return recoveryFailureResponse(error, requestId);
  }
}

export async function readRecoveryJson(request: Request) {
  try {
    return await readLimitedJson<unknown>(request, recoveryLimits.maxRequestBytes);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      throw new RecoveryServiceError("REQUEST_TOO_LARGE");
    }
    if (error instanceof UnsupportedContentTypeError) {
      throw new RecoveryServiceError("UNSUPPORTED_MEDIA_TYPE");
    }
    throw new RecoveryServiceError("INVALID_EVIDENCE", "Recovery request must be valid JSON.");
  }
}

export function requireRecoveryUuid(value: string, label: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new RecoveryServiceError("NOT_FOUND", `${label} must be a UUID.`);
  }
  return value;
}

export function readRecoveryPageSize(value: string | null, label: string, maximum: number) {
  if (value === null || value === "") return undefined;
  if (!/^\d+$/.test(value)) throw new RecoveryServiceError("INVALID_EVIDENCE", `${label} must be an integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new RecoveryServiceError("INVALID_EVIDENCE", `${label} must be between 1 and ${maximum}.`);
  }
  return parsed;
}

function shouldReportRecoveryError(error: unknown) {
  if (!(error instanceof RecoveryServiceError)) return true;
  return ["DATABASE_UNAVAILABLE", "SAVE_FAILED", "UNKNOWN"].includes(error.code);
}
