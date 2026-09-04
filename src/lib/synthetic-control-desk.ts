import type { CommitmentControlBriefDto } from "./commitment-control/contracts";
import { authorizeProposalDecision, type ProposalDecisionAction } from "./commitment-control/decision";
import type { IntendedControlOutcome } from "./commitment-control/outcome";
import { evaluateProposalPolicy, type ProposalCategory } from "./commitment-control/policy";
import { projectProposalExposure, type ProposalCadence } from "./commitment-control/project";
import { reconcileAuthorizedProposal } from "./commitment-control/reconcile";
import { syntheticDemoPolicy } from "./synthetic-control-demo";
import { syntheticFixtureIdentity, syntheticId as id } from "./synthetic-fixture-identity";

/**
 * SYNTHETIC_CC_DESK_V1 — one record proves the loop; a desk proves the job.
 *
 * Six requests in the states a finance owner actually meets in a week: two
 * waiting on them, one authorized and waiting on evidence, one that came back
 * over the cap, one that closed clean, and one they refused. Same policy v7 as
 * the hero record, same four engines, same currency.
 *
 * Every status, reason code, cap and verdict below is produced by
 * projectProposalExposure → evaluateProposalPolicy → authorizeProposalDecision →
 * reconcileAuthorizedProposal. The declared inputs are the only hand-written
 * facts. No risk score, probability, saving, benchmark, company total, or
 * activity metric is invented anywhere in this file — the product does not
 * compute those, so the fixture must not pretend it does.
 */

/** The day the desk is being read. Ages and "today" are measured from here. */
export const SYNTHETIC_DESK_AS_OF = "2026-08-24";
const AS_OF = SYNTHETIC_DESK_AS_OF;

/**
 * Queue order is the order the work has to happen in, not a ranking. Records
 * that need a human today come before records that are waiting on the world,
 * which come before records that are closed. Inside a group, declared order is
 * preserved so the list never reshuffles between renders.
 */
export const deskQueueStates = [
  "DECIDE_NOW",
  "REVIEW_REQUEST",
  "AWAITING_EVIDENCE",
  "INSPECT_OVERRUN",
  "CLOSED_MATCHED",
  "CLOSED_REFUSED",
] as const;

export type DeskQueueState = typeof deskQueueStates[number];

export const deskQueueGroups = [
  { id: "NEEDS_YOU", label: "Needs a decision", states: ["DECIDE_NOW", "REVIEW_REQUEST"] },
  { id: "IN_FLIGHT", label: "Authorized, watching", states: ["AWAITING_EVIDENCE", "INSPECT_OVERRUN"] },
  { id: "CLOSED", label: "Closed", states: ["CLOSED_MATCHED", "CLOSED_REFUSED"] },
] as const satisfies readonly { id: string; label: string; states: readonly DeskQueueState[] }[];

export type DeskCitation = {
  id: string;
  label: string;
  minor: string | null;
  currency: string | null;
  source: string;
  excerpt: string;
};

type DeclaredRecord = {
  key: string;
  merchant: string;
  purpose: string;
  category: ProposalCategory;
  amountMinor: string;
  currency: string;
  cadence: ProposalCadence;
  firstChargeDate: string;
  submittedBy: string;
  submittedAt: string;
  queueState: DeskQueueState;
  nextAction: string;
  citations: readonly DeskCitation[];
  /** Exposure the citations prove. Empty means nothing is cited yet, and the record says so. */
  existingExposure: readonly { thirteenWeekMinor: string; annualMinor: string }[];
  intendedOutcome: IntendedControlOutcome;
  decision: null | {
    action: ProposalDecisionAction;
    approvedCapMinor?: string;
    reason: string;
    decidedBy: string;
    decidedAt: string;
  };
  observed: null | {
    label: string;
    minor: string | null;
    currency: string | null;
    source: string;
    excerpt: string;
    observedAt: string;
  };
};

/* ------------------------------------------------------------------ *
 * DECLARED INPUTS
 * ------------------------------------------------------------------ */

const OWNER = id("0000000000f1");
const ENGINEERING = id("0000000000f2");
const PLATFORM = id("0000000000f3");
const OPERATIONS = id("0000000000f4");
const GROWTH = id("0000000000f5");

const DECLARED: readonly DeclaredRecord[] = [
  {
    key: "model-api",
    merchant: "Model API vendor (placeholder)",
    purpose: "One-month inference-capacity reservation before a customer launch",
    category: "AI_MODEL",
    amountMinor: "48000000",
    currency: "INR",
    cadence: "ONE_TIME",
    firstChargeDate: "2026-09-01",
    submittedBy: "Engineering lead (placeholder)",
    submittedAt: "2026-08-24T09:12:00.000Z",
    queueState: "DECIDE_NOW",
    nextAction: "Decide now",
    citations: [
      { id: id("00000000ea01"), label: "June invoice", minor: "32000000", currency: "INR", source: "Vendor invoice (placeholder)", excerpt: "Inference capacity — monthly commitment" },
      { id: id("00000000ea02"), label: "July invoice", minor: "32000000", currency: "INR", source: "Vendor invoice (placeholder)", excerpt: "Inference capacity — monthly commitment" },
    ],
    existingExposure: [{ thirteenWeekMinor: "96000000", annualMinor: "384000000" }],
    intendedOutcome: { metric: "Customer launch requests served", targetDirection: "AT_LEAST", targetValue: "1", unit: "launch", reviewOn: "2026-09-07" },
    decision: null,
    observed: null,
  },
  {
    key: "cloud-failover",
    merchant: "Cloud region failover capacity (placeholder)",
    purpose: "Standby capacity in a second region for the launch week",
    category: "CLOUD_INFRASTRUCTURE",
    amountMinor: "24000000",
    currency: "INR",
    cadence: "ONE_TIME",
    firstChargeDate: "2026-09-02",
    submittedBy: "Platform engineer (placeholder)",
    submittedAt: "2026-08-23T13:05:00.000Z",
    queueState: "REVIEW_REQUEST",
    nextAction: "Review request",
    // Nothing cited: this vendor is new, and the record says so instead of
    // implying an exposure history that does not exist.
    citations: [],
    existingExposure: [],
    intendedOutcome: { metric: "Failover tests completed", targetDirection: "AT_LEAST", targetValue: "1", unit: "tests", reviewOn: "2026-09-09" },
    decision: null,
    observed: null,
  },
  {
    key: "observability",
    merchant: "Observability capacity (placeholder)",
    purpose: "Extra log retention through the launch window",
    category: "SOFTWARE",
    amountMinor: "22000000",
    currency: "INR",
    cadence: "ONE_TIME",
    firstChargeDate: "2026-08-28",
    submittedBy: "Platform engineer (placeholder)",
    submittedAt: "2026-08-19T07:40:00.000Z",
    queueState: "AWAITING_EVIDENCE",
    nextAction: "Link evidence when the invoice arrives",
    citations: [
      { id: id("00000000eb01"), label: "May invoice", minor: "9000000", currency: "INR", source: "Vendor invoice (placeholder)", excerpt: "Log retention — base tier" },
    ],
    existingExposure: [{ thirteenWeekMinor: "27000000", annualMinor: "108000000" }],
    intendedOutcome: { metric: "Incident investigation time", targetDirection: "AT_MOST", targetValue: "30", unit: "minutes", reviewOn: "2026-09-05" },
    decision: {
      action: "APPROVE_WITH_CAP",
      approvedCapMinor: "20000000",
      reason: "Retention only through the launch window.",
      decidedBy: "Finance owner (placeholder)",
      decidedAt: "2026-08-19T10:15:00.000Z",
    },
    observed: null,
  },
  {
    key: "vector-database",
    merchant: "Vector database vendor (placeholder)",
    purpose: "Production index tier for retrieval",
    category: "SOFTWARE",
    amountMinor: "18000000",
    currency: "INR",
    cadence: "MONTHLY",
    firstChargeDate: "2026-08-05",
    submittedBy: "Engineering lead (placeholder)",
    submittedAt: "2026-07-29T11:20:00.000Z",
    queueState: "INSPECT_OVERRUN",
    nextAction: "Inspect the overrun",
    citations: [
      { id: id("00000000eb02"), label: "June invoice", minor: "12000000", currency: "INR", source: "Vendor invoice (placeholder)", excerpt: "Index tier — monthly" },
    ],
    existingExposure: [{ thirteenWeekMinor: "36000000", annualMinor: "144000000" }],
    intendedOutcome: { metric: "Retrieval requests served", targetDirection: "AT_LEAST", targetValue: "1000", unit: "requests", reviewOn: "2026-08-21" },
    decision: {
      action: "APPROVE",
      reason: "Index tier matches the retrieval plan.",
      decidedBy: "Finance owner (placeholder)",
      decidedAt: "2026-07-29T15:02:00.000Z",
    },
    observed: {
      label: "August invoice",
      minor: "19500000",
      currency: "INR",
      source: "Vendor invoice (placeholder)",
      excerpt: "Index tier — monthly, plus overage",
      observedAt: "2026-08-21T05:10:00.000Z",
    },
  },
  {
    key: "security-assessment",
    merchant: "Security assessment firm (placeholder)",
    purpose: "Independent assessment and retest",
    category: "OTHER",
    amountMinor: "30000000",
    currency: "INR",
    cadence: "ONE_TIME",
    firstChargeDate: "2026-08-10",
    submittedBy: "Operations lead (placeholder)",
    submittedAt: "2026-07-24T08:30:00.000Z",
    queueState: "CLOSED_MATCHED",
    nextAction: "Closed — inspect the evidence",
    citations: [],
    existingExposure: [],
    intendedOutcome: { metric: "Assessment reviews completed", targetDirection: "AT_LEAST", targetValue: "1", unit: "reviews", reviewOn: "2026-08-14" },
    decision: {
      action: "APPROVE",
      reason: "Assessment scope agreed in writing.",
      decidedBy: "Finance owner (placeholder)",
      decidedAt: "2026-07-24T12:00:00.000Z",
    },
    observed: {
      label: "August invoice",
      minor: "30000000",
      currency: "INR",
      source: "Vendor invoice (placeholder)",
      excerpt: "Assessment and retest — agreed scope",
      observedAt: "2026-08-14T09:45:00.000Z",
    },
  },
  {
    key: "launch-campaign",
    merchant: "Launch campaign vendor (placeholder)",
    purpose: "Paid campaign for the launch week",
    category: "CAMPAIGN",
    amountMinor: "65000000",
    currency: "INR",
    cadence: "ONE_TIME",
    firstChargeDate: "2026-09-05",
    submittedBy: "Growth lead (placeholder)",
    submittedAt: "2026-08-18T06:15:00.000Z",
    queueState: "CLOSED_REFUSED",
    nextAction: "Closed — refused",
    citations: [],
    existingExposure: [],
    intendedOutcome: { metric: "Qualified launch conversations", targetDirection: "AT_LEAST", targetValue: "10", unit: "conversations", reviewOn: "2026-09-12" },
    decision: {
      action: "DECLINE",
      reason: "Not before the launch proves retention.",
      decidedBy: "Finance owner (placeholder)",
      decidedAt: "2026-08-18T09:50:00.000Z",
    },
    observed: null,
  },
];

export const syntheticDeskIdentity = syntheticFixtureIdentity("SYNTHETIC_CC_DESK_V1", "1", {
  AS_OF,
  DECLARED,
  policyVersion: syntheticDemoPolicy.policyVersion,
});

/* ------------------------------------------------------------------ *
 * DERIVED
 * ------------------------------------------------------------------ */

export type DeskRecord = {
  key: string;
  queueState: DeskQueueState;
  nextAction: string;
  submittedByDisplayName: string;
  citations: readonly DeskCitation[];
  observed: DeclaredRecord["observed"];
  entry: CommitmentControlBriefDto["proposals"][number];
};

function buildRecord(declared: DeclaredRecord, index: number): DeskRecord {
  // Final UUID group is 12 hex characters: 8 zeros, a 2-char kind, a 2-char row.
  const row = String(index + 1).padStart(2, "0");
  const proposalId = id(`00000000a1${row}`);
  const evaluationId = id(`00000000b2${row}`);
  // Exposure was projected when the request was submitted, not today. A record
  // decided in July keeps the projection its decider actually saw.
  const asOfDate = declared.submittedAt.slice(0, 10);

  const projected = projectProposalExposure(
    [{
      proposalId,
      amountMinor: declared.amountMinor,
      currency: declared.currency,
      firstChargeDate: declared.firstChargeDate,
      cadence: declared.cadence,
    }],
    { asOfDate },
  ).proposals[0];

  const evaluation = evaluateProposalPolicy({
    proposal: {
      proposalId,
      amountMinor: declared.amountMinor,
      currency: declared.currency,
      category: declared.category,
      thirteenWeekMinor: projected.thirteenWeekMinor,
      annualMinor: projected.annualMinor,
    },
    policy: syntheticDemoPolicy,
    existingExposure: declared.existingExposure.map((exposure) => ({
      currency: declared.currency,
      thirteenWeekMinor: exposure.thirteenWeekMinor,
      annualMinor: exposure.annualMinor,
      evidenceIds: declared.citations.map((citation) => citation.id),
      basis: "OBSERVATION_ONLY" as const,
    })),
  });

  const proposal = {
    id: proposalId,
    submittedByUserId: submitterId(declared.submittedBy),
    submittedByDisplayName: declared.submittedBy,
    merchant: declared.merchant,
    purpose: declared.purpose,
    category: declared.category,
    amountMinor: declared.amountMinor,
    currency: declared.currency,
    firstChargeDate: declared.firstChargeDate,
    cadence: declared.cadence,
    asOfDate,
    projectedThirteenWeekMinor: projected.thirteenWeekMinor,
    projectedAnnualMinor: projected.annualMinor,
    intendedOutcome: declared.intendedOutcome,
    assumptionBasis: projected.basis,
    createdAt: declared.submittedAt,
  } satisfies CommitmentControlBriefDto["proposals"][number]["proposal"];

  const evaluationDto = {
    id: evaluationId,
    proposalId,
    policyVersion: evaluation.policyVersion,
    status: evaluation.status,
    humanDecisionRequired: evaluation.humanDecisionRequired,
    assumptionFields: evaluation.assumptionFields,
    citedEvidenceIds: evaluation.citedEvidenceIds,
    citedExposureBasis: evaluation.citedExposureBasis,
    reasonCodes: evaluation.reasonCodes,
    currencyResults: evaluation.currencyResults,
    evaluatedAt: declared.submittedAt,
  } satisfies NonNullable<CommitmentControlBriefDto["proposals"][number]["evaluation"]>;

  if (!declared.decision) {
    return record(declared, { proposal, evaluation: evaluationDto, decision: null, reconciliations: [], outcomeObservations: [], exceptionReviews: [] });
  }

  const authorized = authorizeProposalDecision({
    actorRole: "owner",
    actorUserId: OWNER,
    evaluation,
    action: declared.decision.action,
    approvedCapMinor: declared.decision.approvedCapMinor,
    authorizationExpiresOn: declared.decision.action === "DECLINE" ? undefined : declared.intendedOutcome.reviewOn,
    decidedAt: declared.decision.decidedAt,
    submittedByUserId: proposal.submittedByUserId,
    overrideReason: declared.decision.reason,
  });

  const decisionDto = {
    id: id(`00000000c3${row}`),
    evaluationId,
    proposalId,
    evaluationPolicyVersion: authorized.evaluationPolicyVersion,
    action: authorized.action,
    approvedCapMinor: authorized.approvedCapMinor,
    currency: authorized.currency,
    expectedAmountMinor: authorized.expectedAmountMinor,
    decidedByUserId: authorized.decidedByUserId,
    decidedByDisplayName: declared.decision.decidedBy,
    overrideReason: authorized.overrideReason,
    decidedAt: authorized.decidedAt,
    authorizationExpiresOn: authorized.authorizationExpiresOn,
  } satisfies NonNullable<CommitmentControlBriefDto["proposals"][number]["decision"]>;

  if (!declared.observed || authorized.action === "DECLINE") {
    return record(declared, { proposal, evaluation: evaluationDto, decision: decisionDto, reconciliations: [], outcomeObservations: [], exceptionReviews: [] });
  }

  const evidenceId = id(`00000000d4${row}`);
  const reconciled = reconcileAuthorizedProposal({
    decision: authorized,
    evidence: {
      evidenceId,
      amountMinor: declared.observed.minor,
      currency: declared.observed.currency,
      evidenceDate: declared.observed.observedAt.slice(0, 10),
    },
    intendedOutcome: declared.intendedOutcome,
  });

  return record(declared, {
    proposal,
    evaluation: evaluationDto,
    decision: decisionDto,
    reconciliations: [{
      id: id(`00000000e5${row}`),
      proposalId: reconciled.proposalId,
      decisionId: decisionDto.id,
      evidenceId: reconciled.evidenceId,
      verdict: reconciled.verdict,
      expectedAmountMinor: reconciled.expectedAmountMinor,
      approvedCapMinor: reconciled.approvedCapMinor,
      authorizationCurrency: reconciled.authorizationCurrency,
      observedAmountMinor: reconciled.observedAmountMinor,
      observedCurrency: reconciled.observedCurrency,
      observedEvidenceDate: reconciled.observedEvidenceDate,
      outcome: reconciled.outcome,
      reconciledByUserId: OWNER,
      reconciledAt: declared.observed.observedAt,
    }],
    outcomeObservations: [],
    exceptionReviews: [],
  });
}

function record(declared: DeclaredRecord, entry: CommitmentControlBriefDto["proposals"][number]): DeskRecord {
  return {
    key: declared.key,
    queueState: declared.queueState,
    nextAction: declared.nextAction,
    submittedByDisplayName: declared.submittedBy,
    citations: declared.citations,
    observed: declared.observed,
    entry,
  };
}

function submitterId(displayName: string): string {
  if (displayName.startsWith("Engineering")) return ENGINEERING;
  if (displayName.startsWith("Platform")) return PLATFORM;
  if (displayName.startsWith("Operations")) return OPERATIONS;
  return GROWTH;
}

/** Declared order, preserved. The desk never reshuffles between renders. */
export const syntheticDeskRecords: readonly DeskRecord[] = DECLARED.map(buildRecord);

export function syntheticDeskRecord(key: string): DeskRecord {
  const found = syntheticDeskRecords.find((entry) => entry.key === key);
  if (!found) throw new Error(`Unknown synthetic desk record: ${key}`);
  return found;
}

/** The record a cold reader lands on: the one that needs a decision today. */
export const syntheticDeskLeadKey = "model-api";

export function syntheticDeskBrief(
  capabilities: CommitmentControlBriefDto["capabilities"] = {
    canSubmitProposal: false,
    canDecide: false,
    canConfigurePolicy: false,
  },
): CommitmentControlBriefDto {
  return {
    policy: {
      ...syntheticDemoPolicy,
      createdByUserId: OWNER,
      createdAt: "2026-07-02T06:00:00.000Z",
    },
    proposals: syntheticDeskRecords.map((entry) => entry.entry),
    capabilities,
  };
}

/* ------------------------------------------------------------------ *
 * ADVERSARIAL VARIANTS — the states a demo never shows and a week always does.
 * ------------------------------------------------------------------ */

const VARIANT_PROPOSAL = id("00000000f001");

function variantDecision(action: ProposalDecisionAction, approvedCapMinor?: string) {
  const projected = projectProposalExposure(
    [{ proposalId: VARIANT_PROPOSAL, amountMinor: "22000000", currency: "INR", firstChargeDate: "2026-08-28", cadence: "ONE_TIME" }],
    { asOfDate: AS_OF },
  ).proposals[0];
  const evaluation = evaluateProposalPolicy({
    proposal: {
      proposalId: VARIANT_PROPOSAL,
      amountMinor: "22000000",
      currency: "INR",
      category: "SOFTWARE",
      thirteenWeekMinor: projected.thirteenWeekMinor,
      annualMinor: projected.annualMinor,
    },
    policy: syntheticDemoPolicy,
    existingExposure: [],
  });
  return authorizeProposalDecision({
    actorRole: "owner",
    actorUserId: OWNER,
    evaluation,
    action,
    approvedCapMinor,
    authorizationExpiresOn: action === "DECLINE" ? undefined : "2026-08-28",
    decidedAt: "2026-08-19T10:15:00.000Z",
    submittedByUserId: PLATFORM,
    overrideReason: "Retention only through the launch window.",
  });
}

/**
 * Every reconciliation verdict the engine can return, each produced by the
 * engine rather than named by hand. `MATCHED` and `OVER_CAP` already appear on
 * the desk; these cover the three a single week may not.
 */
export const syntheticDeskVerdictVariants = {
  /** Observed below a cap that sits below the request. */
  WITHIN_CAP: reconcileAuthorizedProposal({
    decision: variantDecision("APPROVE_WITH_CAP", "20000000"),
    evidence: { evidenceId: id("00000000f101"), amountMinor: "18000000", currency: "INR", evidenceDate: "2026-08-28" },
  }),
  /** The invoice arrived in another currency. Nothing is converted. */
  CURRENCY_MISMATCH: reconcileAuthorizedProposal({
    decision: variantDecision("APPROVE_WITH_CAP", "20000000"),
    evidence: { evidenceId: id("00000000f102"), amountMinor: "24000", currency: "USD", evidenceDate: "2026-08-28" },
  }),
  /** The amount could not be read off the document. Unknown, not zero. */
  CANNOT_EVALUATE: reconcileAuthorizedProposal({
    decision: variantDecision("APPROVE_WITH_CAP", "20000000"),
    evidence: { evidenceId: id("00000000f103"), amountMinor: null, currency: null, evidenceDate: "2026-08-28" },
  }),
} as const;

/**
 * A workspace that has not written a policy yet. The product still records the
 * request and still requires a human — it just has no rule to annotate with.
 */
export function syntheticDeskBriefWithoutPolicy(): CommitmentControlBriefDto {
  return { ...syntheticDeskBrief(), policy: null };
}

export function syntheticDeskEmptyBrief(): CommitmentControlBriefDto {
  return { policy: syntheticDeskBrief().policy, proposals: [], capabilities: syntheticDeskBrief().capabilities };
}

/**
 * A merchant name long enough to break a naive layout, plus an unknown amount.
 * Used to prove the queue truncates and the money renderer refuses to guess.
 */
export const syntheticDeskLongNameRecord = {
  merchant: "Long-name model inference and vector retrieval platform, APAC billing entity (placeholder)",
  purpose: "Combined inference and retrieval capacity across two regions for the launch window and the following review cycle",
  amountMinor: null,
  currency: null,
} as const;
