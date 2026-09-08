import type { ControlEvaluationDto, ControlReconciliationWriteDto } from "../../../src/lib/commitment-control/contracts";
import type { ControlProviderBillCandidatesDto, ReconcileControlProviderBillRequest } from "../../../src/lib/commitment-control/provider-bill-contracts";

export const a2Ids = {
  workspace: "a8d5e3e7-ef0c-4fe3-9de2-ab9fec0fabf2",
  actor: "2726494a-2b22-46bc-b9a5-adfb8c6d0842",
  proposal: "cbed2542-b2cd-4c27-a97e-38ba50547960",
  decision: "2dfefdc8-2bea-41cd-b995-f9894c47a0df",
  connection: "031aafca-221f-46ec-8d8d-528d71186e64",
  consent: "6b41355a-5d4c-4daf-9dcc-a1c9f7545b44",
  evidence: "5b12bb24-f24e-4450-a14a-4756e032d6af",
  comparison: "16d80a09-9e30-492f-8993-2dc4a5ec9306",
};

export const a2CandidatePage: ControlProviderBillCandidatesDto = {
  source: "ZOHO_BOOKS", proposalId: a2Ids.proposal, matchingPerformed: false,
  connectionId: a2Ids.connection, organizationId: "100001", expectedSourceVersion: "3",
  canManage: true, canConfirm: true, capabilityReasons: [],
  freshness: { status: "FRESH", maximumAgeSeconds: 86400, lastCompletedSyncAt: "2026-09-07T13:48:34.755Z", nextScheduledAt: "2026-09-08T13:48:34.755Z", checkedAt: "2026-09-07T13:48:34.812Z" },
  retentionNotice: "control-provider-bill-retention-v1", retainedAdmissionCount: 0,
  candidates: [{
    source: "ZOHO_BOOKS", connectionId: a2Ids.connection, organizationId: "100001", billId: "200001",
    sourceSequence: "135", sourceVersion: 1, sourceFingerprint: "3165396691905dc1fb1f50668b87a4af8b51ff9755813c7ac94b58908d8806fc",
    sourceObservedAt: "2026-09-07T13:48:34.755Z", providerModifiedAt: "2026-09-07T13:48:34.755Z",
    billDate: "2026-09-07", billStatus: "open", changeKind: "BASELINE", vendorName: "Synthetic A2 supplier",
    billNumber: "SYNTHETIC-A2", totalMinor: "12345", currency: "INR", evidenceBasis: "PROVIDER_BILL_TOTAL",
    consentReference: a2Ids.consent, consentGeneration: "1", consentScopes: ["ZohoBooks.settings.READ", "ZohoBooks.bills.READ"],
    consentAuthorizedByUserId: a2Ids.actor, consentAuthorizedAt: "2026-09-07T13:48:34.755Z", consentNoticeVersion: "zoho-books-read-v1",
    region: "IN", expectedSourceVersion: "3", expectedLatestSequence: "135", canSelect: true,
    selectionReasons: [], alreadyCompared: false, prospectiveVerdict: "MATCHED",
    billReviewPath: "/app?view=BILL_REVIEW&bill=200001",
  }],
  total: 1, nextCursor: null, throughSequence: "135", throughEventSequence: "0",
  query: { search: "", sort: "UPDATED", currency: null },
};

export const a2ComparisonRequest: ReconcileControlProviderBillRequest = {
  source: "ZOHO_BOOKS", connectionId: a2Ids.connection, organizationId: "100001", billId: "200001",
  sourceSequence: "135", expectedLatestSequence: "135", expectedSourceVersion: "3",
  wholeCharge: "USER_CONFIRMED_SAME_CHARGE", retentionNotice: "control-provider-bill-retention-v1",
};

const intendedOutcome = { metric: "Synthetic completed tasks", targetDirection: "AT_LEAST" as const, targetValue: "10", unit: "tasks", reviewOn: "2026-09-17" };

export const a2ComparisonResponse: ControlReconciliationWriteDto = {
  proposal: {
    id: a2Ids.proposal, submittedByUserId: a2Ids.actor, submittedByDisplayName: "Synthetic finance owner",
    merchant: "Synthetic A2 supplier", purpose: "Synthetic single authorized charge", category: "SOFTWARE",
    amountMinor: "12345", amountBasis: "GROSS_BILLED_TOTAL_PER_CHARGE", currency: "INR",
    firstChargeDate: "2026-09-07", cadence: "ONE_TIME", asOfDate: "2026-09-07",
    projectedThirteenWeekMinor: "12345", projectedAnnualMinor: "12345", intendedOutcome,
    assumptionBasis: "USER_ENTERED_ASSUMPTION", createdAt: "2026-09-07T13:48:34.730Z",
  },
  decision: {
    id: a2Ids.decision, evaluationId: "79e2a394-da04-4647-a47f-5a7e83aa405e", proposalId: a2Ids.proposal,
    evaluationPolicyVersion: 1, action: "APPROVE", approvedCapMinor: "12345", expectedAmountMinor: "12345",
    currency: "INR", amountBasis: "GROSS_BILLED_TOTAL_PER_CHARGE", decidedByUserId: a2Ids.actor,
    decidedByDisplayName: "Synthetic finance owner", overrideReason: null, decidedAt: "2026-09-07T13:48:34.746Z",
    authorizationExpiresOn: "2026-09-17",
  },
  reconciliation: {
    id: a2Ids.comparison, proposalId: a2Ids.proposal, decisionId: a2Ids.decision, evidenceId: a2Ids.evidence,
    verdict: "MATCHED", expectedAmountMinor: "12345", approvedCapMinor: "12345", authorizationCurrency: "INR",
    observedAmountMinor: "12345", observedCurrency: "INR", observedEvidenceDate: "2026-09-07",
    outcome: { ...intendedOutcome, observedValue: null, observedOn: null, observationBasis: "NOT_OBSERVED", verdict: "NOT_OBSERVED" },
    reconciledByUserId: a2Ids.actor, reconciledAt: "2026-09-07T13:48:34.844Z",
    comparisonKind: "BILLED_AMOUNT_COMPARISON", decisionAmountBasis: "GROSS_BILLED_TOTAL_PER_CHARGE", observedEvidenceBasis: "PROVIDER_BILL_TOTAL",
    providerBill: {
      source: "ZOHO_BOOKS", workspaceId: a2Ids.workspace, evidenceId: a2Ids.evidence, connectionId: a2Ids.connection,
      organizationId: "100001", billId: "200001", sourceSequence: "135", sourceVersion: 1,
      sourceFingerprint: a2CandidatePage.candidates[0].sourceFingerprint, sourceObservedAt: "2026-09-07T13:48:34.755Z",
      providerModifiedAt: "2026-09-07T13:48:34.755Z", billDate: "2026-09-07", billStatus: "open", changeKind: "BASELINE",
      totalMinor: "12345", currency: "INR", sourceTotal: "123.45", vendorName: "Synthetic A2 supplier", billNumber: "SYNTHETIC-A2",
      consentReference: a2Ids.consent, consentGeneration: "1", consentNoticeVersion: "zoho-books-read-v1",
      consentScopes: ["ZohoBooks.settings.READ", "ZohoBooks.bills.READ"], consentAuthorizedByUserId: a2Ids.actor,
      consentAuthorizedAt: "2026-09-07T13:48:34.755Z", region: "IN", connectionRevision: "3", lastSuccessfulSyncAt: "2026-09-07T13:48:34.755Z",
      selectedByUserId: a2Ids.actor, selectedAt: "2026-09-07T13:48:34.844Z", relationBasis: "USER_CONFIRMED_SAME_CHARGE",
      retentionNotice: "control-provider-bill-retention-v1",
    },
  },
};

export const a2Attempt = {
  version: 1 as const, workspaceId: a2Ids.workspace, actorId: a2Ids.actor, proposalId: a2Ids.proposal,
  decisionId: a2Ids.decision, workspaceVersion: 3, idempotencyKey: "32a1ff54-a030-4e8c-a44c-908c59a3875d",
  request: a2ComparisonRequest, snapshot: a2CandidatePage.candidates[0],
};

export const a2Evaluation: ControlEvaluationDto = {
  id: "79e2a394-da04-4647-a47f-5a7e83aa405e", proposalId: a2Ids.proposal, amountBasis: "GROSS_BILLED_TOTAL_PER_CHARGE",
  policyVersion: 1, status: "WITHIN_POLICY", humanDecisionRequired: true,
  assumptionFields: ["amountMinor", "currency", "category", "thirteenWeekMinor", "annualMinor"],
  reasonCodes: [], citedExposureBasis: "NONE", citedEvidenceIds: [], evaluatedAt: "2026-09-07T13:48:34.730Z",
  currencyResults: [{ currency: "INR", existingThirteenWeekMinor: "0", proposedThirteenWeekMinor: "12345", combinedThirteenWeekMinor: "12345", thirteenWeekHeadroomMinor: "2987655", existingAnnualMinor: "0", proposedAnnualMinor: "12345", combinedAnnualMinor: "12345", annualHeadroomMinor: "11987655" }],
};

