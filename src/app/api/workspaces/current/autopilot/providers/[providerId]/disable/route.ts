import { createRecoveryRequestId, RecoveryServiceError, recoveryFailureResponse } from "@/lib/server/recovery-api";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return recoveryFailureResponse(new RecoveryServiceError("FORBIDDEN"), createRecoveryRequestId());
  return recoveryFailureResponse(
    new RecoveryServiceError("FORBIDDEN", "Provider kill switches are founder/internal-operator only."),
    createRecoveryRequestId(),
  );
}
