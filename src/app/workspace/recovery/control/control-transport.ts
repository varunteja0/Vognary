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
import type { ControlProviderBillCandidateQuery, ControlProviderBillCandidatesDto } from "@/lib/commitment-control/provider-bill-contracts";
import { isProviderBillCandidatePage, isProviderBillSourceState, providerBillResultMatches, type ProviderBillAttempt } from "./control-provider-bill-state";

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

export function createControlTransport(fetchImpl?: FetchLike, workspaceId?: string) {
  const doFetch: FetchLike = fetchImpl ?? ((input, init) => fetch(input, init));
  const mutationHeaders = (context: MutationContext) => workspaceMutationHeaders({ ...context, workspaceId: context.workspaceId ?? workspaceId });

  return {
    brief: () => callWorkspaceApi<CommitmentControlBriefDto>(
      doFetch,
      commitmentControlEndpoints.brief.path,
      undefined,
      (value): value is CommitmentControlBriefDto => isCommitmentControlBriefDto(value)
        && value.proposals.every(entry => entry.reconciliations.every(item => item.providerBillSource === undefined || isProviderBillSourceState(item.providerBillSource))),
    ),

    putPolicy: (request: PutControlPolicyRequest, context: MutationContext) =>
      callWorkspaceApi<ControlPolicyWriteDto>(doFetch, commitmentControlEndpoints.putPolicy.path, {
        method: commitmentControlEndpoints.putPolicy.method,
        headers: mutationHeaders(context),
        body: JSON.stringify(request),
      }, isControlPolicyWriteDto),

    createProposal: (request: CreateControlProposalRequest, context: MutationContext) =>
      callWorkspaceApi<ControlProposalWriteDto>(doFetch, commitmentControlEndpoints.proposals.path, {
        method: commitmentControlEndpoints.proposals.method,
        headers: mutationHeaders(context),
        body: JSON.stringify(request),
      }, (value): value is ControlProposalWriteDto => isControlProposalWriteDto(value)
        && (value.proposal.amountBasis ?? null) === (request.amountBasis ?? null)
        && (value.evaluation.amountBasis ?? null) === (request.amountBasis ?? null)),

    decideProposal: (proposalId: string, request: DecideControlProposalRequest, context: MutationContext) =>
      callWorkspaceApi<ControlDecisionWriteDto>(doFetch, commitmentControlEndpoints.decision(proposalId).path, {
        method: commitmentControlEndpoints.decision(proposalId).method,
        headers: mutationHeaders(context),
        body: JSON.stringify(request),
      }, isControlDecisionWriteDto),

    recordOutcome: (proposalId: string, request: RecordControlOutcomeObservationRequest, context: MutationContext) =>
      callWorkspaceApi<ControlOutcomeObservationWriteDto>(doFetch, commitmentControlEndpoints.outcome(proposalId).path, {
        method: commitmentControlEndpoints.outcome(proposalId).method,
        headers: mutationHeaders(context),
        body: JSON.stringify(request),
      }, isControlOutcomeObservationWriteDto),

    reviewException: (proposalId: string, request: RecordControlExceptionReviewRequest, context: MutationContext) =>
      callWorkspaceApi<ControlExceptionReviewWriteDto>(doFetch, commitmentControlEndpoints.exceptionReviews(proposalId).path, {
        method: commitmentControlEndpoints.exceptionReviews(proposalId).method,
        headers: mutationHeaders(context),
        body: JSON.stringify(request),
      }, isControlExceptionReviewWriteDto),

    reconciliationCandidates: (proposalId: string) =>
      callWorkspaceApi<ControlReconciliationCandidatesDto>(
        doFetch,
        commitmentControlEndpoints.reconciliationCandidates(proposalId).path,
        undefined,
        isControlReconciliationCandidatesDto,
      ),

    providerBillCandidates: (proposalId: string, query: ControlProviderBillCandidateQuery = {}) => {
      const params = new URLSearchParams({ source: "ZOHO_BOOKS" });
      for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
      return callWorkspaceApi<ControlProviderBillCandidatesDto>(doFetch,
        `${commitmentControlEndpoints.reconciliationCandidates(proposalId).path}?${params}`,
        { headers: workspaceId ? { "X-Vognary-Workspace": workspaceId } : {} },
        (value): value is ControlProviderBillCandidatesDto => isProviderBillCandidatePage(value) && value.proposalId === proposalId);
    },

    providerBillIdentity: async (): Promise<{ workspaceId: string; actorId: string } | null> => {
      try {
        const response = await doFetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" });
        const payload = await response.json();
        return response.ok && payload.authenticated === true && typeof payload.session?.workspaceId === "string" && typeof payload.session?.userId === "string"
          ? { workspaceId: payload.session.workspaceId, actorId: payload.session.userId } : null;
      } catch { return null; }
    },

    reconcileProviderBill: async (attempt: ProviderBillAttempt) => {
      try {
        const response = await doFetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" });
        const payload = await response.json();
        if (!response.ok || payload.authenticated !== true || payload.session?.workspaceId !== attempt.workspaceId || payload.session?.userId !== attempt.actorId) throw new Error("identity");
      } catch {
        return { ok: false, origin: "CLIENT", outcome: "NOT_ATTEMPTED", error: { code: "UNKNOWN", message: "Sign in to the original account and workspace to check this comparison. No request was sent.", retryable: true, requestId: "client-device" } } as const;
      }
      return callWorkspaceApi<ControlReconciliationWriteDto>(doFetch, commitmentControlEndpoints.reconciliations(attempt.proposalId).path, {
        method: "POST", headers: mutationHeaders(attempt), body: JSON.stringify(attempt.request),
      }, (value): value is ControlReconciliationWriteDto => isControlReconciliationWriteDto(value) && providerBillResultMatches(value, attempt));
    },

    reconcileProposal: (proposalId: string, request: ReconcileControlProposalRequest, context: MutationContext) =>
      callWorkspaceApi<ControlReconciliationWriteDto>(
        doFetch,
        commitmentControlEndpoints.reconciliations(proposalId).path,
        {
          method: commitmentControlEndpoints.reconciliations(proposalId).method,
          headers: mutationHeaders(context),
          body: JSON.stringify(request),
        },
        isControlReconciliationWriteDto,
      ),
  };
}

export type ControlTransport = ReturnType<typeof createControlTransport>;
