import type { ControlReconciliationDto } from "@/lib/commitment-control/contracts";
import type { ProposalDecisionAction } from "@/lib/commitment-control/decision";
import type { CategoryPosture, PolicyEvaluationStatus, PolicyReasonCode, ProposalCategory } from "@/lib/commitment-control/policy";
import type { ProposalCadence } from "@/lib/commitment-control/project";
import { decimalToMinorUnits, toMoneyDto } from "@/lib/recovery/domain";

// Presentation and exact-conversion helpers for Commitment Control. Every map is
// keyed by a contract union, so a contract change fails typecheck here instead of
// rendering a missing label. Nothing in this file derives exposure, headroom, a
// policy status, a verdict, or a cap: those are server facts, rendered verbatim.

export type ControlReconciliationVerdict = ControlReconciliationDto["verdict"];

// Runtime option lists are declared locally and checked against the contract
// unions, so the client bundle never pulls the server-side domain modules in.
export const controlCategories = [
  "AI_MODEL",
  "CLOUD_INFRASTRUCTURE",
  "SOFTWARE",
  "CONTRACTOR",
  "CAMPAIGN",
  "OTHER",
] as const satisfies readonly ProposalCategory[];

export const controlCadences = [
  "ONE_TIME",
  "WEEKLY",
  "BIWEEKLY",
  "SEMIMONTHLY",
  "MONTHLY",
  "BIMONTHLY",
  "QUARTERLY",
  "YEARLY",
] as const satisfies readonly ProposalCadence[];

export const controlPostures = ["ALLOW", "REVIEW", "OUTSIDE_POLICY"] as const satisfies readonly CategoryPosture[];

export const controlDecisionActions = ["APPROVE", "APPROVE_WITH_CAP", "DECLINE"] as const satisfies readonly ProposalDecisionAction[];

/** India-first. The workspace currency list a founder can propose in. */
export const controlCurrencies = ["INR", "USD", "EUR", "GBP", "SGD", "AED"] as const;

export const controlCategoryLabels: Record<ProposalCategory, string> = {
  AI_MODEL: "AI model",
  CLOUD_INFRASTRUCTURE: "Cloud infrastructure",
  SOFTWARE: "Software",
  CONTRACTOR: "Contractor",
  CAMPAIGN: "Campaign",
  OTHER: "Other",
};

export const controlCadenceLabels: Record<ProposalCadence, string> = {
  ONE_TIME: "One time",
  WEEKLY: "Weekly",
  BIWEEKLY: "Every two weeks",
  SEMIMONTHLY: "Twice a month",
  MONTHLY: "Monthly",
  BIMONTHLY: "Every two months",
  QUARTERLY: "Quarterly",
  YEARLY: "Yearly",
};

export const controlPostureLabels: Record<CategoryPosture, string> = {
  ALLOW: "Allow",
  REVIEW: "Review",
  OUTSIDE_POLICY: "Outside policy",
};

export const controlStatusLabels: Record<PolicyEvaluationStatus, string> = {
  WITHIN_POLICY: "Within policy",
  REVIEW_REQUIRED: "Review required",
  OUTSIDE_POLICY: "Outside policy",
};

/** Policy describes; it never decides. No label may read as an authorization. */
export const controlStatusMeanings: Record<PolicyEvaluationStatus, string> = {
  WITHIN_POLICY: "Policy found no limit or posture that this proposal crosses. It is not approved.",
  REVIEW_REQUIRED: "Policy marked this proposal for a person to look at before any decision.",
  OUTSIDE_POLICY: "Policy recorded at least one limit or posture that this proposal crosses.",
};

export const controlStatusToneClass: Record<PolicyEvaluationStatus, string> = {
  WITHIN_POLICY: "pill pill-ready",
  REVIEW_REQUIRED: "pill control-pill-review",
  OUTSIDE_POLICY: "pill pill-blocked",
};

export const controlReasonLabels: Record<PolicyReasonCode, string> = {
  CATEGORY_POLICY_MISSING: "This category has no policy rule yet.",
  CATEGORY_REQUIRES_REVIEW: "Policy marks this category for review.",
  CATEGORY_OUTSIDE_POLICY: "Policy places this category outside policy.",
  CURRENCY_POLICY_MISSING: "This currency has no policy limits yet.",
  PER_CHARGE_LIMIT_EXCEEDED: "The per-charge limit is exceeded.",
  THIRTEEN_WEEK_LIMIT_EXCEEDED: "The 13-week exposure limit is exceeded.",
  ANNUAL_LIMIT_EXCEEDED: "The annual exposure limit is exceeded.",
  EXPOSURE_NOT_CITED: "Eligible existing spend was not cited, so this cannot be within policy.",
};

export const controlDecisionActionLabels: Record<ProposalDecisionAction, string> = {
  APPROVE: "Approve",
  APPROVE_WITH_CAP: "Approve with cap",
  DECLINE: "Decline",
};

export const controlDecisionRecordedLabels: Record<ProposalDecisionAction, string> = {
  APPROVE: "Approved",
  APPROVE_WITH_CAP: "Approved with a cap",
  DECLINE: "Declined",
};

export const controlDecisionActionMeanings: Record<ProposalDecisionAction, string> = {
  APPROVE: "Freeze the proposed per-charge amount as the authorized amount.",
  APPROVE_WITH_CAP: "Freeze a lower per-charge cap than the proposed amount.",
  DECLINE: "Record that this obligation is not authorized. No cap is frozen.",
};

export const controlVerdictLabels: Record<ControlReconciliationVerdict, string> = {
  MATCHED: "Matched the frozen amount",
  WITHIN_CAP: "Within the frozen cap",
  OVER_CAP: "Over the frozen cap",
  CURRENCY_MISMATCH: "Different currency — not comparable",
  CANNOT_EVALUATE: "Cannot be evaluated",
};

export const controlVerdictMeanings: Record<ControlReconciliationVerdict, string> = {
  MATCHED: "The observed amount equals the amount that was authorized.",
  WITHIN_CAP: "The observed amount differs from the expected amount and stays at or under the frozen cap.",
  OVER_CAP: "The observed amount is above the frozen cap. The cap itself is unchanged.",
  CURRENCY_MISMATCH: "The observed currency is not the authorized currency, so the two amounts cannot be compared.",
  CANNOT_EVALUATE: "This evidence carries no comparable amount and currency, or the proposal was declined.",
};

export const controlVerdictToneClass: Record<ControlReconciliationVerdict, string> = {
  MATCHED: "pill pill-ready",
  WITHIN_CAP: "pill pill-ready",
  OVER_CAP: "pill pill-blocked",
  CURRENCY_MISMATCH: "pill control-pill-review",
  CANNOT_EVALUATE: "pill pill-planned",
};

/**
 * Render server minor units exactly. When the currency is one this device cannot
 * format, the canonical minor-unit string is shown rather than a guessed amount.
 */
export function formatControlMoney(minor: string | null, currency: string | null): string {
  if (minor === null || currency === null) return "Not published";
  try {
    return toMoneyDto(minor, currency).display;
  } catch {
    return `${minor} minor units ${currency}`;
  }
}

export type ControlAmountParse = { ok: true; minor: string } | { ok: false; message: string };

/** Major-unit text stays exact until this single conversion into minor units. */
export function parseControlAmount(text: string, currency: string, label = "amount"): ControlAmountParse {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, message: `Enter the ${label} for one charge.` };
  let minor: string;
  try {
    minor = decimalToMinorUnits(trimmed, currency);
  } catch {
    return { ok: false, message: `Enter an exact ${currency} ${label} using digits, for example 1999.00.` };
  }
  if (minor === "0") return { ok: false, message: `The ${label} must be more than zero.` };
  return { ok: true, minor };
}

export function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}
