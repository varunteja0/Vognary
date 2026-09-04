import type { CommitmentControlBriefDto } from "./commitment-control/contracts";
import { authorizeProposalDecision } from "./commitment-control/decision";
import { evaluateProposalPolicy, type ProposalPolicy } from "./commitment-control/policy";
import { projectProposalExposure } from "./commitment-control/project";
import { reconcileAuthorizedProposal } from "./commitment-control/reconcile";
import {
  SYNTHETIC_DEMO_LABEL,
  SYNTHETIC_DEMO_UUID_NAMESPACE,
  syntheticFixtureIdentity,
  syntheticId as id,
} from "./synthetic-fixture-identity";

export { SYNTHETIC_DEMO_LABEL, SYNTHETIC_DEMO_UUID_NAMESPACE };

/**
 * SYNTHETIC_CC_V2 — the canonical Commitment Control demonstration record.
 *
 * A finance owner at a small India-first AI company is asked to reserve a month
 * of inference capacity before a customer launch. The company already carries a
 * monthly commitment to the same vendor, proven by two invoices. The request is
 * larger than the per-charge limit the company wrote for itself, so no rule can
 * settle it — a named human has to.
 *
 * Four rules keep it honest:
 *
 *   1. Nothing derived below is hand-authored. Synthetic *inputs* are declared
 *      once, then the four canonical pure engines produce every derived fact:
 *      projectProposalExposure → evaluateProposalPolicy →
 *      authorizeProposalDecision → reconcileAuthorizedProposal. A fixture
 *      cannot claim a policy status, a cap or a verdict the product would not
 *      itself produce.
 *   2. Every name is a placeholder, every id sits in one synthetic UUID
 *      namespace, and the surfaces that render it label it a synthetic
 *      demonstration in visible text. Nothing here is a customer or activity.
 *   3. It never reaches the network. It is not writable, not counted as usage,
 *      and no path from it mutates a workspace.
 *   4. Money stays in exact minor units and one currency. Nothing is recomputed
 *      for display and no float ever touches an amount.
 */

const IDS = {
  proposal: id("00000000c0de"),
  evaluation: id("00000000900d"),
  userOwner: id("0000000000f1"),
  userEngineering: id("0000000000f2"),
  evidenceJune: id("00000000ea01"),
  evidenceJuly: id("00000000ea02"),
  evidenceSeptember: id("00000000ea03"),
  decisionApprove: id("00000000dec1"),
  decisionCapped: id("00000000dec2"),
  decisionDecline: id("00000000dec3"),
  reconcileApprove: id("000000000bc1"),
  reconcileCapped: id("000000000bc2"),
} as const;

/** Fixed so the demonstration reads identically on every visit and in every capture. */
const AS_OF = "2026-08-24";
const PROPOSED_AT = "2026-08-24T09:12:00.000Z";
const DECIDED_AT = "2026-08-24T11:40:00.000Z";
const OBSERVED_AT = "2026-09-01T04:31:00.000Z";
const AUTHORIZATION_EXPIRES_ON = "2026-09-01";
const INTENDED_OUTCOME = {
  metric: "Customer launch requests served",
  targetDirection: "AT_LEAST",
  targetValue: "1",
  unit: "launch",
  reviewOn: "2026-09-07",
} as const;

export type SyntheticDemoBranch = "APPROVE" | "APPROVE_WITH_CAP" | "DECLINE";

export const syntheticDemoBranchOrder: readonly SyntheticDemoBranch[] = [
  "APPROVE_WITH_CAP",
  "APPROVE",
  "DECLINE",
];

export const syntheticDemoBranchLabels: Record<SyntheticDemoBranch, string> = {
  APPROVE: "Approve the full request",
  APPROVE_WITH_CAP: "Approve with a lower cap",
  DECLINE: "Decline",
};

/** What each branch changes, in one sentence, for the reader who has not decided yet. */
export const syntheticDemoBranchOutcomes: Record<SyntheticDemoBranch, string> = {
  APPROVE: "The cap freezes at the amount that was asked for. September's invoice lands under it.",
  APPROVE_WITH_CAP: "The cap freezes below the request. September's invoice lands above it.",
  DECLINE: "No cap exists, so a later invoice has nothing to be measured against. The refusal is the record.",
};

/* ------------------------------------------------------------------ *
 * DECLARED INPUTS — the only hand-written facts in this file.
 * ------------------------------------------------------------------ */

const REQUEST = {
  merchant: "Model API vendor (placeholder)",
  purpose: "One-month inference-capacity reservation before a customer launch",
  category: "AI_MODEL",
  /** INR 4,80,000. A one-time reservation, not a new subscription. */
  amountMinor: "48000000",
  currency: "INR",
  firstChargeDate: "2026-09-01",
  cadence: "ONE_TIME",
} as const;

/**
 * The two invoices the placeholder company already holds for this vendor. They
 * are what makes the existing INR 3,20,000 monthly commitment a cited fact
 * rather than a recollection.
 */
export const syntheticDemoCitedEvidence = [
  { id: IDS.evidenceJune, period: "June", minor: "32000000", currency: "INR", source: "Vendor invoice (placeholder)" },
  { id: IDS.evidenceJuly, period: "July", minor: "32000000", currency: "INR", source: "Vendor invoice (placeholder)" },
] as const;

/** The existing monthly commitment those two invoices prove. */
export const syntheticDemoExistingCommitment = {
  merchant: REQUEST.merchant,
  minor: "32000000",
  currency: "INR",
  cadence: "MONTHLY",
} as const;

/** The later invoice. One number, shared by every branch, because a cap does not move. */
const OBSERVED_MINOR = "47200000";
export const syntheticDemoObservedMinor = OBSERVED_MINOR;
export const syntheticDemoObservedEvidence = {
  id: IDS.evidenceSeptember,
  period: "September",
  minor: OBSERVED_MINOR,
  currency: "INR",
  source: "Vendor invoice (placeholder)",
  observedAt: OBSERVED_AT,
} as const;

/**
 * Policy v7. AI model spend is allowed as a category — the company is not
 * arguing about whether to buy inference. The only thing this request breaches
 * is the per-charge ceiling, so exactly one reason code appears and the
 * decision cannot hide behind a category argument.
 */
const policy = {
  policyVersion: 7,
  categoryRules: [
    { category: "AI_MODEL", posture: "ALLOW" },
    { category: "CLOUD_INFRASTRUCTURE", posture: "REVIEW" },
    { category: "SOFTWARE", posture: "ALLOW" },
    { category: "CONTRACTOR", posture: "REVIEW" },
    { category: "CAMPAIGN", posture: "OUTSIDE_POLICY" },
    { category: "OTHER", posture: "REVIEW" },
  ],
  currencyLimits: [
    {
      currency: "INR",
      /** INR 4,00,000 — the single limit this request crosses. */
      maxPerChargeMinor: "40000000",
      /** INR 20,00,000 and INR 60,00,000: deliberately clear of this request. */
      maxThirteenWeekMinor: "200000000",
      maxAnnualMinor: "600000000",
    },
  ],
} as const satisfies ProposalPolicy;

/**
 * Exposure the placeholder company already carries from the monthly commitment,
 * cited to the two invoices above. OBSERVATION_ONLY is the honest basis: it is
 * what was observed, not a projection anyone signed off.
 *
 * INR 3,20,000 monthly = INR 9,60,000 across thirteen weeks and INR 38,40,000
 * across a year.
 */
const EXISTING_EXPOSURE = [{
  currency: "INR",
  thirteenWeekMinor: "96000000",
  annualMinor: "384000000",
  evidenceIds: syntheticDemoCitedEvidence.map((entry) => entry.id),
  basis: "OBSERVATION_ONLY" as const,
}];

/* ------------------------------------------------------------------ *
 * DERIVED — produced by the product's own engines, never written by hand.
 * ------------------------------------------------------------------ */

const projection = projectProposalExposure(
  [{
    proposalId: IDS.proposal,
    amountMinor: REQUEST.amountMinor,
    currency: REQUEST.currency,
    firstChargeDate: REQUEST.firstChargeDate,
    cadence: REQUEST.cadence,
  }],
  { asOfDate: AS_OF },
);
const projected = projection.proposals[0];

const evaluation = evaluateProposalPolicy({
  proposal: {
    proposalId: IDS.proposal,
    amountMinor: REQUEST.amountMinor,
    currency: REQUEST.currency,
    category: REQUEST.category,
    thirteenWeekMinor: projected.thirteenWeekMinor,
    annualMinor: projected.annualMinor,
  },
  policy,
  existingExposure: EXISTING_EXPOSURE,
});

export const syntheticDemoEvaluation = evaluation;
export const syntheticDemoPolicy = policy;
export const syntheticDemoProjection = projected;

const proposal = {
  id: IDS.proposal,
  submittedByUserId: IDS.userEngineering,
  submittedByDisplayName: "Engineering lead (placeholder)",
  merchant: REQUEST.merchant,
  purpose: REQUEST.purpose,
  category: REQUEST.category,
  amountMinor: REQUEST.amountMinor,
  currency: REQUEST.currency,
  firstChargeDate: REQUEST.firstChargeDate,
  cadence: REQUEST.cadence,
  asOfDate: AS_OF,
  projectedThirteenWeekMinor: projected.thirteenWeekMinor,
  projectedAnnualMinor: projected.annualMinor,
  intendedOutcome: INTENDED_OUTCOME,
  assumptionBasis: projected.basis,
  createdAt: PROPOSED_AT,
} as const satisfies CommitmentControlBriefDto["proposals"][number]["proposal"];

const evaluationDto = {
  id: IDS.evaluation,
  proposalId: IDS.proposal,
  policyVersion: evaluation.policyVersion,
  status: evaluation.status,
  humanDecisionRequired: evaluation.humanDecisionRequired,
  assumptionFields: evaluation.assumptionFields,
  citedEvidenceIds: evaluation.citedEvidenceIds,
  citedExposureBasis: evaluation.citedExposureBasis,
  reasonCodes: evaluation.reasonCodes,
  currencyResults: evaluation.currencyResults,
  evaluatedAt: PROPOSED_AT,
} satisfies NonNullable<CommitmentControlBriefDto["proposals"][number]["evaluation"]>;

const policyDto = {
  ...policy,
  createdByUserId: IDS.userOwner,
  createdAt: "2026-07-02T06:00:00.000Z",
} satisfies NonNullable<CommitmentControlBriefDto["policy"]>;

/** The lower cap a placeholder finance owner chooses: INR 3,60,000. */
const LOWER_CAP_MINOR = "36000000";

const DECISION_REASON: Record<SyntheticDemoBranch, string> = {
  APPROVE: "Customer launch capacity only; revisit before the next cycle.",
  APPROVE_WITH_CAP: "Customer launch capacity only; revisit before the next cycle.",
  DECLINE: "Reserve capacity from the existing monthly commitment instead.",
};

/**
 * Identity for evidence provenance. Hashing the declared inputs — not the
 * derived output — means a capture stops matching the moment a hand-written
 * fact moves, while an engine change is caught by the engine's own tests.
 */
export const syntheticDemoIdentity = syntheticFixtureIdentity("SYNTHETIC_CC_V2", "2", {
  REQUEST,
  policy,
  EXISTING_EXPOSURE,
  LOWER_CAP_MINOR,
  OBSERVED_MINOR,
  AS_OF,
  PROPOSED_AT,
  DECIDED_AT,
  OBSERVED_AT,
  AUTHORIZATION_EXPIRES_ON,
  INTENDED_OUTCOME,
  DECISION_REASON,
  citedEvidence: syntheticDemoCitedEvidence,
});

const decisionIds: Record<SyntheticDemoBranch, string> = {
  APPROVE: IDS.decisionApprove,
  APPROVE_WITH_CAP: IDS.decisionCapped,
  DECLINE: IDS.decisionDecline,
};

function authorize(branch: SyntheticDemoBranch) {
  return authorizeProposalDecision({
    actorRole: "owner",
    actorUserId: IDS.userOwner,
    evaluation,
    action: branch,
    approvedCapMinor: branch === "APPROVE_WITH_CAP" ? LOWER_CAP_MINOR : undefined,
    authorizationExpiresOn: branch === "DECLINE" ? undefined : AUTHORIZATION_EXPIRES_ON,
    decidedAt: DECIDED_AT,
    submittedByUserId: IDS.userEngineering,
    overrideReason: DECISION_REASON[branch],
  });
}

const decisions: Record<SyntheticDemoBranch, ReturnType<typeof authorize>> = {
  APPROVE: authorize("APPROVE"),
  APPROVE_WITH_CAP: authorize("APPROVE_WITH_CAP"),
  DECLINE: authorize("DECLINE"),
};

export function syntheticDemoDecision(branch: SyntheticDemoBranch) {
  return decisions[branch];
}

/**
 * A decline creates no cap, so the engine cannot evaluate a later receipt
 * against it. The product does not offer reconciliation on a refusal, and
 * neither does this: the branch is null rather than a "cannot evaluate" record
 * dressed up as an outcome.
 */
function reconciliationFor(branch: SyntheticDemoBranch) {
  if (branch === "DECLINE") return null;
  const reconciled = reconcileAuthorizedProposal({
    decision: decisions[branch],
    evidence: {
      evidenceId: IDS.evidenceSeptember,
      amountMinor: OBSERVED_MINOR,
      currency: syntheticDemoObservedEvidence.currency,
      evidenceDate: "2026-09-01",
    },
    intendedOutcome: INTENDED_OUTCOME,
  });
  return {
    id: branch === "APPROVE" ? IDS.reconcileApprove : IDS.reconcileCapped,
    proposalId: reconciled.proposalId,
    decisionId: decisionIds[branch],
    evidenceId: reconciled.evidenceId,
    verdict: reconciled.verdict,
    expectedAmountMinor: reconciled.expectedAmountMinor,
    approvedCapMinor: reconciled.approvedCapMinor,
    authorizationCurrency: reconciled.authorizationCurrency,
    observedAmountMinor: reconciled.observedAmountMinor,
    observedCurrency: reconciled.observedCurrency,
    observedEvidenceDate: reconciled.observedEvidenceDate,
    outcome: reconciled.outcome,
    reconciledByUserId: IDS.userOwner,
    reconciledAt: OBSERVED_AT,
  } satisfies CommitmentControlBriefDto["proposals"][number]["reconciliations"][number];
}

const reconciliations: Record<SyntheticDemoBranch, ReturnType<typeof reconciliationFor>> = {
  APPROVE: reconciliationFor("APPROVE"),
  APPROVE_WITH_CAP: reconciliationFor("APPROVE_WITH_CAP"),
  DECLINE: reconciliationFor("DECLINE"),
};

/** True only where a frozen boundary exists for a later receipt to be measured against. */
export function syntheticDemoHasOutcome(branch: SyntheticDemoBranch): boolean {
  return reconciliations[branch] !== null;
}

export function syntheticDemoReconciliation(branch: SyntheticDemoBranch) {
  return reconciliations[branch];
}

/**
 * `stage` walks the reader through the record the way the loop actually runs.
 * Nothing is skipped and nothing is pre-decided: the decision only exists once
 * the reader chooses a branch.
 */
export type SyntheticDemoStage = "PROPOSED" | "DECIDED" | "RECONCILED";

export function syntheticControlBrief(
  stage: SyntheticDemoStage,
  branch: SyntheticDemoBranch = "APPROVE_WITH_CAP",
): CommitmentControlBriefDto {
  const authorized = decisions[branch];
  const decision = stage === "PROPOSED"
    ? null
    : {
      id: decisionIds[branch],
      evaluationId: evaluationDto.id,
      proposalId: authorized.proposalId,
      evaluationPolicyVersion: authorized.evaluationPolicyVersion,
      action: authorized.action,
      approvedCapMinor: authorized.approvedCapMinor,
      currency: authorized.currency,
      expectedAmountMinor: authorized.expectedAmountMinor,
      decidedByUserId: authorized.decidedByUserId,
      decidedByDisplayName: "Finance owner (placeholder)",
      overrideReason: authorized.overrideReason,
      decidedAt: authorized.decidedAt,
      authorizationExpiresOn: authorized.authorizationExpiresOn,
    };

  const reconciliation = reconciliations[branch];

  return {
    policy: policyDto,
    proposals: [
      {
        proposal,
        evaluation: evaluationDto,
        decision,
        reconciliations: stage === "RECONCILED" && decision && reconciliation ? [reconciliation] : [],
        outcomeObservations: [],
        exceptionReviews: [],
      },
    ],
    // Read-only. The demonstration never offers a control that would write.
    capabilities: { canSubmitProposal: false, canDecide: false, canConfigurePolicy: false },
  };
}
