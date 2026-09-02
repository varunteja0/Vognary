import type { CommitmentControlBriefDto } from "./commitment-control/contracts";
import { authorizeProposalDecision } from "./commitment-control/decision";
import { evaluateProposalPolicy, type ProposalPolicy } from "./commitment-control/policy";
import { projectProposalExposure } from "./commitment-control/project";
import { reconcileAuthorizedProposal } from "./commitment-control/reconcile";

/**
 * A frontend-only, deterministic Commitment Control brief.
 *
 * It exists so a stranger can experience the whole loop — request, cited
 * exposure, policy context, a named human decision, a frozen cap and a later
 * observed outcome — before any account, enrollment or customer data exists.
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

export const SYNTHETIC_DEMO_LABEL = "Synthetic demonstration";

/**
 * The contract validator requires real UUIDs, so every synthetic id lives in one
 * fixed namespace. A reader, a log line or a test can recognise a demonstration
 * record on sight, and nothing here can collide with a real workspace id.
 */
export const SYNTHETIC_DEMO_UUID_NAMESPACE = "5eeded00-0000-4000-8000-";
const id = (suffix: string) => `${SYNTHETIC_DEMO_UUID_NAMESPACE}${suffix}`;

const IDS = {
  proposal: id("00000000c0de"),
  evaluation: id("00000000900d"),
  userOwner: id("0000000000f1"),
  userEngineering: id("0000000000f2"),
  evidenceJuly: id("00000000ea01"),
  evidenceAugust: id("00000000ea02"),
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

export type SyntheticDemoBranch = "APPROVE" | "APPROVE_WITH_CAP" | "DECLINE";

export const syntheticDemoBranchOrder: readonly SyntheticDemoBranch[] = [
  "APPROVE_WITH_CAP",
  "APPROVE",
  "DECLINE",
];

export const syntheticDemoBranchLabels: Record<SyntheticDemoBranch, string> = {
  APPROVE: "Approve at the proposed amount",
  APPROVE_WITH_CAP: "Approve with a lower cap",
  DECLINE: "Decline",
};

/** What each branch changes, in one sentence, for the reader who has not decided yet. */
export const syntheticDemoBranchOutcomes: Record<SyntheticDemoBranch, string> = {
  APPROVE: "The boundary freezes at the amount that was asked for. The later receipt still lands above it.",
  APPROVE_WITH_CAP: "The boundary freezes below the request. The later receipt lands further above it.",
  DECLINE: "No boundary is created, so there is nothing for a later receipt to be measured against. The refusal is the record.",
};

/* ------------------------------------------------------------------ *
 * SYNTHETIC INPUTS — the only hand-written facts in this file.
 * ------------------------------------------------------------------ */

const REQUEST = {
  merchant: "Model API vendor (placeholder)",
  purpose: "Raise the inference tier before the launch window",
  category: "AI_MODEL",
  amountMinor: "420000",
  currency: "INR",
  firstChargeDate: "2026-09-01",
  cadence: "MONTHLY",
} as const;

/** Two vendor invoices a placeholder company already holds. Exact minor units. */
export const syntheticDemoCitedEvidence = [
  { id: IDS.evidenceJuly, period: "July", minor: "305000", currency: "INR", source: "Vendor invoice (placeholder)" },
  { id: IDS.evidenceAugust, period: "August", minor: "305000", currency: "INR", source: "Vendor invoice (placeholder)" },
] as const;

/** The later receipt. One number, shared by every branch, because a boundary does not move. */
const OBSERVED_MINOR = "472000";
export const syntheticDemoObservedMinor = OBSERVED_MINOR;
export const syntheticDemoObservedEvidence = {
  id: IDS.evidenceSeptember,
  period: "September",
  minor: OBSERVED_MINOR,
  currency: "INR",
  source: "Vendor invoice (placeholder)",
  observedAt: OBSERVED_AT,
} as const;

const policy = {
  policyVersion: 3,
  categoryRules: [
    { category: "AI_MODEL", posture: "REVIEW" },
    { category: "CLOUD_INFRASTRUCTURE", posture: "REVIEW" },
    { category: "SOFTWARE", posture: "ALLOW" },
    { category: "CONTRACTOR", posture: "REVIEW" },
    { category: "CAMPAIGN", posture: "OUTSIDE_POLICY" },
    { category: "OTHER", posture: "REVIEW" },
  ],
  currencyLimits: [
    { currency: "INR", maxPerChargeMinor: "500000", maxThirteenWeekMinor: "2000000", maxAnnualMinor: "10000000" },
  ],
} as const satisfies ProposalPolicy;

/**
 * Exposure the placeholder company already carries, cited to the two invoices
 * above. OBSERVATION_ONLY is the honest basis: it is what was observed, not a
 * projection anyone signed off.
 */
const EXISTING_EXPOSURE = [{
  currency: "INR",
  thirteenWeekMinor: "915000",
  annualMinor: "3660000",
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

/** The lower cap a placeholder founder chooses. Below the request, as the engine requires. */
const LOWER_CAP_MINOR = "360000";

const DECISION_REASON: Record<SyntheticDemoBranch, string> = {
  APPROVE: "Launch window is committed. Accepting the ceiling breach for one cycle.",
  APPROVE_WITH_CAP: "Launch window only. Revisit before the next renewal.",
  DECLINE: "Existing thirteen-week exposure is already at the ceiling.",
};

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
    },
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
      decidedByDisplayName: "Founder (placeholder)",
      overrideReason: authorized.overrideReason,
      decidedAt: authorized.decidedAt,
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
      },
    ],
    // Read-only. The demonstration never offers a control that would write.
    capabilities: { canSubmitProposal: false, canDecide: false, canConfigurePolicy: false },
  };
}
