import type {
  CommitmentControlBriefDto,
  ControlDecisionDto,
  ControlEvaluationDto,
  ControlExceptionDisposition,
  ControlExceptionReviewDto,
  ControlExceptionTargetKind,
  ControlOutcomeObservationDto,
  ControlPolicyDto,
  ControlProposalDto,
  ControlReconciliationDto,
  CreateControlProposalRequest,
  DecideControlProposalRequest,
  PutControlPolicyRequest,
  ReconcileControlProposalRequest,
  RecordControlExceptionReviewRequest,
  RecordControlOutcomeObservationRequest,
} from "@/lib/commitment-control/contracts";
import type { ProposalDecisionAction } from "@/lib/commitment-control/decision";
import { normalizeControlOutcomeValue, type ControlOutcomeDirection } from "@/lib/commitment-control/outcome";
import { indiaCalendarDate } from "@/lib/date-only";
import type { CategoryPosture, ProposalCategory } from "@/lib/commitment-control/policy";
import type { ProposalCadence } from "@/lib/commitment-control/project";
import type { AttentionProjectionStatus } from "@/lib/recovery/contracts";
import type { RecoveryFailure } from "../state";
import type { ResponseMeta, TransportFailure } from "../transport";
import { formatControlMoney, isCalendarDate, parseControlAmount } from "./control-format";

// Pure state for the Commitment Control desk. The server owns policy status,
// headroom, exposure, verdicts, frozen amounts, and caps; this file owns only
// drafts, dialogs, focus, request status, and the idempotency keys that make a
// retry safe. It never recomputes a financial fact.

export type ControlStatus =
  | { kind: "IDLE" }
  | { kind: "LOADING" }
  | { kind: "READY" }
  | { kind: "UNAVAILABLE" }
  | { kind: "FAILED"; failure: RecoveryFailure };

export type ControlProposalDraft = {
  merchant: string;
  purpose: string;
  category: ProposalCategory;
  amountText: string;
  currency: string;
  firstChargeDate: string;
  cadence: ProposalCadence;
  existingCommitmentIds: readonly string[];
  outcomeMetric: string;
  outcomeDirection: ControlOutcomeDirection;
  outcomeTargetText: string;
  outcomeUnit: string;
  outcomeReviewOn: string;
};

export type ControlProposalField =
  | "merchant"
  | "purpose"
  | "amountText"
  | "firstChargeDate"
  | "outcomeMetric"
  | "outcomeTargetText"
  | "outcomeUnit"
  | "outcomeReviewOn";
export type ControlDraftErrors = Partial<Record<ControlProposalField, string>>;

export type ControlDecisionDraft = {
  action: ProposalDecisionAction | null;
  capText: string;
  authorizationExpiresOn: string;
  overrideReason: string;
  error: string | null;
};

export type ControlReconciliationDraft = {
  commitmentId: string | null;
  evidenceId: string | null;
  outcomeValueText: string;
  outcomeObservedOn: string;
  error: string | null;
};

export type ControlOutcomeObservationDraft = {
  valueText: string;
  observedOn: string;
};

export type ControlExceptionReviewDraft = {
  disposition: ControlExceptionDisposition | null;
  note: string;
};

export type ControlPolicyDraftLimit = {
  currency: string;
  maxPerChargeText: string;
  maxThirteenWeekText: string;
  maxAnnualText: string;
};

export type ControlPolicyDraft = {
  categoryRules: readonly { category: ProposalCategory; posture: CategoryPosture }[];
  currencyLimits: readonly ControlPolicyDraftLimit[];
  step: "EDIT" | "REVIEW";
  error: string | null;
};

export type ControlDialog =
  | { kind: "DECISION"; proposalId: string }
  | { kind: "RECONCILIATION"; proposalId: string }
  | { kind: "OUTCOME"; proposalId: string }
  | { kind: "EXCEPTION_REVIEW"; proposalId: string; targetKind: ControlExceptionTargetKind; targetId: string }
  | { kind: "POLICY" };

export type ControlPending =
  | { kind: "PROPOSAL"; idempotencyKey: string }
  | { kind: "DECISION"; idempotencyKey: string; proposalId: string; action: ProposalDecisionAction }
  | { kind: "RECONCILIATION"; idempotencyKey: string; proposalId: string }
  | { kind: "OUTCOME"; idempotencyKey: string; proposalId: string }
  | { kind: "EXCEPTION_REVIEW"; idempotencyKey: string; proposalId: string }
  | { kind: "POLICY"; idempotencyKey: string };

export type ControlIdempotencySlot = ControlPending["kind"];
export type ControlIdempotencyStore = Partial<Record<ControlIdempotencySlot, { signature: string; key: string }>>;

export type ControlState = {
  status: ControlStatus;
  brief: CommitmentControlBriefDto | null;
  workspaceVersion: number | null;
  requestId: string | null;
  draft: ControlProposalDraft;
  draftErrors: ControlDraftErrors;
  decisionDraft: ControlDecisionDraft;
  reconciliationDraft: ControlReconciliationDraft;
  policyDraft: ControlPolicyDraft | null;
  dialog: ControlDialog | null;
  returnFocusId: string | null;
  pending: ControlPending | null;
  failure: RecoveryFailure | null;
  staleNotice: string | null;
  attentionProjection: AttentionProjectionStatus | null;
  focusProposalId: string | null;
  idempotency: ControlIdempotencyStore;
  announcement: string;
};

const emptyControlProposalDraft: ControlProposalDraft = {
  merchant: "",
  purpose: "",
  category: "AI_MODEL",
  amountText: "",
  currency: "INR",
  firstChargeDate: "",
  cadence: "MONTHLY",
  existingCommitmentIds: [],
  outcomeMetric: "",
  outcomeDirection: "AT_LEAST",
  outcomeTargetText: "",
  outcomeUnit: "",
  outcomeReviewOn: "",
};

export const initialControlState: ControlState = {
  status: { kind: "IDLE" },
  brief: null,
  workspaceVersion: null,
  requestId: null,
  draft: emptyControlProposalDraft,
  draftErrors: {},
  decisionDraft: { action: null, capText: "", authorizationExpiresOn: "", overrideReason: "", error: null },
  reconciliationDraft: { commitmentId: null, evidenceId: null, outcomeValueText: "", outcomeObservedOn: "", error: null },
  policyDraft: null,
  dialog: null,
  returnFocusId: null,
  pending: null,
  failure: null,
  staleNotice: null,
  attentionProjection: null,
  focusProposalId: null,
  idempotency: {},
  announcement: "",
};

export type ControlAction =
  | { type: "BRIEF_REQUESTED" }
  | { type: "BRIEF_LOADED"; brief: CommitmentControlBriefDto; meta: ResponseMeta }
  | { type: "BRIEF_FAILED"; failure: TransportFailure }
  | { type: "DRAFT_CHANGED"; draft: Partial<ControlProposalDraft> }
  | { type: "EXISTING_COMMITMENT_TOGGLED"; commitmentId: string }
  | { type: "PROPOSAL_REJECTED"; errors: ControlDraftErrors }
  | { type: "PROPOSAL_STARTED"; idempotencyKey: string; signature: string }
  | { type: "PROPOSAL_SAVED"; proposal: ControlProposalDto; evaluation: ControlEvaluationDto; submitted: CreateControlProposalRequest; meta: ResponseMeta }
  | { type: "PROPOSAL_FAILED"; failure: TransportFailure }
  | { type: "DIALOG_OPENED"; dialog: ControlDialog; returnFocusId: string | null; policyDraft?: ControlPolicyDraft }
  | { type: "DIALOG_CLOSED" }
  | { type: "DECISION_DRAFT_CHANGED"; draft: Partial<ControlDecisionDraft> }
  | { type: "DECISION_STARTED"; proposalId: string; action: ProposalDecisionAction; idempotencyKey: string; signature: string }
  | { type: "DECISION_SAVED"; decision: ControlDecisionDto; meta: ResponseMeta }
  | { type: "DECISION_FAILED"; failure: TransportFailure }
  | { type: "RECONCILIATION_DRAFT_CHANGED"; draft: Partial<ControlReconciliationDraft> }
  | { type: "RECONCILIATION_STARTED"; proposalId: string; idempotencyKey: string; signature: string }
  | { type: "RECONCILIATION_SAVED"; reconciliation: ControlReconciliationDto; meta: ResponseMeta }
  | { type: "RECONCILIATION_FAILED"; failure: TransportFailure }
  | { type: "OUTCOME_STARTED"; proposalId: string; idempotencyKey: string; signature: string }
  | { type: "OUTCOME_SAVED"; observation: ControlOutcomeObservationDto; meta: ResponseMeta }
  | { type: "OUTCOME_FAILED"; failure: TransportFailure }
  | { type: "EXCEPTION_REVIEW_STARTED"; proposalId: string; idempotencyKey: string; signature: string }
  | { type: "EXCEPTION_REVIEW_SAVED"; review: ControlExceptionReviewDto; meta: ResponseMeta }
  | { type: "EXCEPTION_REVIEW_FAILED"; failure: TransportFailure }
  | { type: "POLICY_DRAFT_CHANGED"; draft: Partial<ControlPolicyDraft> }
  | { type: "POLICY_STARTED"; idempotencyKey: string; signature: string }
  | { type: "POLICY_SAVED"; policy: ControlPolicyDto; meta: ResponseMeta }
  | { type: "POLICY_FAILED"; failure: TransportFailure }
  | { type: "FOCUS_SET"; proposalId: string }
  | { type: "FOCUS_CLEARED" };

const asFailure = (failure: TransportFailure): RecoveryFailure => ({ error: failure.error, origin: failure.origin });
const isStale = (failure: TransportFailure) => failure.error.code === "STALE_STATE";
const isConflict = (failure: TransportFailure) => failure.error.code === "CONFLICT";

const staleCopy = "The saved workspace changed after this page loaded. Your entry is kept exactly as you typed it. Review the reloaded workspace, then send it again.";

/**
 * A retry of an unchanged body reuses the same key so the server can recognise
 * the replay. A changed body gets a new key, because a reused key with a
 * different payload is a conflict by contract.
 */
export function resolveIdempotencyKey(
  store: ControlIdempotencyStore,
  slot: ControlIdempotencySlot,
  signature: string,
  newKey: () => string,
): string {
  const held = store[slot];
  return held && held.signature === signature ? held.key : newKey();
}

export function controlProposalRequest(draft: ControlProposalDraft): { ok: true; request: CreateControlProposalRequest } | { ok: false; errors: ControlDraftErrors } {
  const errors: ControlDraftErrors = {};
  const merchant = draft.merchant.trim();
  const purpose = draft.purpose.trim();
  if (!merchant) errors.merchant = "Name the merchant or counterparty.";
  else if (merchant.length > 240) errors.merchant = "Use 240 characters or fewer.";
  if (!purpose) errors.purpose = "Say what this obligation is for.";
  else if (purpose.length > 500) errors.purpose = "Use 500 characters or fewer.";
  const amount = parseControlAmount(draft.amountText, draft.currency);
  if (!amount.ok) errors.amountText = amount.message;
  if (!isCalendarDate(draft.firstChargeDate)) errors.firstChargeDate = "Choose the date of the first charge.";
  const outcomeMetric = draft.outcomeMetric.trim();
  const outcomeUnit = draft.outcomeUnit.trim();
  if (!outcomeMetric) errors.outcomeMetric = "Name the measurable outcome.";
  else if (outcomeMetric.length > 120) errors.outcomeMetric = "Use 120 characters or fewer.";
  if (!outcomeUnit) errors.outcomeUnit = "Name the outcome unit.";
  else if (outcomeUnit.length > 40) errors.outcomeUnit = "Use 40 characters or fewer.";
  let outcomeTargetValue = "";
  try {
    outcomeTargetValue = normalizeControlOutcomeValue(draft.outcomeTargetText, "Outcome target value");
  } catch {
    errors.outcomeTargetText = "Use a non-negative number with up to six decimal places.";
  }
  if (!isCalendarDate(draft.outcomeReviewOn)) errors.outcomeReviewOn = "Choose when this outcome will be reviewed.";
  else if (isCalendarDate(draft.firstChargeDate) && draft.outcomeReviewOn < draft.firstChargeDate) {
    errors.outcomeReviewOn = "Review the outcome on or after the first charge date.";
  }
  if (Object.keys(errors).length || !amount.ok) return { ok: false, errors };
  return {
    ok: true,
    request: {
      merchant,
      purpose,
      category: draft.category,
      amountMinor: amount.minor,
      currency: draft.currency,
      firstChargeDate: draft.firstChargeDate,
      cadence: draft.cadence,
      existingCommitmentIds: [...draft.existingCommitmentIds],
      intendedOutcome: {
        metric: outcomeMetric,
        targetDirection: draft.outcomeDirection,
        targetValue: outcomeTargetValue,
        unit: outcomeUnit,
        reviewOn: draft.outcomeReviewOn,
      },
    },
  };
}

/**
 * Builds the decision body, or the reason it cannot be sent. The cap is exact
 * minor units and can never exceed the amount the proposal froze.
 */
export function controlDecisionRequest(
  draft: ControlDecisionDraft,
  proposal: ControlProposalDto,
  evaluation: ControlEvaluationDto | null,
  authorizationAsOf = indiaCalendarDate(),
): { ok: true; request: DecideControlProposalRequest } | { ok: false; message: string } {
  if (!draft.action) return { ok: false, message: "Choose Approve, Approve with cap, or Decline." };
  const override = draft.overrideReason.trim();
  if (evaluation?.status === "OUTSIDE_POLICY" && (draft.action === "APPROVE" || draft.action === "APPROVE_WITH_CAP") && !override) {
    return { ok: false, message: "Write why you are authorizing an outside-policy proposal." };
  }
  const overrideField = override && evaluation?.status === "OUTSIDE_POLICY" && draft.action !== "DECLINE"
    ? { overrideReason: override }
    : {};
  if (draft.action !== "DECLINE") {
    if (proposal.intendedOutcome && proposal.intendedOutcome.reviewOn < authorizationAsOf) {
      return { ok: false, message: "The outcome review date has passed. Decline this proposal or submit a new one." };
    }
    if (!isCalendarDate(draft.authorizationExpiresOn)) {
      return { ok: false, message: "Choose when this authorization expires." };
    }
    if (draft.authorizationExpiresOn < authorizationAsOf) {
      return { ok: false, message: "Authorization expiry cannot be before today." };
    }
    if (proposal.intendedOutcome && draft.authorizationExpiresOn > proposal.intendedOutcome.reviewOn) {
      return { ok: false, message: "Authorization expiry cannot be after the outcome review date." };
    }
  }
  const expiryField = draft.action === "DECLINE" ? {} : { authorizationExpiresOn: draft.authorizationExpiresOn };
  if (draft.action === "APPROVE") return { ok: true, request: { action: "APPROVE", ...expiryField, ...overrideField } };
  if (draft.action === "DECLINE") return { ok: true, request: { action: "DECLINE" } };
  const cap = parseControlAmount(draft.capText, proposal.currency, "cap");
  if (!cap.ok) return { ok: false, message: cap.message };
  if (BigInt(cap.minor) > BigInt(proposal.amountMinor)) {
    return { ok: false, message: `The cap cannot be above the proposed ${formatControlMoney(proposal.amountMinor, proposal.currency)} per charge.` };
  }
  return { ok: true, request: { action: "APPROVE_WITH_CAP", approvedCapMinor: cap.minor, ...expiryField, ...overrideField } };
}

export function controlReconciliationRequest(
  draft: ControlReconciliationDraft,
  proposal: ControlProposalDto,
  observedThrough = indiaCalendarDate(),
): { ok: true; request: ReconcileControlProposalRequest } | { ok: false; message: string } {
  if (!draft.evidenceId) return { ok: false, message: "Choose a receipt before reconciling." };
  const value = draft.outcomeValueText.trim();
  const observedOn = draft.outcomeObservedOn;
  if (!value && !observedOn) return { ok: true, request: { evidenceId: draft.evidenceId } };
  if (!value || !observedOn) return { ok: false, message: "Record both the observed outcome value and its date, or leave both blank." };
  if (!isCalendarDate(observedOn)) return { ok: false, message: "Choose a real observed outcome date." };
  if (observedOn > observedThrough) return { ok: false, message: "Observed outcome date cannot be in the future." };
  if (proposal.intendedOutcome && observedOn < proposal.intendedOutcome.reviewOn) {
    return { ok: false, message: "Observed outcome date cannot be before the intended review date." };
  }
  try {
    return {
      ok: true,
      request: {
        evidenceId: draft.evidenceId,
        observedOutcome: {
          value: normalizeControlOutcomeValue(value, "Observed outcome value"),
          observedOn,
        },
      },
    };
  } catch {
    return { ok: false, message: "Observed outcome must be a non-negative number with up to six decimal places." };
  }
}

export function controlOutcomeObservationRequest(
  draft: ControlOutcomeObservationDraft,
  proposal: ControlProposalDto,
  observedThrough = indiaCalendarDate(),
): { ok: true; request: RecordControlOutcomeObservationRequest } | { ok: false; message: string } {
  if (!proposal.intendedOutcome) return { ok: false, message: "This proposal has no frozen outcome target." };
  if (!isCalendarDate(draft.observedOn)) return { ok: false, message: "Choose a real observed outcome date." };
  if (draft.observedOn > observedThrough) return { ok: false, message: "Observed outcome date cannot be in the future." };
  if (draft.observedOn < proposal.intendedOutcome.reviewOn) {
    return { ok: false, message: "Observed outcome date cannot be before the intended review date." };
  }
  try {
    return {
      ok: true,
      request: {
        observedOutcome: {
          value: normalizeControlOutcomeValue(draft.valueText, "Observed outcome value"),
          observedOn: draft.observedOn,
        },
      },
    };
  } catch {
    return { ok: false, message: "Observed outcome must be a non-negative number with up to six decimal places." };
  }
}

export function controlExceptionReviewRequest(
  draft: ControlExceptionReviewDraft,
  target: { targetKind: ControlExceptionTargetKind; targetId: string },
): { ok: true; request: RecordControlExceptionReviewRequest } | { ok: false; message: string } {
  if (!draft.disposition) return { ok: false, message: "Choose what should happen after this exception." };
  const note = draft.note.trim();
  if (!note) return { ok: false, message: "Record why this disposition was chosen." };
  if (note.length > 500) return { ok: false, message: "Use 500 characters or fewer for the review note." };
  return { ok: true, request: { ...target, disposition: draft.disposition, note } };
}

export function controlPolicyRequest(draft: ControlPolicyDraft): { ok: true; request: PutControlPolicyRequest } | { ok: false; message: string } {
  const currencyLimits: PutControlPolicyRequest["currencyLimits"][number][] = [];
  for (const limit of draft.currencyLimits) {
    const currency = limit.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, message: "Every currency must be a three-letter code." };
    const perCharge = parseControlAmount(limit.maxPerChargeText, currency, "per-charge limit");
    if (!perCharge.ok) return { ok: false, message: `${currency}: ${perCharge.message}` };
    const thirteenWeek = parseControlAmount(limit.maxThirteenWeekText, currency, "13-week limit");
    if (!thirteenWeek.ok) return { ok: false, message: `${currency}: ${thirteenWeek.message}` };
    const annual = parseControlAmount(limit.maxAnnualText, currency, "annual limit");
    if (!annual.ok) return { ok: false, message: `${currency}: ${annual.message}` };
    if (currencyLimits.some((entry) => entry.currency === currency)) {
      return { ok: false, message: `${currency} is listed twice. Each currency may carry one set of limits.` };
    }
    currencyLimits.push({
      currency,
      maxPerChargeMinor: perCharge.minor,
      maxThirteenWeekMinor: thirteenWeek.minor,
      maxAnnualMinor: annual.minor,
    });
  }
  if (!currencyLimits.length) return { ok: false, message: "Record at least one currency with three positive caps. INR is the default." };
  const categories = new Set(draft.categoryRules.map((rule) => rule.category));
  if (categories.size !== 6) return { ok: false, message: "Set a posture for every category before recording policy." };
  return {
    ok: true,
    request: { categoryRules: draft.categoryRules.map((rule) => ({ ...rule })), currencyLimits },
  };
}

export function policyDraftFrom(policy: ControlPolicyDto | null, toMajor: (minor: string, currency: string) => string): ControlPolicyDraft {
  // A first-run workspace cannot record a proposal until a policy exists, so an
  // empty form is a wall in front of the product. These are visible starting
  // points an owner reviews and edits before saving — never a saved policy, and
  // never a claim about this company's real limits.
  const starterLimit = {
    currency: "INR",
    maxPerChargeText: "100000",
    maxThirteenWeekText: "1000000",
    maxAnnualText: "4000000",
  };
  return {
    categoryRules: policy
      ? [
        ...policy.categoryRules.map((rule) => ({ ...rule })),
      ]
      : [
        { category: "AI_MODEL", posture: "REVIEW" },
        { category: "CLOUD_INFRASTRUCTURE", posture: "REVIEW" },
        { category: "SOFTWARE", posture: "REVIEW" },
        { category: "CONTRACTOR", posture: "REVIEW" },
        { category: "CAMPAIGN", posture: "REVIEW" },
        { category: "OTHER", posture: "REVIEW" },
      ],
    currencyLimits: policy?.currencyLimits.length
      ? policy.currencyLimits.map((limit) => ({
        currency: limit.currency,
        maxPerChargeText: toMajor(limit.maxPerChargeMinor, limit.currency),
        maxThirteenWeekText: toMajor(limit.maxThirteenWeekMinor, limit.currency),
        maxAnnualText: toMajor(limit.maxAnnualMinor, limit.currency),
      }))
      : [starterLimit],
    step: "EDIT",
    error: null,
  };
}

function withoutSlot(store: ControlIdempotencyStore, slot: ControlIdempotencySlot): ControlIdempotencyStore {
  if (!store[slot]) return store;
  const next = { ...store };
  delete next[slot];
  return next;
}

function heldSlot(store: ControlIdempotencyStore, slot: ControlIdempotencySlot, signature: string, key: string): ControlIdempotencyStore {
  return { ...store, [slot]: { signature, key } };
}

/** A failed mutation keeps a retryable key and drops one the server refused. */
function settleAfterFailure(state: ControlState, slot: ControlIdempotencySlot, failure: TransportFailure): ControlIdempotencyStore {
  return isStale(failure) || isConflict(failure) ? withoutSlot(state.idempotency, slot) : state.idempotency;
}

export function controlReducer(state: ControlState, action: ControlAction): ControlState {
  switch (action.type) {
    case "BRIEF_REQUESTED":
      return { ...state, status: state.brief ? state.status : { kind: "LOADING" } };

    case "BRIEF_LOADED":
      return {
        ...state,
        status: { kind: "READY" },
        brief: action.brief,
        workspaceVersion: action.meta.workspaceVersion,
        requestId: action.meta.requestId,
        failure: null,
        announcement: state.staleNotice ? "The workspace was reloaded. Review your entry before sending it again." : state.announcement,
      };

    case "BRIEF_FAILED":
      if (action.failure.origin === "SERVER" && action.failure.error.code === "FEATURE_UNAVAILABLE") {
        return { ...initialControlState, status: { kind: "UNAVAILABLE" } };
      }
      return {
        ...state,
        status: { kind: "FAILED", failure: asFailure(action.failure) },
        announcement: action.failure.error.message,
      };

    case "DRAFT_CHANGED": {
      const draftErrors = { ...state.draftErrors };
      for (const key of Object.keys(action.draft) as (keyof ControlProposalDraft)[]) {
        if (key === "merchant"
          || key === "purpose"
          || key === "amountText"
          || key === "firstChargeDate"
          || key === "outcomeMetric"
          || key === "outcomeTargetText"
          || key === "outcomeUnit"
          || key === "outcomeReviewOn") delete draftErrors[key];
      }
      // A currency change re-opens the amount question: the exponent may differ.
      if (action.draft.currency !== undefined) delete draftErrors.amountText;
      return { ...state, draft: { ...state.draft, ...action.draft }, draftErrors, failure: null };
    }

    case "EXISTING_COMMITMENT_TOGGLED": {
      const selected = state.draft.existingCommitmentIds.includes(action.commitmentId);
      return {
        ...state,
        draft: {
          ...state.draft,
          existingCommitmentIds: selected
            ? state.draft.existingCommitmentIds.filter((id) => id !== action.commitmentId)
            : [...state.draft.existingCommitmentIds, action.commitmentId],
        },
      };
    }

    case "PROPOSAL_REJECTED":
      return {
        ...state,
        draftErrors: action.errors,
        announcement: "This proposal was not sent. Complete the highlighted fields.",
      };

    case "PROPOSAL_STARTED":
      return {
        ...state,
        pending: { kind: "PROPOSAL", idempotencyKey: action.idempotencyKey },
        idempotency: heldSlot(state.idempotency, "PROPOSAL", action.signature, action.idempotencyKey),
        draftErrors: {},
        failure: null,
        staleNotice: null,
        announcement: "Evaluating this proposal against your policy…",
      };

    case "PROPOSAL_SAVED": {
      const { proposal, submitted } = action;
      const citedUnchanged = submitted.existingCommitmentIds.length === state.draft.existingCommitmentIds.length
        && submitted.existingCommitmentIds.every((id) => state.draft.existingCommitmentIds.includes(id));
      const outcomeUnchanged = proposal.intendedOutcome !== null
        && JSON.stringify(proposal.intendedOutcome) === JSON.stringify(submitted.intendedOutcome);
      return {
        ...state,
        pending: null,
        idempotency: withoutSlot(state.idempotency, "PROPOSAL"),
        // Only the values the server echoed back are cleared. Anything it did
        // not confirm stays on screen, exactly as the reader typed it.
        draft: {
          ...state.draft,
          merchant: proposal.merchant === submitted.merchant ? "" : state.draft.merchant,
          purpose: proposal.purpose === submitted.purpose ? "" : state.draft.purpose,
          amountText: proposal.amountMinor === submitted.amountMinor && proposal.currency === submitted.currency ? "" : state.draft.amountText,
          existingCommitmentIds: citedUnchanged ? [] : state.draft.existingCommitmentIds,
          outcomeMetric: outcomeUnchanged ? "" : state.draft.outcomeMetric,
          outcomeTargetText: outcomeUnchanged ? "" : state.draft.outcomeTargetText,
          outcomeUnit: outcomeUnchanged ? "" : state.draft.outcomeUnit,
          outcomeReviewOn: outcomeUnchanged ? "" : state.draft.outcomeReviewOn,
        },
        brief: state.brief
          ? {
            ...state.brief,
            proposals: [
              { proposal: action.proposal, evaluation: action.evaluation, decision: null, reconciliations: [], outcomeObservations: [], exceptionReviews: [] },
              ...state.brief.proposals.filter((entry) => entry.proposal.id !== action.proposal.id),
            ],
          }
          : state.brief,
        workspaceVersion: action.meta.workspaceVersion,
        requestId: action.meta.requestId,
        focusProposalId: action.proposal.id,
        staleNotice: null,
        attentionProjection: action.meta.attentionProjection ?? null,
        announcement: `Evaluated against policy version ${action.evaluation.policyVersion}. A person still has to decide this.`,
      };
    }

    case "PROPOSAL_FAILED":
      return {
        ...state,
        pending: null,
        idempotency: settleAfterFailure(state, "PROPOSAL", action.failure),
        failure: asFailure(action.failure),
        staleNotice: isStale(action.failure) ? staleCopy : null,
        announcement: `Not evaluated. ${action.failure.error.message}`,
      };

    case "DIALOG_OPENED":
      return {
        ...state,
        dialog: action.dialog,
        returnFocusId: action.returnFocusId,
        failure: null,
        decisionDraft: action.dialog.kind === "DECISION" ? { action: null, capText: "", authorizationExpiresOn: "", overrideReason: "", error: null } : state.decisionDraft,
        reconciliationDraft: action.dialog.kind === "RECONCILIATION"
          ? { commitmentId: null, evidenceId: null, outcomeValueText: "", outcomeObservedOn: "", error: null }
          : state.reconciliationDraft,
        policyDraft: action.dialog.kind === "POLICY" ? action.policyDraft ?? state.policyDraft : state.policyDraft,
      };

    case "DIALOG_CLOSED":
      return { ...state, dialog: null, returnFocusId: null };

    case "DECISION_DRAFT_CHANGED":
      return { ...state, decisionDraft: { ...state.decisionDraft, ...action.draft, error: action.draft.error ?? null } };

    case "DECISION_STARTED":
      return {
        ...state,
        pending: { kind: "DECISION", idempotencyKey: action.idempotencyKey, proposalId: action.proposalId, action: action.action },
        idempotency: heldSlot(state.idempotency, "DECISION", action.signature, action.idempotencyKey),
        failure: null,
        staleNotice: null,
        announcement: "Recording your decision…",
      };

    case "DECISION_SAVED":
      return {
        ...state,
        pending: null,
        dialog: null,
        idempotency: withoutSlot(state.idempotency, "DECISION"),
        brief: state.brief
          ? {
            ...state.brief,
            proposals: state.brief.proposals.map((entry) => (
              entry.proposal.id === action.decision.proposalId ? { ...entry, decision: action.decision } : entry
            )),
          }
          : state.brief,
        workspaceVersion: action.meta.workspaceVersion,
        requestId: action.meta.requestId,
        focusProposalId: action.decision.proposalId,
        attentionProjection: action.meta.attentionProjection ?? null,
        announcement: "Decision recorded. No money was moved and nothing was purchased or cancelled.",
      };

    case "DECISION_FAILED":
      return {
        ...state,
        pending: null,
        idempotency: settleAfterFailure(state, "DECISION", action.failure),
        failure: asFailure(action.failure),
        staleNotice: isStale(action.failure) ? staleCopy : null,
        announcement: `Not recorded. ${action.failure.error.message}`,
      };

    case "RECONCILIATION_DRAFT_CHANGED":
      return { ...state, reconciliationDraft: { ...state.reconciliationDraft, ...action.draft, error: action.draft.error ?? null } };

    case "RECONCILIATION_STARTED":
      return {
        ...state,
        pending: { kind: "RECONCILIATION", idempotencyKey: action.idempotencyKey, proposalId: action.proposalId },
        idempotency: heldSlot(state.idempotency, "RECONCILIATION", action.signature, action.idempotencyKey),
        failure: null,
        staleNotice: null,
        announcement: "Comparing the observed evidence with the frozen authorization…",
      };

    case "RECONCILIATION_SAVED":
      return {
        ...state,
        pending: null,
        dialog: null,
        idempotency: withoutSlot(state.idempotency, "RECONCILIATION"),
        brief: state.brief
          ? {
            ...state.brief,
            proposals: state.brief.proposals.map((entry) => (
              entry.proposal.id === action.reconciliation.proposalId
                ? { ...entry, reconciliations: [action.reconciliation, ...entry.reconciliations] }
                : entry
            )),
          }
          : state.brief,
        workspaceVersion: action.meta.workspaceVersion,
        requestId: action.meta.requestId,
        focusProposalId: action.reconciliation.proposalId,
        attentionProjection: action.meta.attentionProjection ?? null,
        announcement: "Observed evidence linked. The frozen cap is unchanged.",
      };

    case "RECONCILIATION_FAILED":
      return {
        ...state,
        pending: null,
        idempotency: settleAfterFailure(state, "RECONCILIATION", action.failure),
        failure: asFailure(action.failure),
        staleNotice: isStale(action.failure) ? staleCopy : null,
        announcement: `Not linked. ${action.failure.error.message}`,
      };

    case "OUTCOME_STARTED":
      return {
        ...state,
        pending: { kind: "OUTCOME", idempotencyKey: action.idempotencyKey, proposalId: action.proposalId },
        idempotency: heldSlot(state.idempotency, "OUTCOME", action.signature, action.idempotencyKey),
        failure: null,
        staleNotice: null,
        announcement: "Recording the user-entered outcome observation…",
      };

    case "OUTCOME_SAVED":
      return {
        ...state,
        pending: null,
        dialog: null,
        idempotency: withoutSlot(state.idempotency, "OUTCOME"),
        brief: state.brief
          ? {
            ...state.brief,
            proposals: state.brief.proposals.map((entry) => entry.proposal.id === action.observation.proposalId
              ? { ...entry, outcomeObservations: [action.observation, ...entry.outcomeObservations] }
              : entry),
          }
          : state.brief,
        workspaceVersion: action.meta.workspaceVersion,
        requestId: action.meta.requestId,
        focusProposalId: action.observation.proposalId,
        attentionProjection: action.meta.attentionProjection ?? null,
        announcement: "User-entered outcome recorded. No financial evidence was created.",
      };

    case "OUTCOME_FAILED":
      return {
        ...state,
        pending: null,
        idempotency: settleAfterFailure(state, "OUTCOME", action.failure),
        failure: asFailure(action.failure),
        staleNotice: isStale(action.failure) ? staleCopy : null,
        announcement: `Outcome not recorded. ${action.failure.error.message}`,
      };

    case "EXCEPTION_REVIEW_STARTED":
      return {
        ...state,
        pending: { kind: "EXCEPTION_REVIEW", idempotencyKey: action.idempotencyKey, proposalId: action.proposalId },
        idempotency: heldSlot(state.idempotency, "EXCEPTION_REVIEW", action.signature, action.idempotencyKey),
        failure: null,
        staleNotice: null,
        announcement: "Recording the human disposition…",
      };

    case "EXCEPTION_REVIEW_SAVED":
      return {
        ...state,
        pending: null,
        dialog: null,
        idempotency: withoutSlot(state.idempotency, "EXCEPTION_REVIEW"),
        brief: state.brief
          ? {
            ...state.brief,
            proposals: state.brief.proposals.map((entry) => entry.proposal.id === action.review.proposalId
              ? { ...entry, exceptionReviews: [action.review, ...entry.exceptionReviews] }
              : entry),
          }
          : state.brief,
        workspaceVersion: action.meta.workspaceVersion,
        requestId: action.meta.requestId,
        focusProposalId: action.review.proposalId,
        attentionProjection: action.meta.attentionProjection ?? null,
        announcement: "Exception disposition recorded. The original evidence and verdict are unchanged.",
      };

    case "EXCEPTION_REVIEW_FAILED":
      return {
        ...state,
        pending: null,
        idempotency: settleAfterFailure(state, "EXCEPTION_REVIEW", action.failure),
        failure: asFailure(action.failure),
        staleNotice: isStale(action.failure) ? staleCopy : null,
        announcement: `Disposition not recorded. ${action.failure.error.message}`,
      };

    case "POLICY_DRAFT_CHANGED":
      return state.policyDraft ? { ...state, policyDraft: { ...state.policyDraft, ...action.draft } } : state;

    case "POLICY_STARTED":
      return {
        ...state,
        pending: { kind: "POLICY", idempotencyKey: action.idempotencyKey },
        idempotency: heldSlot(state.idempotency, "POLICY", action.signature, action.idempotencyKey),
        failure: null,
        staleNotice: null,
        announcement: "Recording a new policy version…",
      };

    case "POLICY_SAVED":
      return {
        ...state,
        pending: null,
        dialog: null,
        policyDraft: null,
        idempotency: withoutSlot(state.idempotency, "POLICY"),
        brief: state.brief ? { ...state.brief, policy: action.policy } : state.brief,
        workspaceVersion: action.meta.workspaceVersion,
        requestId: action.meta.requestId,
        announcement: `Policy version ${action.policy.policyVersion} recorded. Earlier versions are unchanged.`,
      };

    case "POLICY_FAILED":
      return {
        ...state,
        pending: null,
        idempotency: settleAfterFailure(state, "POLICY", action.failure),
        policyDraft: state.policyDraft ? { ...state.policyDraft, error: action.failure.error.message } : state.policyDraft,
        failure: asFailure(action.failure),
        staleNotice: isStale(action.failure) ? staleCopy : null,
        announcement: `Not recorded. ${action.failure.error.message}`,
      };

    case "FOCUS_SET":
      return { ...state, focusProposalId: action.proposalId };

    case "FOCUS_CLEARED":
      return state.focusProposalId === null ? state : { ...state, focusProposalId: null };
  }
}
