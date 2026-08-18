import {
  createRecoveryRequestId,
  RecoveryServiceError,
  recoveryFailureResponse,
  recoverySuccessResponse,
} from "@/lib/server/recovery-api";
import { readRecoveryJson, runRecoveryRoute } from "@/lib/server/recovery-route";
import {
  acknowledgeChangeSignal,
  answerDuplicateSuspicion,
  readCommitmentGraph,
  refreshCommitmentGraph,
} from "@/lib/server/recovery-graph-store";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Reading Attention recomputes the graph first, so what is shown is never stale. */
export async function GET(request: Request) {
  return runRecoveryRoute(request, {
    namespace: "recovery-attention-read",
    limit: 120,
    windowMs: 60_000,
  }, async ({ requestId, session }) => {
    const refresh = await refreshCommitmentGraph({
      workspaceId: session.workspaceId,
      actorUserId: session.userId,
    });
    const view = await readCommitmentGraph({
      workspaceId: session.workspaceId,
      actorUserId: session.userId,
      evaluatedOn: refresh.evaluatedOn,
    });
    return recoverySuccessResponse(serializeGraph(view), requestId, 0);
  });
}

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return recoveryFailureResponse(new RecoveryServiceError("FORBIDDEN"), createRecoveryRequestId());
  return runRecoveryRoute(request, {
    namespace: "recovery-attention-write",
    limit: 120,
    windowMs: 60 * 60_000,
  }, async ({ requestId, session }) => {
    const body = await readRecoveryJson(request);
    const action = normalizeAction(body);
    if (action.kind === "ACKNOWLEDGE") {
      await acknowledgeChangeSignal({
        workspaceId: session.workspaceId,
        actorUserId: session.userId,
        dedupeKey: action.id,
      });
    } else {
      await answerDuplicateSuspicion({
        workspaceId: session.workspaceId,
        actorUserId: session.userId,
        commitmentId: action.commitmentId,
        otherCommitmentId: action.otherCommitmentId,
        sameSubscription: action.sameSubscription,
      });
    }
    const refresh = await refreshCommitmentGraph({
      workspaceId: session.workspaceId,
      actorUserId: session.userId,
    });
    const view = await readCommitmentGraph({
      workspaceId: session.workspaceId,
      actorUserId: session.userId,
      evaluatedOn: refresh.evaluatedOn,
    });
    return recoverySuccessResponse(serializeGraph(view), requestId, 0);
  });
}

type AttentionAction =
  | { kind: "ACKNOWLEDGE"; id: string }
  | { kind: "ANSWER_DUPLICATE"; commitmentId: string; otherCommitmentId: string; sameSubscription: boolean };

function normalizeAction(body: unknown): AttentionAction {
  if (!body || typeof body !== "object") throw new RecoveryServiceError("INVALID_EVIDENCE");
  const record = body as Record<string, unknown>;
  if (record.action === "ACKNOWLEDGE" && typeof record.id === "string" && record.id.trim()) {
    return { kind: "ACKNOWLEDGE", id: record.id.trim() };
  }
  if (
    record.action === "ANSWER_DUPLICATE"
    && typeof record.commitmentId === "string" && record.commitmentId.trim()
    && typeof record.otherCommitmentId === "string" && record.otherCommitmentId.trim()
    && typeof record.sameSubscription === "boolean"
  ) {
    return {
      kind: "ANSWER_DUPLICATE",
      commitmentId: record.commitmentId.trim(),
      otherCommitmentId: record.otherCommitmentId.trim(),
      sameSubscription: record.sameSubscription,
    };
  }
  throw new RecoveryServiceError("INVALID_EVIDENCE");
}

/** Minor units cross the wire as strings; nothing here exposes internal scoring. */
function serializeGraph(view: Awaited<ReturnType<typeof readCommitmentGraph>>) {
  return {
    attention: view.attention.map((card) => ({
      id: card.id,
      commitmentId: card.commitmentId,
      otherCommitmentId: card.otherCommitmentId,
      headline: card.headline,
      body: card.body,
      urgency: card.urgency,
      nextStep: card.nextStep,
      dueDate: card.dueDate,
      currency: card.currency,
      amountMinor: card.amountMinor?.toString() ?? null,
      deltaMinor: card.deltaMinor?.toString() ?? null,
    })),
    coverage: {
      state: view.coverage.state,
      coverageBroken: view.coverage.coverageBroken,
      sourceCount: view.coverage.sourceCount,
      automaticSourceCount: view.coverage.automaticSourceCount,
      limitations: view.coverage.limitations,
    },
    sources: view.sources.map((source) => ({
      id: source.sourceId,
      label: source.label,
      state: source.state,
      automatic: source.automatic,
      lastEvidenceAt: source.lastEvidenceAt,
      coverageStart: source.coverageStart,
      coverageEnd: source.coverageEnd,
    })),
    commitments: view.commitments,
  };
}
