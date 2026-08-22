/**
 * Same-tab first session. Nothing here is a financial fact until Recovery
 * persists cited evidence after sign-in. Decisions are replayed by merchant
 * match only after that evidence exists.
 */
import { guestAuditTransferKey } from "@/lib/guest-audit-transfer";
import type { DecisionCycleAction } from "./contracts";

export const startDecisionStorageKey = "vognary.start-decisions.v1";

export type StartSessionDecision = {
  merchant: string;
  action: DecisionCycleAction;
};

export type StartSessionRecord = {
  version: 1;
  exportedAt: string;
  decisions: readonly StartSessionDecision[];
  reminderRequested: boolean;
  paymentAsk: "unasked" | "yes" | "no";
};

export function buildStartSessionRecord(input: {
  decisions: readonly StartSessionDecision[];
  reminderRequested: boolean;
  paymentAsk?: StartSessionRecord["paymentAsk"];
  exportedAt?: Date;
}): StartSessionRecord {
  return {
    version: 1,
    exportedAt: (input.exportedAt ?? new Date()).toISOString(),
    decisions: input.decisions.map((decision) => ({
      merchant: decision.merchant.trim(),
      action: decision.action,
    })),
    reminderRequested: input.reminderRequested,
    paymentAsk: input.paymentAsk ?? "unasked",
  };
}

export function parseStartSessionRecord(raw: string | null): StartSessionRecord | null {
  if (!raw || raw.length > 32_768) return null;
  try {
    const value = JSON.parse(raw) as Partial<StartSessionRecord>;
    if (value.version !== 1 || !Array.isArray(value.decisions) || typeof value.exportedAt !== "string") return null;
    const actions = new Set<DecisionCycleAction>(["KEEP", "REVIEW_LATER", "PLAN_TO_CANCEL"]);
    const decisions: StartSessionDecision[] = [];
    for (const item of value.decisions) {
      if (!item || typeof item.merchant !== "string" || !actions.has(item.action as DecisionCycleAction)) return null;
      const merchant = item.merchant.trim();
      if (!merchant || merchant.length > 80) return null;
      decisions.push({ merchant, action: item.action as DecisionCycleAction });
    }
    const paymentAsk = value.paymentAsk === "yes" || value.paymentAsk === "no" ? value.paymentAsk : "unasked";
    return {
      version: 1,
      exportedAt: value.exportedAt,
      decisions,
      reminderRequested: value.reminderRequested === true,
      paymentAsk,
    };
  } catch {
    return null;
  }
}

export function writeStartSessionRecord(record: StartSessionRecord): boolean {
  try {
    const serialized = JSON.stringify(record);
    window.sessionStorage.setItem(startDecisionStorageKey, serialized);
    return window.sessionStorage.getItem(startDecisionStorageKey) === serialized;
  } catch {
    return false;
  }
}

export function readStartSessionRecord(): StartSessionRecord | null {
  try {
    return parseStartSessionRecord(window.sessionStorage.getItem(startDecisionStorageKey));
  } catch {
    return null;
  }
}

export function clearStartSessionRecord() {
  try {
    window.sessionStorage.removeItem(startDecisionStorageKey);
  } catch {
    // Session storage may be unavailable; Home still loads from the workspace.
  }
}

export function merchantKey(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

export function matchStartDecision(
  merchant: string,
  decisions: readonly StartSessionDecision[],
): StartSessionDecision | null {
  const key = merchantKey(merchant);
  const exact = decisions.find((decision) => merchantKey(decision.merchant) === key);
  if (exact) return exact;
  return decisions.find((decision) => merchantsLookLikeTheSameTool(key, merchantKey(decision.merchant))) ?? null;
}

export function unmatchedStartDecisions(
  merchants: readonly string[],
  decisions: readonly StartSessionDecision[],
): readonly StartSessionDecision[] {
  return decisions.filter((decision) => !merchants.some((merchant) => matchStartDecision(merchant, [decision])));
}

function merchantsLookLikeTheSameTool(left: string, right: string): boolean {
  if (left.length < 4 || right.length < 4) return false;
  return left.includes(right) || right.includes(left);
}

export { guestAuditTransferKey };
