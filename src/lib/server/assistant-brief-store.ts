import "server-only";

import { buildAssistantBrief, type AssistantBrief } from "@/lib/assistant-brief";
import { getWorkspaceAudit } from "@/lib/server/workspace-audit-store";

// The canonical, headless assistant brief for a workspace. It derives from the
// shared workspace audit (persisted evidence re-run through analyzeStatements),
// so what a person reads here and what a digest email sends can never disagree.
export async function getWorkspaceBrief(workspaceId: string): Promise<AssistantBrief> {
  const audit = await getWorkspaceAudit(workspaceId);
  return buildAssistantBrief({ recurringItems: audit.recurringItems });
}
