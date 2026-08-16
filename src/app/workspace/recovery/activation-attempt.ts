"use client";

import type { TransportResult } from "./transport";

export const workspaceActivationRetryDelaysMs = [0, 250, 750] as const;
export const workspaceActivationSettledStorageKeyPrefix = "vognary.workspace-activation.settled:";

export type WorkspaceActivationWrite = {
  recorded?: boolean;
  id?: string | null;
  outcome?: string;
};

export type WorkspaceActivationAttempt =
  | "recorded"
  | "already-recorded"
  | "deferred-no-consent"
  | "deferred-no-picture"
  | "deferred-auth"
  | "retry-exhausted";

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

export function classifyWorkspaceActivationResult(
  result: TransportResult<WorkspaceActivationWrite | unknown>,
): WorkspaceActivationAttempt | "retry" {
  if (result.ok) {
    const data = result.data && typeof result.data === "object"
      ? result.data as WorkspaceActivationWrite
      : {};
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
