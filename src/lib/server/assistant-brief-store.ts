import "server-only";

import { analyzeStatements, type ManualRecurringInput, type StatementSource } from "@/lib/recurring-audit";
import { receiptTextToManualInputs } from "@/lib/receipt-parser";
import { buildAssistantBrief, type AssistantBrief } from "@/lib/assistant-brief";
import { getLatestAuditSnapshot } from "@/lib/server/audit-snapshot-store";

// The canonical, headless assistant brief for a workspace.
//
// It reads the workspace's persisted evidence snapshot and re-runs the SAME
// deterministic engine (analyzeStatements) that materializeWorkspaceState used
// to write recurring_items. Deriving the brief from the same evidence + engine
// guarantees its numbers can never drift from what is stored — no separate query
// path to fall out of sync. When the workspace has no snapshot yet, the brief is
// an honest "all clear over zero commitments", never a fabricated number.
export async function getWorkspaceBrief(workspaceId: string): Promise<AssistantBrief> {
  const record = await getLatestAuditSnapshot(workspaceId);
  const evidence = extractEvidence(record?.snapshot);
  const receiptItems = receiptTextToManualInputs(evidence.receiptText);
  const audit = analyzeStatements(evidence.statementSources, [...evidence.manualItems, ...receiptItems]);
  return buildAssistantBrief({ recurringItems: audit.recurringItems });
}

// The stored snapshot is the object saved by saveAuditSnapshot; it was validated
// on write, but we still read it defensively — a malformed or partial snapshot
// degrades to "no evidence" rather than throwing on the read path.
function extractEvidence(snapshot: unknown): {
  statementSources: StatementSource[];
  manualItems: ManualRecurringInput[];
  receiptText: string;
} {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return { statementSources: [], manualItems: [], receiptText: "" };
  }
  const value = snapshot as Record<string, unknown>;
  const statementSources = Array.isArray(value.statementSources)
    ? value.statementSources
        .filter((source): source is StatementSource =>
          Boolean(source) && typeof source === "object" &&
          typeof (source as StatementSource).name === "string" &&
          typeof (source as StatementSource).text === "string")
        .map((source) => ({ name: source.name, text: source.text }))
    : [];
  const manualItems = Array.isArray(value.manualItems) ? (value.manualItems as ManualRecurringInput[]) : [];
  const receiptText = typeof value.receiptText === "string" ? value.receiptText : "";
  return { statementSources, manualItems, receiptText };
}
