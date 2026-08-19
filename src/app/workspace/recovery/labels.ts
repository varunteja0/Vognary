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
  MONITOR: "Review",
  DOWNGRADE: "Consider a cheaper plan",
  CANCEL: "Plan to cancel",
  INVESTIGATE: "I don’t recognize this",
};

export const decisionMeanings: Record<Decision, string> = {
  KEEP: "Keep tracking it and ask again only when something changes.",
  MONITOR: "Mark this for review. Nothing is cancelled.",
  DOWNGRADE: "Keep the service but consider moving to a cheaper plan.",
  CANCEL: "Record that you plan to cancel it at the service itself.",
  INVESTIGATE: "Mark this for review because you do not recognize it.",
};

export const decisionStamps: Record<Decision, string> = {
  KEEP: "stamp stamp-keep",
  MONITOR: "stamp stamp-watch",
  DOWNGRADE: "stamp stamp-downgrade",
  CANCEL: "stamp stamp-cancel",
  INVESTIGATE: "stamp stamp-investigate",
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
  RECEIPT_PASTE: "Pasted receipt",
  CSV_IMPORT: "Imported statement file",
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
  HIGH: "Still only as complete as the evidence you gave.",
  MEDIUM: "Treat the amount and date as provisional until more evidence lands.",
  LOW: "Check this against your own record before acting on it.",
  UNKNOWN: "No confidence was established for this. Do not treat it as settled.",
};

export const confidenceTruthLayerLabels: Record<ConfidenceTruthLayer, string> = {
  CONFIRMED: "Confirmed",
  LIKELY: "Likely",
  NEEDS_REVIEW: "Needs review",
  UNKNOWN: "Unknown",
};

export const expectedVsObservedLabels: Record<ExpectedVsObservedStatus, string> = {
  MATCHED: "Matched",
  AMOUNT_CHANGED: "Amount changed",
  ARRIVED_LATE: "Arrived later than expected",
  NOT_YET_OBSERVED: "Not yet observed",
  CANNOT_EVALUATE: "Cannot evaluate",
  INSUFFICIENT_HISTORY: "Not enough history",
};

export const correctionFieldLabels: Record<CorrectionField, string> = {
  MERCHANT: "Merchant",
  AMOUNT: "Amount",
  NEXT_EXPECTED_DATE: "Expected date",
  CADENCE: "Cadence",
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
  CADENCE: "Cadence changed",
  RECURRING_CLASSIFICATION: "Recurring classification changed",
};

export const attentionReasonLabels: Record<AttentionReason, string> = {
  DECISION_REQUIRED: "Decision required",
  RENEWS_SOON: "Renews soon",
  LOW_CONFIDENCE: "Low confidence",
  PRICE_INCREASE: "Price increase",
  EVIDENCE_CONFLICT: "Evidence conflict",
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
  USER_SUBMITTED: "You submitted this evidence",
  PROVIDER_RECEIVED: "Received through your Vognary receipt address",
};

export const projectionAmountProvenanceLabels: Record<ProjectionAmountProvenance, string> = {
  RECEIPT: "From checked receipts only.",
  USER_CORRECTED: "Includes a saved correction.",
};

export const errorCopy: Record<RecoveryErrorCode, { title: string; detail: string }> = {
  AUTH_REQUIRED: { title: "Sign in required", detail: "This workspace is not open on this device. Sign in to continue." },
  FORBIDDEN: { title: "Not permitted", detail: "This account is not allowed to open this workspace." },
  NOT_FOUND: { title: "Not found", detail: "That item is no longer in this workspace." },
  INVALID_EVIDENCE: { title: "Evidence not accepted", detail: "This text was not accepted as evidence. Nothing was saved." },
  PARSE_FAILED: { title: "Nothing could be read", detail: "No merchant, amount, and date could be read from this evidence." },
  DUPLICATE_EVIDENCE: { title: "Already submitted", detail: "This exact evidence is already in your workspace. It was not added twice." },
  DATABASE_UNAVAILABLE: { title: "Saved workspace unavailable", detail: "Your saved workspace could not be reached. Nothing was changed." },
  CONFLICT: { title: "Conflicting change", detail: "Another change landed first. Reload before retrying." },
  STALE_STATE: { title: "This page is behind", detail: "The workspace moved on while this page was open. Reload to continue." },
  SAVE_FAILED: { title: "Not saved", detail: "The change did not save. Nothing was changed." },
  REQUEST_TOO_LARGE: { title: "Too much at once", detail: "This submission is larger than the accepted limit. Send less at a time." },
  UNSUPPORTED_MEDIA_TYPE: { title: "Format not accepted", detail: "This format is not accepted as evidence." },
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
