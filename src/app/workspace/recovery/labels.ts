import type {
  AttentionItemDto,
  AttentionReason,
  Cadence,
  ChangeKind,
  CommitmentImportance,
  CommitmentOwner,
  CommitmentPurpose,
  CommitmentStatus,
  ConfidenceState,
  ConfidenceTruthLayer,
  CorrectionField,
  CorrectionStatus,
  CoverageState,
  Decision,
  DecisionCycleAction,
  DecisionOutcomeKind,
  DecisionReasonKey,
  DecisionReviewSnooze,
  DecisionVerificationOutcome,
  EvidenceProvenanceKind,
  ExpectedVsObservedStatus,
  ProjectionAmountProvenance,
  RecoveryErrorCode,
  SourceType,
} from "@/lib/recovery/contracts";

// Presentation copy only. Every map is keyed by a contract union, so a contract
// change fails the build here instead of silently rendering a missing label.
// Nothing in this file computes, ranks, or reconstructs a financial fact.

export const decisionLabels: Record<Decision, string> = {
  KEEP: "Keep",
  MONITOR: "Review later",
  DOWNGRADE: "Consider a cheaper plan",
  CANCEL: "Plan to cancel",
  INVESTIGATE: "I don’t recognize this",
};

export const decisionMeanings: Record<Decision, string> = {
  KEEP: "No action needed this cycle.",
  MONITOR: "Look at this again before the next bill. Nothing is cancelled.",
  DOWNGRADE: "Keep the service, but consider a cheaper plan.",
  CANCEL: "Record that you plan to cancel it yourself. Vognary does not cancel it.",
  INVESTIGATE: "Flag this because you do not recognize it.",
};

export const decisionStamps: Record<Decision, string> = {
  KEEP: "stamp stamp-keep",
  MONITOR: "stamp stamp-watch",
  DOWNGRADE: "stamp stamp-downgrade",
  CANCEL: "stamp stamp-cancel",
  INVESTIGATE: "stamp stamp-investigate",
};

export const decisionCycleActionLabels: Record<DecisionCycleAction, string> = {
  KEEP: "Keep",
  REVIEW_LATER: "Review later",
  PLAN_TO_CANCEL: "Plan to cancel",
};

export const decisionReviewSnoozeLabels: Record<DecisionReviewSnooze, string> = {
  TOMORROW: "Tomorrow",
  THREE_DAYS_BEFORE: "3 days before the charge",
  ONE_DAY_BEFORE: "1 day before the charge",
};

export const decisionReasonKeyLabels: Record<DecisionReasonKey, string> = {
  RENEWS_SOON: "Renews soon",
  PRICE_INCREASE: "Price increased",
  OVERLAP_NO_PURPOSE: "Possible overlap",
  NEW_COMMITMENT: "New commitment",
  IDENTITY_UNCERTAIN: "Identity uncertain",
  AMOUNT_CONFLICT: "Amount conflict",
  NO_PRIOR_DECISION: "No prior decision",
  PROVISIONAL_SINGLE: "Seen once",
};

export const decisionVerificationOutcomeLabels: Record<DecisionVerificationOutcome, string> = {
  CHARGE_ARRIVED: "Charge arrived",
  NO_CHARGE_IN_WINDOW: "No charge in the window",
  CANNOT_EVALUATE: "Cannot verify yet",
};

export const decisionOutcomeKindLabels: Record<DecisionOutcomeKind, string> = {
  CONTINUED_AS_PLANNED: "Continued as planned",
  CHARGE_AFTER_CANCEL_PLAN: "Charged after you planned to cancel",
  NO_CHARGE_SEEN: "No new charge seen",
  CANNOT_VERIFY: "Cannot verify yet",
  DECISION_DUE_AGAIN: "Decision due again",
  WATCHING: "Watching the next window",
};

export const purposeLabels: Record<CommitmentPurpose, string> = {
  CODING: "Coding",
  RESEARCH: "Research",
  WRITING: "Writing",
  DESIGN: "Design",
  INFRASTRUCTURE: "Infrastructure",
  CRM: "CRM",
  MARKETING: "Marketing",
  COMMUNICATION: "Communication",
  ANALYTICS: "Analytics",
  OPERATIONS: "Operations",
  OTHER: "Other",
};

export const importanceLabels: Record<CommitmentImportance, string> = {
  PRODUCTION_BREAKS: "Production breaks",
  TEAM_WORKFLOW_BREAKS: "Team workflow breaks",
  CUSTOMER_FACING_BREAKS: "Customer-facing workflow breaks",
  PRODUCTIVITY_DECREASES: "Productivity decreases",
  NOTHING_IMPORTANT: "Nothing important",
  NOT_SURE: "Not sure",
};

export const ownerLabels: Record<CommitmentOwner, string> = {
  FOUNDER: "Founder",
  ENGINEERING: "Engineering",
  SALES: "Sales",
  MARKETING: "Marketing",
  OPERATIONS: "Operations",
  OTHER: "Other",
};

export const cadenceLabels: Record<Cadence, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Every two weeks",
  SEMIMONTHLY: "Twice a month",
  MONTHLY: "Monthly",
  BIMONTHLY: "Every two months",
  QUARTERLY: "Quarterly",
  YEARLY: "Yearly",
  IRREGULAR: "Irregular",
};

export const sourceLabels: Record<SourceType, string> = {
  RECEIPT_PASTE: "Pasted bill",
  CSV_IMPORT: "Uploaded file",
  FORWARDED_EMAIL: "Forwarded email",
  GMAIL_OAUTH: "Gmail (not yet proven)",
};

export const commitmentStatusLabels: Record<CommitmentStatus, string> = {
  ACTIVE: "Recurring",
  NOT_RECURRING: "Not recurring",
};

export const confidenceLabels: Record<ConfidenceState, string> = {
  HIGH: "Confirmed",
  MEDIUM: "Likely",
  LOW: "Needs review",
  UNKNOWN: "Unknown",
};

export const confidenceUncertainty: Record<ConfidenceState, string> = {
  HIGH: "This matches the bills you added.",
  MEDIUM: "Treat the amount and date as an estimate until another bill arrives.",
  LOW: "Not enough history yet. Check this against your own record.",
  UNKNOWN: "Not enough information yet.",
};

export const confidenceTruthLayerLabels: Record<ConfidenceTruthLayer, string> = {
  CONFIRMED: "Confirmed",
  LIKELY: "Likely",
  NEEDS_REVIEW: "Needs review",
  UNKNOWN: "Unknown",
};

export const expectedVsObservedLabels: Record<ExpectedVsObservedStatus, string> = {
  MATCHED: "On track",
  AMOUNT_CHANGED: "Amount changed",
  ARRIVED_LATE: "Arrived later than expected",
  NOT_YET_OBSERVED: "We haven't seen it yet",
  CANNOT_EVALUATE: "We can't check this yet",
  INSUFFICIENT_HISTORY: "Not enough history",
};

export const correctionFieldLabels: Record<CorrectionField, string> = {
  MERCHANT: "Merchant",
  AMOUNT: "Amount",
  NEXT_EXPECTED_DATE: "Expected date",
  CADENCE: "How often",
  IS_RECURRING: "Recurring or not",
};

export const correctionStatusLabels: Record<CorrectionStatus, string> = {
  ACTIVE: "Applied",
  REVERSED: "Reversed",
  SUPERSEDED: "Superseded",
};

export const changeKindLabels: Record<ChangeKind, string> = {
  ADDED: "New commitment",
  MERCHANT: "Merchant changed",
  AMOUNT: "Amount changed",
  DATE: "Date changed",
  CADENCE: "How often changed",
  RECURRING_CLASSIFICATION: "Recurring classification changed",
};

export const attentionReasonLabels: Record<AttentionReason, string> = {
  DECISION_REQUIRED: "Needs attention",
  RENEWS_SOON: "Coming up",
  LOW_CONFIDENCE: "Not enough information",
  PRICE_INCREASE: "Price changed",
  EVIDENCE_CONFLICT: "Needs attention",
};

export const priorityLabels: Record<AttentionItemDto["priority"], string> = {
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

export const coverageLabels: Record<CoverageState, string> = {
  NO_EVIDENCE: "No evidence yet",
  BASELINE_ONLY: "Baseline only",
  PARTIAL: "Partial",
  CURRENT: "Current",
  STALE: "Stale",
};

export const coverageMeanings: Record<CoverageState, string> = {
  NO_EVIDENCE: "Nothing has been submitted, so nothing can be shown.",
  BASELINE_ONLY: "This is a first baseline. There is nothing earlier to compare it against.",
  PARTIAL: "Only part of your recurring money is covered by the evidence you submitted.",
  CURRENT: "Covered up to the most recent evidence you submitted. Never wider than that.",
  STALE: "No recent evidence. What you see may already be out of date.",
};

export const provenanceLabels: Record<EvidenceProvenanceKind, string> = {
  USER_SUBMITTED: "You added this",
  PROVIDER_RECEIVED: "Arrived at your Vognary address",
};

export const projectionAmountProvenanceLabels: Record<ProjectionAmountProvenance, string> = {
  RECEIPT: "From checked receipts only.",
  USER_CORRECTED: "Includes a saved correction.",
};

export const errorCopy: Record<RecoveryErrorCode, { title: string; detail: string }> = {
  AUTH_REQUIRED: { title: "Sign in required", detail: "This workspace is not open on this device. Sign in to continue." },
  FORBIDDEN: { title: "Not permitted", detail: "This account is not allowed to open this workspace." },
  NOT_FOUND: { title: "Not found", detail: "That item is no longer in this workspace." },
  INVALID_EVIDENCE: { title: "This invoice couldn't be read.", detail: "Nothing was saved. Try another file or paste the receipt text." },
  PARSE_FAILED: { title: "We couldn't read this invoice.", detail: "Try another file or paste the receipt text." },
  DUPLICATE_EVIDENCE: { title: "Already added", detail: "This exact bill is already in your workspace. It was not added twice." },
  DATABASE_UNAVAILABLE: { title: "Saved workspace unavailable", detail: "Your saved workspace could not be reached. Nothing was changed." },
  CONFLICT: { title: "Conflicting change", detail: "Another change landed first. Reload before retrying." },
  STALE_STATE: { title: "This page is behind", detail: "The workspace moved on while this page was open. Reload to continue." },
  SAVE_FAILED: { title: "Not saved", detail: "The change did not save. Nothing was changed." },
  REQUEST_TOO_LARGE: { title: "Too much at once", detail: "This submission is larger than the accepted limit. Send less at a time." },
  UNSUPPORTED_MEDIA_TYPE: { title: "This file type isn't supported.", detail: "Use a PDF, CSV, TXT, spreadsheet, or a photo of the bill and confirm the line." },
  FEATURE_UNAVAILABLE: { title: "Not available yet", detail: "This feature is not active for this deployment." },
  RATE_LIMITED: { title: "Too many requests", detail: "Too many requests were sent. Wait before retrying." },
  UNKNOWN: { title: "Unexplained failure", detail: "The workspace returned a failure it did not explain. Nothing is assumed about your money." },
};

const dayFormat = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });
const momentFormat = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

// Server dates arrive either as a plain calendar day or a full instant. Calendar
// days are rendered without a timezone shift; instants use the reader's device
// timezone. Unparseable input is echoed verbatim rather than guessed at.
export function formatDay(value: string): string {
  const calendarDay = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (calendarDay) {
    const [, year, month, day] = calendarDay;
    return dayFormat.format(new Date(Number(year), Number(month) - 1, Number(day)));
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : dayFormat.format(parsed);
}

export function formatMoment(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : momentFormat.format(parsed);
}

/** UTC midnight of a stored charge date is a calendar day, not a clock time. */
export function formatObservedInstant(observedAt: string, chargeDate: string | null): string | null {
  if (chargeDate && /^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.000)?Z$/.test(observedAt) && observedAt.startsWith(`${chargeDate}T`)) {
    return null;
  }
  return `Recorded ${formatMoment(observedAt)}`;
}
