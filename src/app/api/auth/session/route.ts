import {
  createRecoveryRequestId,
  RecoveryServiceError,
  recoveryFailureResponse,
} from "@/lib/server/recovery-api";
import { checkSessionConfiguration, readCurrentSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const configuration = checkSessionConfiguration();
  let session: Awaited<ReturnType<typeof readCurrentSession>>;
  try {
    session = await readCurrentSession(request);
  } catch {
    return recoveryFailureResponse(
      new RecoveryServiceError("DATABASE_UNAVAILABLE", undefined, { retryable: true }),
      createRecoveryRequestId(),
    );
  }
  const authenticated = Boolean(session?.workspaceId);

  return Response.json({
    authenticated,
    configuration,
    session: session?.workspaceId ? {
      userId: session.userId,
      email: session.email,
      workspaceId: session.workspaceId,
      expiresAt: new Date(session.expiresAt).toISOString(),
    } : null,
  }, { headers: { "cache-control": "private, no-store" } });
}
