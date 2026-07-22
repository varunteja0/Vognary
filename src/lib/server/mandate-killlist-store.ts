import "server-only";

import { buildMandateKillList, type MandateKill } from "@/lib/mandate-killlist";
import { getWorkspaceAudit } from "@/lib/server/workspace-audit-store";

// The canonical, headless UPI mandate kill-list for a workspace. Derives from the
// same shared audit as the brief, so the mandates surfaced in the app, in a
// weekly digest, and (once keyed) in AI narration are always the same set —
// classified from the same statement evidence by the same deterministic engine.
export async function getWorkspaceMandateKillList(workspaceId: string): Promise<MandateKill[]> {
  const audit = await getWorkspaceAudit(workspaceId);
  return buildMandateKillList(audit.recurringItems);
}
