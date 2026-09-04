import {
  commitmentControlEndpoints,
  isCommitmentControlBriefDto,
  isControlExceptionReviewWriteDto,
  isControlDecisionWriteDto,
  isControlOutcomeObservationWriteDto,
  isControlPolicyWriteDto,
  isControlProposalWriteDto,
  isControlReconciliationWriteDto,
  type CommitmentControlBriefDto,
  type ControlExceptionReviewWriteDto,
  type ControlDecisionWriteDto,
  type ControlPolicyWriteDto,
  type ControlOutcomeObservationWriteDto,
  type ControlProposalWriteDto,
  type ControlReconciliationWriteDto,
  type CreateControlProposalRequest,
  type DecideControlProposalRequest,
  type RecordControlExceptionReviewRequest,
  type RecordControlOutcomeObservationRequest,
  type PutControlPolicyRequest,
  type ReconcileControlProposalRequest,
} from "@/lib/commitment-control/contracts";
import {
  isControlReconciliationCandidatesDto,
  type ControlReconciliationCandidatesDto,
} from "@/lib/commitment-control/reconciliation-candidates";
import {
  callWorkspaceApi,
  workspaceMutationHeaders,
  type FetchLike,
  type MutationContext,
  type TransportFailure,
} from "../transport";

// The only place the Commitment Control frontend talks to the server. It never
// derives a financial fact: it returns the server payload verbatim or an honest
// failure. Nothing here is cached, persisted, or logged — proposal contents,
// money, purpose, evidence, and response bodies never leave this call.

/**
 * A workspace that is not enrolled in the private pilot answers 503 with this
 * exact code. Every other 503 (an unreachable database, for instance) stays a
 * retryable failure, so an outage is never mistaken for "you do not have this".
 */
export function isFeatureUnavailable(failure: TransportFailure): boolean {
  return failure.origin === "SERVER" && failure.error.code === "FEATURE_UNAVAILABLE";
}

export function isStaleWorkspace(failure: TransportFailure): boolean {
  return failure.error.code === "STALE_STATE";
}

export function createControlTransport(fetchImpl?: FetchLike) {
  const doFetch: FetchLike = fetchImpl ?? ((input, init) => fetch(input, init));

  return {
    brief: () => callWorkspaceApi<CommitmentControlBriefDto>(
      doFetch,
      commitmentControlEndpoints.brief.path,
      undefined,
      isCommitmentControlBriefDto,
    ),

    putPolicy: (request: PutControlPolicyRequest, context: MutationContext) =>
      callWorkspaceApi<ControlPolicyWriteDto>(doFetch, commitmentControlEndpoints.putPolicy.path, {
        method: commitmentControlEndpoints.putPolicy.method,
        headers: workspaceMutationHeaders(context),
        body: JSON.stringify(request),
      }, isControlPolicyWriteDto),

    createProposal: (request: CreateControlProposalRequest, context: MutationContext) =>
      callWorkspaceApi<ControlProposalWriteDto>(doFetch, commitmentControlEndpoints.proposals.path, {
        method: commitmentControlEndpoints.proposals.method,
        headers: workspaceMutationHeaders(context),
        body: JSON.stringify(request),
      }, isControlProposalWriteDto),

    decideProposal: (proposalId: string, request: DecideControlProposalRequest, context: MutationContext) =>
      callWorkspaceApi<ControlDecisionWriteDto>(doFetch, commitmentControlEndpoints.decision(proposalId).path, {
        method: commitmentControlEndpoints.decision(proposalId).method,
        headers: workspaceMutationHeaders(context),
        body: JSON.stringify(request),
      }, isControlDecisionWriteDto),

    recordOutcome: (proposalId: string, request: RecordControlOutcomeObservationRequest, context: MutationContext) =>
      callWorkspaceApi<ControlOutcomeObservationWriteDto>(doFetch, commitmentControlEndpoints.outcome(proposalId).path, {
        method: commitmentControlEndpoints.outcome(proposalId).method,
        headers: workspaceMutationHeaders(context),
        body: JSON.stringify(request),
      }, isControlOutcomeObservationWriteDto),

    reviewException: (proposalId: string, request: RecordControlExceptionReviewRequest, context: MutationContext) =>
      callWorkspaceApi<ControlExceptionReviewWriteDto>(doFetch, commitmentControlEndpoints.exceptionReviews(proposalId).path, {
        method: commitmentControlEndpoints.exceptionReviews(proposalId).method,
        headers: workspaceMutationHeaders(context),
        body: JSON.stringify(request),
      }, isControlExceptionReviewWriteDto),

    reconciliationCandidates: (proposalId: string) =>
      callWorkspaceApi<ControlReconciliationCandidatesDto>(
        doFetch,
        commitmentControlEndpoints.reconciliationCandidates(proposalId).path,
        undefined,
        isControlReconciliationCandidatesDto,
      ),

    reconcileProposal: (proposalId: string, request: ReconcileControlProposalRequest, context: MutationContext) =>
      callWorkspaceApi<ControlReconciliationWriteDto>(
        doFetch,
        commitmentControlEndpoints.reconciliations(proposalId).path,
        {
          method: commitmentControlEndpoints.reconciliations(proposalId).method,
          headers: workspaceMutationHeaders(context),
          body: JSON.stringify(request),
        },
        isControlReconciliationWriteDto,
      ),
  };
}

export type ControlTransport = ReturnType<typeof createControlTransport>;
