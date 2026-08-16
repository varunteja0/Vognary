import { createHash } from "node:crypto";

export type ExecutionIdempotencyInput = {
  workspaceId: string;
  candidateId: string;
  actorUserId: string;
  outcome: "EXECUTED" | "EXCEPTION" | "FAILED";
  providerId: string;
  minutes?: number;
  proofKind?: string | null;
  proofReference?: string | null;
  failureReason?: string | null;
};

export type ExecutionReplayDecision = "REPLAY" | "CONFLICT";

export function bindExecutionIdempotency(input: ExecutionIdempotencyInput) {
  return {
    requestHash: createHash("sha256").update(stableExecutionPayload(input)).digest("hex"),
    workspaceId: input.workspaceId,
    candidateId: input.candidateId,
    actorUserId: input.actorUserId,
    outcome: input.outcome,
    providerId: input.providerId,
  };
}

export function resolveExecutionReplay(storedHash: string, incomingHash: string): ExecutionReplayDecision {
  return storedHash === incomingHash ? "REPLAY" : "CONFLICT";
}

export function executionOperationKey(input: { candidateId: string; attemptNo: number }) {
  return `autopilot-execute:${input.candidateId}:${input.attemptNo}`;
}

function stableExecutionPayload(input: ExecutionIdempotencyInput) {
  return JSON.stringify({
    workspaceId: input.workspaceId,
    candidateId: input.candidateId,
    actorUserId: input.actorUserId,
    outcome: input.outcome,
    providerId: input.providerId,
    minutes: input.minutes ?? null,
    proofKind: input.proofKind ?? null,
    proofReference: input.proofReference ?? null,
    failureReason: input.failureReason ?? null,
  });
}
