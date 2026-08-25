import {
  recoveryEndpoints,
  recoveryErrorCodes,
  type ApiFailure,
  type ApiSuccess,
  type CommitmentDetailDto,
  type CommitmentSummaryDto,
  type CommitmentContextDto,
  type CorrectionDto,
  type CreateCorrectionRequest,
  type DecisionDto,
  type EvidenceDto,
  type EvidenceIngestRequest,
  type EvidenceSubmissionDto,
  type GetCommitmentQuery,
  type HomeProjectionDto,
  type ListCommitmentsQuery,
  type LogoutResponse,
  type PrepareImportResponse,
  type PutCommitmentContextRequest,
  type PutDecisionRequest,
  type ReceiptInboxStatusDto,
  type RecoveryError,
  type RecoveryMutationHeaders,
  type RecoverySessionResponse,
  type WorkspaceVersionTag,
  type StandingMandateDto,
  type AutopilotCandidateDto,
  type AutopilotAttemptDto,
  type AutopilotDeadLetterDto,
  type WorkspaceActivationWrite,
  type RecoverySourceDisconnectionDto,
} from "@/lib/recovery/contracts";

// The only place the Recovery frontend talks to the server. It never derives a
// financial fact: it either returns the server payload verbatim or an honest
// failure that says the browser could not obtain one.

export type FailureOrigin = "SERVER" | "CLIENT";
export type ResponseMeta = ApiSuccess<unknown>["meta"];

export type TransportFailure = { ok: false; origin: FailureOrigin; error: RecoveryError };
export type TransportResult<T> = { ok: true; data: T; meta: ResponseMeta } | TransportFailure;
export type TransportPayload<T> = { ok: true; data: T } | TransportFailure;

export type MutationContext = { workspaceVersion: number; idempotencyKey: string };

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

// A failure raised inside the browser carries this reference instead of a server
// request id, so the UI can never present a device-side failure as server truth.
export const clientFailureReference = "client-device";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function clientFailure(message: string, retryable: boolean): TransportFailure {
  return { ok: false, origin: "CLIENT", error: { code: "UNKNOWN", message, retryable, requestId: clientFailureReference } };
}

function unexplainedHttpFailure(status: number): TransportFailure {
  if (status === 412) {
    return clientFailure("A change landed after this page loaded. Reload to see the saved truth before trying again.", false);
  }
  return clientFailure(
    "The workspace could not complete that action. Nothing was changed. Try again, or reload if this page is out of date.",
    status >= 500,
  );
}

function serverFailure(error: RecoveryError): TransportFailure {
  return { ok: false, origin: "SERVER", error };
}

export function readContractFailure(payload: unknown): RecoveryError | null {
  if (!isRecord(payload) || !isRecord(payload.error)) return null;
  const candidate = payload.error;
  const code = candidate.code;
  if (typeof code !== "string" || !(recoveryErrorCodes as readonly string[]).includes(code)) return null;
  if (typeof candidate.message !== "string" || typeof candidate.retryable !== "boolean" || typeof candidate.requestId !== "string") return null;
  if (code === "STALE_STATE" && typeof candidate.currentVersion !== "number") return null;
  if (code === "RATE_LIMITED" && typeof candidate.retryAfterSeconds !== "number") return null;
  return (payload as ApiFailure).error;
}

function readSuccess<T>(payload: unknown, accept?: (data: unknown) => data is T): { data: T; meta: ResponseMeta } | null {
  if (!isRecord(payload) || !("data" in payload) || !isRecord(payload.meta)) return null;
  const { requestId, workspaceVersion } = payload.meta;
  if (typeof requestId !== "string" || typeof workspaceVersion !== "number") return null;
  if (accept && !accept(payload.data)) return null;
  return { data: payload.data as T, meta: { requestId, workspaceVersion } };
}

// Some pre-Recovery routes still answer with a bare `{ error: "…" }`. The message
// is genuinely the server's, so it is shown, but the code stays UNKNOWN.
function readLegacyMessage(payload: unknown): string | null {
  return isRecord(payload) && typeof payload.error === "string" ? payload.error : null;
}

type RequestJsonResult = { failure: TransportFailure } | { payload: unknown };

async function requestJson(doFetch: FetchLike, path: string, init?: RequestInit): Promise<RequestJsonResult> {
  let response: Response;
  try {
    response = await doFetch(path, { cache: "no-store", ...init });
  } catch {
    return { failure: clientFailure("This device could not reach the workspace. Nothing was sent.", true) };
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { failure: unexplainedHttpFailure(response.status) };
  }
  const contractFailure = readContractFailure(payload);
  if (contractFailure) return { failure: serverFailure(contractFailure) };
  const legacyMessage = readLegacyMessage(payload);
  if (legacyMessage) return { failure: { ok: false, origin: "SERVER", error: { code: "UNKNOWN", message: legacyMessage, retryable: response.status >= 500, requestId: clientFailureReference } } };
  if (!response.ok) return { failure: unexplainedHttpFailure(response.status) };
  return { payload };
}

async function call<T>(
  doFetch: FetchLike,
  path: string,
  init?: RequestInit,
  accept?: (data: unknown) => data is T,
): Promise<TransportResult<T>> {
  const outcome = await requestJson(doFetch, path, init);
  if ("failure" in outcome) return outcome.failure;
  const success = readSuccess<T>(outcome.payload, accept);
  if (!success) return clientFailure("The workspace replied in a shape this app does not recognise. Nothing is assumed about your money.", false);
  return { ok: true, data: success.data, meta: success.meta };
}

async function callUnwrapped<T>(doFetch: FetchLike, path: string, accept: (payload: unknown) => payload is T, init?: RequestInit): Promise<TransportPayload<T>> {
  const outcome = await requestJson(doFetch, path, init);
  if ("failure" in outcome) return outcome.failure;
  if (!accept(outcome.payload)) return clientFailure("The workspace replied in a shape this app does not recognise.", false);
  return { ok: true, data: outcome.payload };
}

export function workspaceVersionTag(version: number): WorkspaceVersionTag {
  return `"workspace:${version}"`;
}

function mutationHeaders({ workspaceVersion, idempotencyKey }: MutationContext): RecoveryMutationHeaders {
  return {
    "Content-Type": "application/json",
    "Idempotency-Key": idempotencyKey,
    "If-Match": workspaceVersionTag(workspaceVersion),
  };
}

function withQuery(path: string, query: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized ? `${path}?${serialized}` : path;
}

const isSessionResponse = (payload: unknown): payload is RecoverySessionResponse =>
  isRecord(payload) && typeof payload.authenticated === "boolean";

const isLogoutResponse = (payload: unknown): payload is LogoutResponse =>
  isRecord(payload) && (payload.status === "signed-out" || payload.status === "revocation-pending");

const isPrepareImportResponse = (payload: unknown): payload is PrepareImportResponse =>
  isRecord(payload) && Array.isArray(payload.sources);

export function createRecoveryTransport(fetchImpl?: FetchLike) {
  const doFetch: FetchLike = fetchImpl ?? ((input, init) => fetch(input, init));

  return {
    session: () => callUnwrapped(doFetch, recoveryEndpoints.session.path, isSessionResponse),

    logout: () => callUnwrapped(doFetch, recoveryEndpoints.logout.path, isLogoutResponse, { method: recoveryEndpoints.logout.method }),

    home: () => call<HomeProjectionDto>(doFetch, recoveryEndpoints.home.path),

    recordWorkspaceActivation: () =>
      call<WorkspaceActivationWrite>(doFetch, recoveryEndpoints.recordWorkspaceActivation.path, {
        method: recoveryEndpoints.recordWorkspaceActivation.method,
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),

    evidence: (evidenceId: string) =>
      call<EvidenceDto>(doFetch, recoveryEndpoints.evidence(evidenceId).path),

    commitments: (query: ListCommitmentsQuery = {}) =>
      call<{ items: readonly CommitmentSummaryDto[]; total: number; nextCursor: string | null }>(
        doFetch,
        withQuery(recoveryEndpoints.commitments.path, { limit: query.limit, cursor: query.cursor }),
      ),

    commitment: (commitmentId: string, query: GetCommitmentQuery = {}) =>
      call<CommitmentDetailDto>(
        doFetch,
        withQuery(recoveryEndpoints.commitment(commitmentId).path, { evidenceLimit: query.evidenceLimit, evidenceCursor: query.evidenceCursor }),
      ),

    sources: () => call<ReceiptInboxStatusDto>(doFetch, recoveryEndpoints.sources.path),

    provisionReceiptInbox: () =>
      call<ReceiptInboxStatusDto>(doFetch, recoveryEndpoints.receiptInbox.path, {
        method: recoveryEndpoints.receiptInbox.method,
      }),

    rotateReceiptInbox: (aliasId: string, idempotencyKey: string) =>
      call<ReceiptInboxStatusDto>(doFetch, recoveryEndpoints.rotateReceiptInbox.path, {
        method: recoveryEndpoints.rotateReceiptInbox.method,
        headers: { "Idempotency-Key": idempotencyKey, "If-Match": `"${aliasId}"` },
      }),

    revokeReceiptInbox: () =>
      call<ReceiptInboxStatusDto>(doFetch, recoveryEndpoints.revokeReceiptInbox.path, {
        method: recoveryEndpoints.revokeReceiptInbox.method,
      }),

    submitEvidence: (request: EvidenceIngestRequest, context: MutationContext) =>
      call<{ submission: EvidenceSubmissionDto; home: HomeProjectionDto; commitments: readonly CommitmentSummaryDto[]; commitmentTotal: number }>(
        doFetch,
        recoveryEndpoints.submitEvidence.path,
        { method: recoveryEndpoints.submitEvidence.method, headers: mutationHeaders(context), body: JSON.stringify(request) },
      ),

    putDecision: (request: PutDecisionRequest, context: MutationContext) =>
      call<{ decision: DecisionDto; commitment: CommitmentSummaryDto; home: HomeProjectionDto }>(
        doFetch,
        recoveryEndpoints.decision.path,
        { method: recoveryEndpoints.decision.method, headers: mutationHeaders(context), body: JSON.stringify(request) },
      ),

    putCommitmentContext: (commitmentId: string, request: PutCommitmentContextRequest, context: MutationContext) =>
      call<{ context: CommitmentContextDto; commitment: CommitmentDetailDto; home: HomeProjectionDto }>(
        doFetch,
        recoveryEndpoints.commitmentContext(commitmentId).path,
        { method: recoveryEndpoints.commitmentContext(commitmentId).method, headers: mutationHeaders(context), body: JSON.stringify(request) },
      ),

    createCorrection: (commitmentId: string, request: CreateCorrectionRequest, context: MutationContext) =>
      call<{ correction: CorrectionDto; commitment: CommitmentDetailDto; home: HomeProjectionDto }>(
        doFetch,
        recoveryEndpoints.createCorrection(commitmentId).path,
        { method: recoveryEndpoints.createCorrection(commitmentId).method, headers: mutationHeaders(context), body: JSON.stringify(request) },
      ),

    reverseCorrection: (commitmentId: string, correctionId: string, context: MutationContext) =>
      call<{ correction: CorrectionDto; commitment: CommitmentDetailDto; home: HomeProjectionDto }>(
        doFetch,
        recoveryEndpoints.reverseCorrection(commitmentId, correctionId).path,
        { method: recoveryEndpoints.reverseCorrection(commitmentId, correctionId).method, headers: mutationHeaders(context) },
      ),

    standingMandate: () => call<StandingMandateDto | null>(doFetch, recoveryEndpoints.standingMandate.path),

    signStandingMandate: (context: MutationContext) =>
      call<StandingMandateDto>(doFetch, recoveryEndpoints.signStandingMandate.path, {
        method: recoveryEndpoints.signStandingMandate.method,
        headers: mutationHeaders(context),
        body: JSON.stringify({ accepted: true }),
      }),

    revokeStandingMandate: (context: MutationContext) =>
      call<StandingMandateDto>(doFetch, recoveryEndpoints.revokeStandingMandate.path, {
        method: recoveryEndpoints.revokeStandingMandate.method,
        headers: mutationHeaders(context),
      }),

    autopilotCandidates: () =>
      call<{ items: readonly AutopilotCandidateDto[] }>(doFetch, recoveryEndpoints.autopilotCandidates.path),

    vetoAutopilotCandidate: (candidateId: string, context: MutationContext) =>
      call<AutopilotCandidateDto>(doFetch, recoveryEndpoints.vetoAutopilotCandidate(candidateId).path, {
        method: recoveryEndpoints.vetoAutopilotCandidate(candidateId).method,
        headers: mutationHeaders(context),
      }),

    autopilotAttempts: (candidateId: string) =>
      call<{ items: readonly AutopilotAttemptDto[] }>(doFetch, recoveryEndpoints.autopilotAttempts(candidateId).path),

    disableAutopilotProvider: (providerId: string, reason: string, context: MutationContext) =>
      call<{ providerId: string; disabled: true }>(doFetch, recoveryEndpoints.disableAutopilotProvider(providerId).path, {
        method: recoveryEndpoints.disableAutopilotProvider(providerId).method,
        headers: mutationHeaders(context),
        body: JSON.stringify({ reason }),
      }),

    disconnectRecoverySource: (sourceId: string, context: MutationContext) =>
      call<RecoverySourceDisconnectionDto>(doFetch, recoveryEndpoints.disconnectRecoverySource(sourceId).path, {
        method: recoveryEndpoints.disconnectRecoverySource(sourceId).method,
        headers: mutationHeaders(context),
      }),

    reconnectRecoverySource: (sourceId: string, context: MutationContext) =>
      call<RecoverySourceDisconnectionDto>(doFetch, recoveryEndpoints.reconnectRecoverySource(sourceId).path, {
        method: recoveryEndpoints.reconnectRecoverySource(sourceId).method,
        headers: mutationHeaders(context),
      }),

    autopilotDeadLetters: () =>
      call<{ items: readonly AutopilotDeadLetterDto[] }>(doFetch, recoveryEndpoints.autopilotDeadLetters.path),

    replayAutopilotDeadLetter: (deadLetterId: string, context: MutationContext) =>
      call<{ id: string; replayed: boolean; reason?: string }>(doFetch, recoveryEndpoints.replayAutopilotDeadLetter(deadLetterId).path, {
        method: recoveryEndpoints.replayAutopilotDeadLetter(deadLetterId).method,
        headers: mutationHeaders(context),
      }),

    prepareImport: (files: readonly File[]) => {
      const body = new FormData();
      body.append("mode", "recovery-v1");
      for (const file of files) body.append("files", file);
      return callUnwrapped(doFetch, recoveryEndpoints.prepareImport.path, isPrepareImportResponse, {
        method: recoveryEndpoints.prepareImport.method,
        body,
      });
    },
  };
}

export type RecoveryTransport = ReturnType<typeof createRecoveryTransport>;

// Shared with the Commitment Control transport so both speak one envelope, one
// failure vocabulary, and one set of mutation preconditions.
export { call as callWorkspaceApi, mutationHeaders as workspaceMutationHeaders };
