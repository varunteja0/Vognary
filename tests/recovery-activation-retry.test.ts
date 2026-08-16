import assert from "node:assert/strict";
import test from "node:test";

import {
  createCitedPictureActivationGate,
  isRetryableWorkspaceActivationFailure,
  recordCitedPictureActivationWithRetry,
  type WorkspaceActivationAttempt,
} from "../src/app/workspace/recovery/activation-attempt";
import type { TransportFailure, TransportResult } from "../src/app/workspace/recovery/transport";

const recorded = {
  ok: true as const,
  data: { recorded: true, id: "event-1", outcome: "recorded" as const },
  meta: { requestId: "request-1", workspaceVersion: 1 },
};
const alreadyRecorded = {
  ok: true as const,
  data: { recorded: false, id: null, outcome: "already-recorded" as const },
  meta: { requestId: "request-1", workspaceVersion: 1 },
};
const deferredNoConsent = {
  ok: true as const,
  data: { recorded: false, id: null, outcome: "deferred-no-consent" as const },
  meta: { requestId: "request-1", workspaceVersion: 1 },
};
const deferredNoPicture = {
  ok: true as const,
  data: { recorded: false, id: null, outcome: "deferred-no-picture" as const },
  meta: { requestId: "request-1", workspaceVersion: 1 },
};
const retryable: TransportFailure = {
  ok: false,
  origin: "CLIENT",
  error: { code: "UNKNOWN", message: "offline", retryable: true, requestId: "client-device" },
};
const forbidden: TransportFailure = {
  ok: false,
  origin: "SERVER",
  error: { code: "FORBIDDEN", message: "cross-site", retryable: false, requestId: "request-1" },
};
const unauthorized: TransportFailure = {
  ok: false,
  origin: "SERVER",
  error: { code: "AUTH_REQUIRED", message: "sign in", retryable: false, requestId: "request-1" },
};

function memoryStorage() {
  const memory = new Map<string, string>();
  return {
    memory,
    storage: {
      getItem(key: string) {
        return memory.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        memory.set(key, value);
      },
    },
  };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("transient activation failures retry a bounded number of times, then leave the gate open", async () => {
  assert.equal(isRetryableWorkspaceActivationFailure(retryable), true);
  assert.equal(isRetryableWorkspaceActivationFailure(forbidden), false);
  assert.equal(isRetryableWorkspaceActivationFailure(unauthorized), false);
  assert.equal(isRetryableWorkspaceActivationFailure(recorded), false);

  const attempts: TransportResult<unknown>[] = [retryable, retryable, recorded];
  const waits: number[] = [];
  const outcome = await recordCitedPictureActivationWithRetry({
    record: async () => attempts.shift() ?? retryable,
    wait: async (ms) => {
      waits.push(ms);
    },
    delaysMs: [0, 10, 20],
  });
  assert.equal(outcome, "recorded");
  assert.deepEqual(waits, [10, 20]);
  assert.equal(attempts.length, 0);

  const exhausted = await recordCitedPictureActivationWithRetry({
    record: async () => retryable,
    wait: async () => undefined,
    delaysMs: [0, 0],
  });
  assert.equal(exhausted, "retry-exhausted");

  const authWithoutRetry = await recordCitedPictureActivationWithRetry({
    record: async () => forbidden,
    wait: async () => {
      throw new Error("non-retryable failures must not wait");
    },
    delaysMs: [0, 10],
  });
  assert.equal(authWithoutRetry, "deferred-auth");
});

test("no-consent and auth failures stay eligible; recorded and already-recorded latch", async () => {
  assert.equal(await recordCitedPictureActivationWithRetry({
    record: async () => deferredNoConsent,
    wait: async () => {
      throw new Error("202 must not retry");
    },
  }), "deferred-no-consent");
  assert.equal(await recordCitedPictureActivationWithRetry({
    record: async () => deferredNoPicture,
    wait: async () => {
      throw new Error("no-picture must not retry");
    },
  }), "deferred-no-picture");
  assert.equal(await recordCitedPictureActivationWithRetry({
    record: async () => unauthorized,
    wait: async () => {
      throw new Error("401 must not retry");
    },
  }), "deferred-auth");
  assert.equal(await recordCitedPictureActivationWithRetry({
    record: async () => alreadyRecorded,
  }), "already-recorded");

  const { memory, storage } = memoryStorage();
  const gate = createCitedPictureActivationGate(storage);
  let starts = 0;

  gate.request("workspace-1", async () => {
    starts += 1;
    return "deferred-no-consent";
  });
  await flush();
  assert.equal(starts, 1);
  assert.equal([...memory.keys()].length, 0);

  gate.request("workspace-1", async () => {
    starts += 1;
    return "recorded";
  });
  await flush();
  assert.equal(starts, 2);
  assert.equal(memory.get("vognary.workspace-activation.settled:workspace-1"), "1");

  const { storage: authStorage, memory: authMemory } = memoryStorage();
  const authGate = createCitedPictureActivationGate(authStorage);
  let authStarts = 0;
  authGate.request("workspace-1", async () => {
    authStarts += 1;
    return "deferred-auth";
  });
  await flush();
  authGate.request("workspace-1", async () => {
    authStarts += 1;
    return "recorded";
  });
  await flush();
  assert.equal(authStarts, 2);
  assert.equal(authMemory.get("vognary.workspace-activation.settled:workspace-1"), "1");
});

test("the activation gate latches only after a recorded attempt, not before the first response", async () => {
  const gate = createCitedPictureActivationGate(null);
  let starts = 0;
  let resolveFirst!: (value: WorkspaceActivationAttempt) => void;
  const first = new Promise<WorkspaceActivationAttempt>((resolve) => {
    resolveFirst = resolve;
  });

  gate.request("workspace-1", () => {
    starts += 1;
    return first;
  });
  gate.request("workspace-1", () => {
    starts += 1;
    return Promise.resolve("recorded");
  });
  assert.equal(starts, 1);

  resolveFirst("retry-exhausted");
  await first;
  await flush();

  gate.request("workspace-1", () => {
    starts += 1;
    return Promise.resolve("recorded");
  });
  await flush();
  assert.equal(starts, 2);

  gate.request("workspace-1", () => {
    starts += 1;
    return Promise.resolve("recorded");
  });
  await flush();
  assert.equal(starts, 2);
});

test("a recorded activation survives a new document gate via session storage", async () => {
  const { storage } = memoryStorage();
  const firstDocument = createCitedPictureActivationGate(storage);
  firstDocument.request("workspace-1", async () => "recorded");
  await flush();

  const reloadedDocument = createCitedPictureActivationGate(storage);
  let starts = 0;
  reloadedDocument.request("workspace-1", async () => {
    starts += 1;
    return "recorded";
  });
  await Promise.resolve();
  assert.equal(starts, 0);

  reloadedDocument.request("workspace-2", async () => {
    starts += 1;
    return "already-recorded";
  });
  await Promise.resolve();
  assert.equal(starts, 1);
});

test("two workspaces can record activation at the same time", async () => {
  const { storage, memory } = memoryStorage();
  const gate = createCitedPictureActivationGate(storage);
  let resolveA!: (value: WorkspaceActivationAttempt) => void;
  let resolveB!: (value: WorkspaceActivationAttempt) => void;
  const firstA = new Promise<WorkspaceActivationAttempt>((resolve) => { resolveA = resolve; });
  const firstB = new Promise<WorkspaceActivationAttempt>((resolve) => { resolveB = resolve; });
  const started: string[] = [];

  gate.request("workspace-a", () => {
    started.push("a");
    return firstA;
  });
  gate.request("workspace-b", () => {
    started.push("b");
    return firstB;
  });
  assert.deepEqual(started, ["a", "b"]);

  resolveA("recorded");
  resolveB("recorded");
  await flush();
  assert.equal(memory.get("vognary.workspace-activation.settled:workspace-a"), "1");
  assert.equal(memory.get("vognary.workspace-activation.settled:workspace-b"), "1");
});
