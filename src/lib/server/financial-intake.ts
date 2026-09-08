import "server-only";
import { isCommitmentControlWorkspaceEnrolled } from "@/lib/commitment-control/enrollment";
import { isDatabaseConfigured } from "@/lib/server/database";
import { RecoveryServiceError } from "@/lib/server/recovery-api";
import { readCurrentSession } from "@/lib/server/session";

const financialIntakeMessage = "Financial intake requires an authorized workspace cleared for customer data. Public demonstrations use fixed synthetic data only.";

export function requireFinancialIntakeWorkspace(workspaceId: string) {
  if (!isCommitmentControlWorkspaceEnrolled(workspaceId)) throw new RecoveryServiceError("FORBIDDEN", financialIntakeMessage);
}

export async function rejectUnclearedFinancialRequest(request: Request): Promise<Response | null> {
  try {
    const session = isDatabaseConfigured() ? await readCurrentSession(request) : null;
    const target = request.headers.get("X-Vognary-Workspace");
    if (session?.workspaceId && (target === null || target === session.workspaceId)) {
      requireFinancialIntakeWorkspace(session.workspaceId);
      return null;
    }
  } catch {
    return Response.json({ code: "FINANCIAL_INTAKE_LOCKED", error: financialIntakeMessage }, { status: 403 });
  }
  return Response.json({ code: "FINANCIAL_INTAKE_LOCKED", error: financialIntakeMessage }, { status: 403 });
}
