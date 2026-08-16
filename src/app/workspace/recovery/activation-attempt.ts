"use client";

import type { TransportResult } from "./transport";
import type { WorkspaceActivationOutcome, WorkspaceActivationWrite } from "@/lib/recovery/workspace-activation";

export const workspaceActivationRetryDelaysMs = [0, 250, 750] as const;
export const workspaceActivationSettledStorageKeyPrefix = "vognary.workspace-activation.settled:";

export type WorkspaceActivationAttempt = WorkspaceActivationOutcome;

export type WorkspaceActivationStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export function isRetryableWorkspaceActivationFailure(
  result: TransportResult<unknown>,
) {
  if (result.ok) return false;
  return result.error.retryable;
}

function asWorkspaceActivationWrite(value: unknown): WorkspaceActivationWrite | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<WorkspaceActivationWrite>;
  if (typeof record.recorded !== "boolean") return null;
  if (!(record.id === null || typeof record.id === "string")) return null;
  if (
    record.outcome !== "recorded"
    && record.outcome !== "already-recorded"
    && record.outcome !== "deferred-no-consent"
    && record.outcome !== "deferred-no-picture"
  ) {
    return null;
  }
  return { recorded: record.recorded, id: record.id, outcome: record.outcome };
}

export function classifyWorkspaceActivationResult(
  result: TransportResult<unknown>,
): WorkspaceActivationAttempt | "retry" {
  if (result.ok) {
    const data = asWorkspaceActivationWrite(result.data);
    if (!data) return "deferred-no-consent";
    if (data.outcome === "recorded" || data.recorded === true) return "recorded";
    if (data.outcome === "already-recorded") return "already-recorded";
    if (data.outcome === "deferred-no-consent") return "deferred-no-consent";
    if (data.outcome === "deferred-no-picture") return "deferred-no-picture";
    return "deferred-no-consent";
  }
  if (result.error.code === "AUTH_REQUIRED" || result.error.code === "FORBIDDEN") {
    return "deferred-auth";
  }
  if (result.error.retryable) return "retry";
  return "deferred-auth";
}

export async function recordCitedPictureActivationWithRetry(input: {
  record: () => Promise<TransportResult<unknown>>;
  wait?: (ms: number) => Promise<void>;
  delaysMs?: readonly number[];
}): Promise<WorkspaceActivationAttempt> {
  const delays = input.delaysMs ?? workspaceActivationRetryDelaysMs;
  const wait = input.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    const delay = delays[attempt] ?? 0;
    if (delay > 0) await wait(delay);
    const classified = classifyWorkspaceActivationResult(await input.record());
    if (classified !== "retry") return classified;
  }
  return "retry-exhausted";
}

function defaultActivationStorage(): WorkspaceActivationStorage | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

export function createCitedPictureActivationGate(storage?: WorkspaceActivationStorage | null) {
  const resolvedStorage = storage === undefined ? defaultActivationStorage() : storage;
  const settledIds = new Set<string>();
  const inFlightIds = new Set<string>();

  function storageKey(workspaceId: string) {
    return `${workspaceActivationSettledStorageKeyPrefix}${workspaceId}`;
  }

  function isSettled(workspaceId: string) {
    if (settledIds.has(workspaceId)) return true;
    try {
      return resolvedStorage?.getItem(storageKey(workspaceId)) === "1";
    } catch {
      return false;
    }
  }

  function markSettled(workspaceId: string) {
    settledIds.add(workspaceId);
    try {
      resolvedStorage?.setItem(storageKey(workspaceId), "1");
    } catch {
      // Private mode or quota — in-memory latch still holds for this document.
    }
  }

  return {
    request(workspaceId: string, run: () => Promise<WorkspaceActivationAttempt>) {
      if (!workspaceId || isSettled(workspaceId) || inFlightIds.has(workspaceId)) return;
      inFlightIds.add(workspaceId);
      void run()
        .then((outcome) => {
          if (outcome === "recorded" || outcome === "already-recorded") markSettled(workspaceId);
        })
        .finally(() => {
          inFlightIds.delete(workspaceId);
        });
    },
  };
}

export function getWorkspaceActivationGate() {
  const holder = globalThis as typeof globalThis & {
    __vognaryWorkspaceActivationGate?: ReturnType<typeof createCitedPictureActivationGate>;
  };
  holder.__vognaryWorkspaceActivationGate ??= createCitedPictureActivationGate();
  return holder.__vognaryWorkspaceActivationGate;
}

export const workspaceActivationGate = {
  request(workspaceId: string, run: () => Promise<WorkspaceActivationAttempt>) {
    getWorkspaceActivationGate().request(workspaceId, run);
  },
};
