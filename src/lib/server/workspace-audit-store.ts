import "server-only";

import {
  analyzeStatements,
  type AuditResult,
  type ManualRecurringInput,
  type StatementSource,
} from "@/lib/recurring-audit";
import { receiptTextToManualInputs } from "@/lib/receipt-parser";
import { getLatestAuditSnapshot } from "@/lib/server/audit-snapshot-store";

// The one place server surfaces get a workspace's audit: read the persisted
// evidence snapshot and re-run the SAME deterministic engine
// (analyzeStatements) that materializeWorkspaceState used to write the DB rows.
// Deriving every downstream view (the brief, the mandate kill-list, and — once
// keyed — AI narration) from this single audit guarantees they can never
// disagree with each other or drift from what is stored. An absent or malformed
// snapshot degrades to an empty audit, never a throw on the read path.
export async function getWorkspaceAudit(workspaceId: string): Promise<AuditResult> {
  const record = await getLatestAuditSnapshot(workspaceId);
  const evidence = extractEvidence(record?.snapshot);
  const receiptItems = receiptTextToManualInputs(evidence.receiptText);
  return analyzeStatements(evidence.statementSources, [...evidence.manualItems, ...receiptItems]);
}

// The stored snapshot was validated on write, but we still read it defensively:
// a partial or malformed snapshot resolves to "no evidence" rather than throwing.
// Exported so its parsing can be unit-tested against synthetic fixtures.
export function extractEvidence(snapshot: unknown): {
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
