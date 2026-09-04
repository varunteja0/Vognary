import assert from "node:assert/strict";
import test from "node:test";
import type { AuthorizedProposalDecision } from "../src/lib/commitment-control/decision";
import {
  InMemoryFinOpsCapabilityLedger,
  TrustedFinOpsCapabilityAdapterRegistry,
  issueFinOpsCapability,
  reconcileFinOpsCapabilityOutcome,
  type FinOpsCapabilityAdapterResult,
  type FinOpsCapabilityAction,
  type FinOpsCapabilityGrant,
  type FrozenFinOpsCapabilityAction,
  type TrustedFinOpsCapabilityOperation,
} from "../src/lib/finops-control/capability";

const signingSecret = "synthetic-proof-secret-which-is-never-a-provider-credential";
const workspaceId = "a1000000-0000-4000-8000-000000000001";
const workloadId = "finops-operator:synthetic-ms-01";
const proposalId = "b1000000-0000-4000-8000-000000000001";
const actorId = "c1000000-0000-4000-8000-000000000001";
const grantId = "d1000000-0000-4000-8000-000000000001";
const issuedAt = "2026-09-02T08:00:00.000Z";
const expiresAt = "2026-09-02T08:05:00.000Z";

const decision: AuthorizedProposalDecision = {
  proposalId,
  evaluationPolicyVersion: 7,
  action: "APPROVE_WITH_CAP",
  approvedCapMinor: "10000",
  currency: "USD",
  expectedAmountMinor: "12500",
  decidedByUserId: actorId,
  decidedAt: issuedAt,
  authorizationExpiresOn: "2026-09-02",
  overrideReason: null,
};

const action: FinOpsCapabilityAction = {
  workspaceId,
  workloadId,
  adapter: "model-gateway",
  operation: "virtual-key.set-budget",
  resource: "virtual-key/synthetic-client-01",
  arguments: { maxBudgetMinor: "10000", currency: "USD", resetPeriod: "24h" },
  purpose: "Contain a confirmed model-cost anomaly while the client investigates.",
  estimatedAmountMinor: "10000",
  currency: "USD",
};

function appliedResult(
  verifiedAction: FrozenFinOpsCapabilityAction,
  providerRequestId: string,
  input: {
    status?: string;
    observedAmountMinor?: string;
    currency?: string;
    appliedAction?: FinOpsCapabilityAdapterResult["appliedAction"];
  } = {},
): FinOpsCapabilityAdapterResult {
  return {
    providerRequestId,
    status: input.status ?? "APPLIED",
    appliedAction: input.appliedAction ?? {
      adapter: verifiedAction.adapter,
      operation: verifiedAction.operation,
      resource: verifiedAction.resource,
      arguments: structuredClone(verifiedAction.arguments),
    },
    ...(input.observedAmountMinor === undefined ? {} : { observedAmountMinor: input.observedAmountMinor }),
    ...(input.currency === undefined ? {} : { currency: input.currency }),
  };
}

function trustedLedger(input: {
  buildProviderRequest?: TrustedFinOpsCapabilityOperation["buildProviderRequest"];
  invoke?: TrustedFinOpsCapabilityOperation["invoke"];
  log?: NonNullable<ConstructorParameters<typeof InMemoryFinOpsCapabilityLedger>[0]>["log"];
  successStatuses?: readonly string[];
} = {}) {
  const registry = new TrustedFinOpsCapabilityAdapterRegistry([{
    adapter: action.adapter,
    operation: action.operation,
    successStatuses: input.successStatuses ?? ["APPLIED"],
    buildProviderRequest: input.buildProviderRequest ?? ((verifiedAction) => ({
      resource: verifiedAction.resource,
      body: verifiedAction.arguments,
    })),
    invoke: input.invoke ?? (async ({ action: verifiedAction }) => appliedResult(
      verifiedAction,
      "synthetic-adapter-request",
    )),
  }]);
  return new InMemoryFinOpsCapabilityLedger({ registry, log: input.log });
}

async function issuedGrant(id = grantId) {
  return issueFinOpsCapability({
    signingSecret,
    decision,
    action,
    grantId: id,
    issuedAt,
    notBefore: issuedAt,
    expiresAt,
  });
}

test("an exact human-authorized grant permits one downstream call and replay never calls twice", async () => {
  const issued = await issuedGrant();
  let downstreamCalls = 0;
  let requestBuilds = 0;
  const ledger = trustedLedger({
    buildProviderRequest: (verifiedAction) => {
      requestBuilds += 1;
      assert.equal(Object.isFrozen(verifiedAction), true);
      assert.equal(Object.isFrozen(verifiedAction.arguments), true);
      return { target: verifiedAction.resource, body: verifiedAction.arguments };
    },
    invoke: async ({ action: verifiedAction, providerRequest }) => {
      downstreamCalls += 1;
      assert.equal(Object.isFrozen(verifiedAction), true);
      assert.equal(Object.isFrozen(verifiedAction.arguments), true);
      assert.equal(Object.isFrozen(providerRequest), true);
      assert.deepEqual(providerRequest, { target: action.resource, body: action.arguments });
      return appliedResult(verifiedAction, "gateway-request-001", {
        observedAmountMinor: "9800",
        currency: "USD",
      });
    },
  });
  ledger.register(issued.grant);

  const execute = () => ledger.execute({
    token: issued.token,
    signingSecret,
    action,
    idempotencyKey: "apply-budget-001",
    now: "2026-09-02T08:01:00.000Z",
  });

  const first = await execute();
  const replay = await execute();
  assert.equal(first.status, "EXECUTED");
  assert.equal(replay.status, "REPLAYED");
  assert.equal(downstreamCalls, 1);
  assert.equal(requestBuilds, 1);

  const secondOperation = await ledger.execute({
    token: issued.token,
    signingSecret,
    action,
    idempotencyKey: "apply-budget-002",
    now: "2026-09-02T08:02:00.000Z",
  });
  assert.deepEqual(secondOperation, { status: "DENIED", reason: "grant-consumed" });
  assert.equal(downstreamCalls, 1);
});

test("missing, cross-tenant, altered, over-limit, expired, and tampered grants make zero calls", async () => {
  const cases: Array<{ name: string; token?: string; mutate?: (value: FinOpsCapabilityAction) => FinOpsCapabilityAction; now?: string }> = [
    { name: "missing-token", token: undefined },
    { name: "cross-tenant", mutate: (value) => ({ ...value, workspaceId: "a2000000-0000-4000-8000-000000000002" }) },
    { name: "argument-mutation", mutate: (value) => ({ ...value, arguments: { ...value.arguments as object, maxBudgetMinor: "10001" } }) },
    { name: "purpose-mutation", mutate: (value) => ({ ...value, purpose: "Unapproved purpose" }) },
    { name: "over-limit", mutate: (value) => ({ ...value, estimatedAmountMinor: "10001" }) },
    { name: "expired", now: "2026-09-02T08:05:01.000Z" },
  ];
  let downstreamCalls = 0;

  for (let index = 0; index < cases.length; index += 1) {
    const scenario = cases[index]!;
    const issued = await issuedGrant(`d1000000-0000-4000-8000-${String(index + 2).padStart(12, "0")}`);
    const ledger = trustedLedger({
      invoke: async ({ action: verifiedAction }) => {
        downstreamCalls += 1;
        return appliedResult(verifiedAction, "must-not-run");
      },
    });
    ledger.register(issued.grant);
    const result = await ledger.execute({
      token: scenario.token === undefined && scenario.name !== "missing-token" ? issued.token : scenario.token,
      signingSecret,
      action: scenario.mutate?.(structuredClone(action)) ?? action,
      idempotencyKey: `denied-${scenario.name}`,
      now: scenario.now ?? "2026-09-02T08:01:00.000Z",
    });
    assert.equal(result.status, "DENIED", scenario.name);
  }

  const issued = await issuedGrant("d1000000-0000-4000-8000-000000000099");
  const ledger = trustedLedger({
    invoke: async ({ action: verifiedAction }) => {
      downstreamCalls += 1;
      return appliedResult(verifiedAction, "must-not-run");
    },
  });
  ledger.register(issued.grant);
  const [header, payload, signature] = issued.token.split(".");
  assert.ok(header && payload && signature);
  const payloadIndex = Math.floor(payload.length / 2);
  const replacement = payload[payloadIndex] === "a" ? "b" : "a";
  const tampered = `${header}.${payload.slice(0, payloadIndex)}${replacement}${payload.slice(payloadIndex + 1)}.${signature}`;
  const result = await ledger.execute({
    token: tampered,
    signingSecret,
    action,
    idempotencyKey: "denied-tampered",
    now: "2026-09-02T08:01:00.000Z",
  });
  assert.equal(result.status, "DENIED");
  assert.equal(downstreamCalls, 0);
});

test("concurrent execution and revocation races remain fail-closed", async () => {
  const concurrent = await issuedGrant("d1000000-0000-4000-8000-000000000101");
  let concurrentCalls = 0;
  const concurrentLedger = trustedLedger({
    invoke: async ({ action: verifiedAction }) => {
      concurrentCalls += 1;
      return appliedResult(verifiedAction, "gateway-request-concurrent");
    },
  });
  concurrentLedger.register(concurrent.grant);
  const attempts = await Promise.all(Array.from({ length: 20 }, (_, index) => concurrentLedger.execute({
    token: concurrent.token,
    signingSecret,
    action,
    idempotencyKey: `concurrent-${index}`,
    now: "2026-09-02T08:01:00.000Z",
  })));
  assert.equal(concurrentCalls, 1);
  assert.equal(attempts.filter((attempt) => attempt.status === "EXECUTED").length, 1);

  const revoked = await issuedGrant("d1000000-0000-4000-8000-000000000102");
  let releaseDispatch!: () => void;
  let markReserved!: () => void;
  const dispatchReleased = new Promise<void>((resolve) => { releaseDispatch = resolve; });
  const reserved = new Promise<void>((resolve) => { markReserved = resolve; });
  let revokedCalls = 0;
  const revokedLedger = trustedLedger({
    buildProviderRequest: async (verifiedAction) => {
      markReserved();
      await dispatchReleased;
      return { target: verifiedAction.resource, body: verifiedAction.arguments };
    },
    invoke: async ({ action: verifiedAction }) => {
      revokedCalls += 1;
      return appliedResult(verifiedAction, "must-not-run");
    },
  });
  revokedLedger.register(revoked.grant);
  const execution = revokedLedger.execute({
    token: revoked.token,
    signingSecret,
    action,
    idempotencyKey: "revocation-race",
    now: "2026-09-02T08:01:00.000Z",
  });
  await reserved;
  assert.equal(revokedLedger.revoke(revoked.grant.grantId, "2026-09-02T08:01:01.000Z"), true);
  releaseDispatch();
  assert.deepEqual(await execution, { status: "DENIED", reason: "grant-revoked" });
  assert.equal(revokedCalls, 0);
});

test("provider ambiguity is retry-safe and operational logs redact authority and payloads", async () => {
  const issued = await issuedGrant("d1000000-0000-4000-8000-000000000201");
  const logs: unknown[] = [];
  let downstreamCalls = 0;
  const ledger = trustedLedger({
    log: (entry) => logs.push(entry),
    invoke: async () => {
      downstreamCalls += 1;
      throw new Error("provider timeout after request body secret-prompt-123 was sent");
    },
  });
  ledger.register(issued.grant);
  const execute = () => ledger.execute({
    token: issued.token,
    signingSecret,
    action,
    idempotencyKey: "provider-timeout-001",
    now: "2026-09-02T08:01:00.000Z",
  });

  const first = await execute();
  const retry = await execute();
  assert.deepEqual(first, { status: "OUTCOME_UNKNOWN", reason: "provider-outcome-unknown" });
  assert.deepEqual(retry, first);
  assert.equal(downstreamCalls, 1);
  const serializedLogs = JSON.stringify(logs);
  assert.equal(serializedLogs.includes(issued.token), false);
  assert.equal(serializedLogs.includes(signingSecret), false);
  assert.equal(serializedLogs.includes("secret-prompt-123"), false);
  assert.equal(serializedLogs.includes(action.purpose), false);
  assert.equal(serializedLogs.includes("maxBudgetMinor"), false);
});

test("later evidence reconciles against the frozen authorization without mutating grant or decision", async () => {
  const issued = await issuedGrant("d1000000-0000-4000-8000-000000000301");
  const frozenGrant = structuredClone(issued.grant);
  const frozenDecision = structuredClone(decision);
  const result = reconcileFinOpsCapabilityOutcome({
    grant: issued.grant,
    decision,
    evidence: {
      evidenceId: "e1000000-0000-4000-8000-000000000001",
      amountMinor: "11000",
      currency: "USD",
      evidenceDate: "2026-09-02",
    },
  });
  assert.equal(result.verdict, "OVER_CAP");
  assert.deepEqual(issued.grant, frozenGrant);
  assert.deepEqual(decision, frozenDecision);
});

test("audit and trusted request-builder failures deny without stranding or invoking the adapter", async () => {
  const auditFailure = await issuedGrant("d1000000-0000-4000-8000-000000000401");
  let downstreamCalls = 0;
  let auditUnavailable = true;
  const auditLedger = trustedLedger({
    log: () => {
      if (auditUnavailable) throw new Error("audit transport contains secret-log-payload");
    },
    invoke: async ({ action: verifiedAction }) => {
      downstreamCalls += 1;
      return appliedResult(verifiedAction, "gateway-after-audit-recovery");
    },
  });
  auditLedger.register(auditFailure.grant);
  const deniedForAudit = await auditLedger.execute({
    token: auditFailure.token,
    signingSecret,
    action,
    idempotencyKey: "audit-failure",
    now: "2026-09-02T08:01:00.000Z",
  });
  assert.deepEqual(deniedForAudit, { status: "DENIED", reason: "audit-log-unavailable" });
  assert.equal(downstreamCalls, 0);
  auditUnavailable = false;
  const retryAfterAuditRecovery = await auditLedger.execute({
    token: auditFailure.token,
    signingSecret,
    action,
    idempotencyKey: "audit-recovered",
    now: "2026-09-02T08:01:01.000Z",
  });
  assert.equal(retryAfterAuditRecovery.status, "EXECUTED");
  assert.equal(downstreamCalls, 1);

  const hookFailure = await issuedGrant("d1000000-0000-4000-8000-000000000402");
  let requestBuilderUnavailable = true;
  const hookLedger = trustedLedger({
    buildProviderRequest: (verifiedAction) => {
      if (requestBuilderUnavailable) throw new Error("revocation store unavailable");
      return { target: verifiedAction.resource, body: verifiedAction.arguments };
    },
    invoke: async ({ action: verifiedAction }) => {
      downstreamCalls += 1;
      return appliedResult(verifiedAction, "gateway-after-hook-recovery");
    },
  });
  hookLedger.register(hookFailure.grant);
  const deniedForHook = await hookLedger.execute({
    token: hookFailure.token,
    signingSecret,
    action,
    idempotencyKey: "hook-failure",
    now: "2026-09-02T08:01:00.000Z",
  });
  assert.deepEqual(deniedForHook, { status: "DENIED", reason: "provider-request-build-failed" });
  assert.equal(downstreamCalls, 1);
  requestBuilderUnavailable = false;
  const retryAfterHookRecovery = await hookLedger.execute({
    token: hookFailure.token,
    signingSecret,
    action,
    idempotencyKey: "hook-recovered",
    now: "2026-09-02T08:01:01.000Z",
  });
  assert.equal(retryAfterHookRecovery.status, "EXECUTED");
  assert.equal(downstreamCalls, 2);
});

test("registered grant times are bound to signed JWT claims", async () => {
  const issued = await issuedGrant("d1000000-0000-4000-8000-000000000501");
  const ledger = new InMemoryFinOpsCapabilityLedger();
  ledger.register({ ...issued.grant, expiresAt: "2026-09-02T08:02:00.000Z" });
  const result = await ledger.execute({
    token: issued.token,
    signingSecret,
    action,
    idempotencyKey: "mismatched-grant-time",
    now: "2026-09-02T08:01:00.000Z",
  });
  assert.deepEqual(result, { status: "DENIED", reason: "unknown-grant" });
});

test("capability arguments reject non-plain JSON objects", async () => {
  await assert.rejects(
    issueFinOpsCapability({
      signingSecret,
      decision,
      action: { ...action, arguments: new Date("2026-09-02T08:00:00.000Z") },
      grantId: "d1000000-0000-4000-8000-000000000601",
      issuedAt,
      notBefore: issuedAt,
      expiresAt,
    }),
    /plain JSON objects/i,
  );
});

test("reconciliation requires the complete frozen decision identity", async () => {
  const issued = await issuedGrant("d1000000-0000-4000-8000-000000000701");
  assert.throws(
    () => reconcileFinOpsCapabilityOutcome({
      grant: issued.grant,
      decision: { ...decision, evaluationPolicyVersion: 8 },
      evidence: {
        evidenceId: "e1000000-0000-4000-8000-000000000001",
        amountMinor: "11000",
        currency: "USD",
        evidenceDate: "2026-09-02",
      },
    }),
    /policy version/i,
  );
  assert.throws(
    () => reconcileFinOpsCapabilityOutcome({
      grant: issued.grant,
      decision: { ...decision, expectedAmountMinor: "13000" },
      evidence: {
        evidenceId: "e1000000-0000-4000-8000-000000000001",
        amountMinor: "11000",
        currency: "USD",
        evidenceDate: "2026-09-02",
      },
    }),
    /expected amount/i,
  );
  assert.throws(
    () => reconcileFinOpsCapabilityOutcome({
      grant: issued.grant,
      decision: { ...decision, decidedByUserId: "c1000000-0000-4000-8000-000000000099" },
      evidence: {
        evidenceId: "e1000000-0000-4000-8000-000000000001",
        amountMinor: "11000",
        currency: "USD",
        evidenceDate: "2026-09-02",
      },
    }),
    /decision actor/i,
  );
});

test("strict JSON arguments reject sparse arrays and non-JSON values before hashing", async () => {
  const sparseAction = { ...action, arguments: { windows: [] } };
  const issued = await issueFinOpsCapability({
    signingSecret,
    decision,
    action: sparseAction,
    grantId: "d1000000-0000-4000-8000-000000000801",
    issuedAt,
    notBefore: issuedAt,
    expiresAt,
  });
  const ledger = trustedLedger({
    invoke: async ({ action: verifiedAction }) => {
      downstreamCalls += 1;
      return appliedResult(verifiedAction, "must-not-run");
    },
  });
  ledger.register(issued.grant);
  let downstreamCalls = 0;
  const sparseResult = await ledger.execute({
    token: issued.token,
    signingSecret,
    action: { ...sparseAction, arguments: { windows: Array(1) } },
    idempotencyKey: "sparse-array-collision",
    now: "2026-09-02T08:01:00.000Z",
  });
  assert.deepEqual(sparseResult, { status: "DENIED", reason: "invalid-action" });
  assert.equal(downstreamCalls, 0);

  let accessorReads = 0;
  const accessor = {} as Record<string, unknown>;
  Object.defineProperty(accessor, "value", {
    enumerable: true,
    get() {
      accessorReads += 1;
      return "must-not-read";
    },
  });
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  const symbolKey = { value: 1 } as Record<PropertyKey, unknown>;
  symbolKey[Symbol("hidden")] = 2;
  const invalidArguments: Array<{ name: string; value: unknown }> = [
    { name: "undefined", value: undefined },
    { name: "nested-undefined", value: { value: undefined } },
    { name: "accessor", value: accessor },
    { name: "cycle", value: cycle },
    { name: "symbol-value", value: Symbol("value") },
    { name: "symbol-key", value: symbolKey },
    { name: "nan", value: Number.NaN },
    { name: "infinity", value: Number.POSITIVE_INFINITY },
    { name: "date", value: new Date(issuedAt) },
    { name: "map", value: new Map([["value", 1]]) },
  ];

  for (let index = 0; index < invalidArguments.length; index += 1) {
    const invalid = invalidArguments[index]!;
    await assert.rejects(
      issueFinOpsCapability({
        signingSecret,
        decision,
        action: { ...action, arguments: invalid.value },
        grantId: `d1000000-0000-4000-8000-${String(802 + index).padStart(12, "0")}`,
        issuedAt,
        notBefore: issuedAt,
        expiresAt,
      }),
      (error) => error instanceof Error,
      invalid.name,
    );
  }
  assert.equal(accessorReads, 0, "argument validation must inspect descriptors without invoking accessors");
});

test("execution callers cannot substitute an arbitrary effect for the authorized action", async () => {
  const issued = await issuedGrant("d1000000-0000-4000-8000-000000000901");
  const ledger = new InMemoryFinOpsCapabilityLedger();
  ledger.register(issued.grant);
  let destructiveEffects = 0;
  const untrustedInput = {
    token: issued.token,
    signingSecret,
    action,
    idempotencyKey: "substituted-delete-effect",
    now: "2026-09-02T08:01:00.000Z",
    downstream: async () => {
      destructiveEffects += 1;
      return {
        providerRequestId: "delete-request",
        status: "DELETED",
        appliedAction: {
          adapter: action.adapter,
          operation: "virtual-key.delete",
          resource: action.resource,
          arguments: {},
        },
      } as never;
    },
  } as Parameters<InMemoryFinOpsCapabilityLedger["execute"]>[0] & {
    downstream: () => Promise<unknown>;
  };
  const result = await ledger.execute(untrustedInput);
  assert.deepEqual(result, { status: "DENIED", reason: "adapter-operation-not-allowed" });
  assert.equal(destructiveEffects, 0);
});

test("reconciliation binds every semantically relevant decision field", async () => {
  const issued = await issuedGrant("d1000000-0000-4000-8000-000000001001");
  const evidence = {
    evidenceId: "e1000000-0000-4000-8000-000000000001",
    amountMinor: "11000",
    currency: "USD",
    evidenceDate: "2026-09-02",
  };
  const mutations: Array<{ field: keyof AuthorizedProposalDecision; value: AuthorizedProposalDecision }> = [
    { field: "proposalId", value: { ...decision, proposalId: "b1000000-0000-4000-8000-000000000099" } },
    { field: "evaluationPolicyVersion", value: { ...decision, evaluationPolicyVersion: 8 } },
    { field: "action", value: { ...decision, action: "APPROVE" } },
    { field: "approvedCapMinor", value: { ...decision, approvedCapMinor: "9999" } },
    { field: "currency", value: { ...decision, currency: "INR" } },
    { field: "expectedAmountMinor", value: { ...decision, expectedAmountMinor: "13000" } },
    { field: "decidedByUserId", value: { ...decision, decidedByUserId: "c1000000-0000-4000-8000-000000000099" } },
    { field: "decidedAt", value: { ...decision, decidedAt: "2026-09-02T08:00:00.001Z" } },
    { field: "overrideReason", value: { ...decision, overrideReason: "changed reason" } },
  ];

  for (const mutation of mutations) {
    assert.throws(
      () => reconcileFinOpsCapabilityOutcome({ grant: issued.grant, decision: mutation.value, evidence }),
      (error) => error instanceof Error,
      mutation.field,
    );
  }
});

test("same-idempotency retry while reserved coalesces behind one invocation", async () => {
  const issued = await issuedGrant("d1000000-0000-4000-8000-000000001101");
  let markReserved!: () => void;
  let releaseDispatch!: () => void;
  const reserved = new Promise<void>((resolve) => { markReserved = resolve; });
  const dispatchReleased = new Promise<void>((resolve) => { releaseDispatch = resolve; });
  let downstreamCalls = 0;
  const ledger = trustedLedger({
    buildProviderRequest: async (verifiedAction) => {
      markReserved();
      await dispatchReleased;
      return { target: verifiedAction.resource, body: verifiedAction.arguments };
    },
    invoke: async ({ action: verifiedAction }) => {
      downstreamCalls += 1;
      return appliedResult(verifiedAction, "one-request");
    },
  });
  ledger.register(issued.grant);
  const execute = () => ledger.execute({
    token: issued.token,
    signingSecret,
    action,
    idempotencyKey: "same-in-flight-key",
    now: "2026-09-02T08:01:00.000Z",
  });

  const first = execute();
  await reserved;
  const retry = execute();
  const retryBeforeRelease = await Promise.race([
    retry.then(() => "resolved" as const),
    new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 20)),
  ]);
  assert.equal(retryBeforeRelease, "pending", "same-key retry must wait for the reserved invocation");
  releaseDispatch();
  assert.equal((await first).status, "EXECUTED");
  assert.equal((await retry).status, "REPLAYED");
  assert.equal(downstreamCalls, 1);
});

test("registered timestamps are bound at millisecond precision", async () => {
  const timestampMutations = [
    { name: "issuedAt", values: { issuedAt: "2026-09-02T08:00:00.001Z", notBefore: "2026-09-02T08:00:00.001Z" } },
    { name: "notBefore", values: { notBefore: "2026-09-02T08:00:00.001Z" } },
    { name: "expiresAt", values: { expiresAt: "2026-09-02T08:05:00.001Z" } },
  ] as const;
  let downstreamCalls = 0;
  for (let index = 0; index < timestampMutations.length; index += 1) {
    const mutation = timestampMutations[index]!;
    const issued = await issuedGrant(`d1000000-0000-4000-8000-${String(1201 + index).padStart(12, "0")}`);
    const ledger = trustedLedger({
      invoke: async ({ action: verifiedAction }) => {
        downstreamCalls += 1;
        return appliedResult(verifiedAction, "must-not-run");
      },
    });
    ledger.register({ ...issued.grant, ...mutation.values });
    const result = await ledger.execute({
      token: issued.token,
      signingSecret,
      action,
      idempotencyKey: `subsecond-${mutation.name}`,
      now: "2026-09-02T08:01:00.000Z",
    });
    assert.deepEqual(result, { status: "DENIED", reason: "unknown-grant" }, mutation.name);
  }
  assert.equal(downstreamCalls, 0);
});

test("post-dispatch callback and audit failures never reopen a grant", async () => {
  const executed = await issuedGrant("d1000000-0000-4000-8000-000000001301");
  let executedCalls = 0;
  const executedLedger = trustedLedger({
    log: (entry) => {
      if (entry.event === "capability.executed") throw new Error("audit unavailable after dispatch");
    },
    invoke: async ({ action: verifiedAction }) => {
      executedCalls += 1;
      return appliedResult(verifiedAction, "known-result");
    },
  });
  executedLedger.register(executed.grant);
  const executeKnown = () => executedLedger.execute({
    token: executed.token,
    signingSecret,
    action,
    idempotencyKey: "post-dispatch-audit",
    now: "2026-09-02T08:01:00.000Z",
  });
  assert.equal((await executeKnown()).status, "EXECUTED");
  assert.equal((await executeKnown()).status, "REPLAYED");
  assert.equal(executedCalls, 1);

  const ambiguous = await issuedGrant("d1000000-0000-4000-8000-000000001302");
  let ambiguousCalls = 0;
  const ambiguousLedger = trustedLedger({
    log: (entry) => {
      if (entry.event === "capability.outcome_unknown") throw new Error("audit unavailable after ambiguity");
    },
    invoke: async () => {
      ambiguousCalls += 1;
      throw new Error("callback failed after dispatch");
    },
  });
  ambiguousLedger.register(ambiguous.grant);
  const executeUnknown = () => ambiguousLedger.execute({
    token: ambiguous.token,
    signingSecret,
    action,
    idempotencyKey: "post-dispatch-unknown-audit",
    now: "2026-09-02T08:01:00.000Z",
  });
  assert.equal((await executeUnknown()).status, "OUTCOME_UNKNOWN");
  assert.equal((await executeUnknown()).status, "OUTCOME_UNKNOWN");
  assert.equal(ambiguousCalls, 1);
});

test("malformed registered grants are rejected before entering the ledger", async () => {
  const issued = await issuedGrant("d1000000-0000-4000-8000-000000001401");
  const malformed: FinOpsCapabilityGrant[] = [
    { ...issued.grant, grantId: "not-a-uuid" },
    { ...issued.grant, argumentsHash: "not-a-sha256-digest" },
    { ...issued.grant, estimatedAmountMinor: "10001", maxAmountMinor: "10000" },
    { ...issued.grant, expiresAt: issued.grant.issuedAt },
  ];
  for (const grant of malformed) {
    const ledger = new InMemoryFinOpsCapabilityLedger();
    assert.throws(() => ledger.register(grant));
  }
});

test("adapter results that conflict with the requested action are never reported as executed", async () => {
  const issued = await issuedGrant("d1000000-0000-4000-8000-000000001501");
  const ledger = trustedLedger({
    invoke: async ({ action: verifiedAction }) => appliedResult(
      verifiedAction,
      "conflicting-result",
      {
        appliedAction: {
          adapter: verifiedAction.adapter,
          operation: "virtual-key.delete",
          resource: verifiedAction.resource,
          arguments: {},
        },
      },
    ),
  });
  ledger.register(issued.grant);
  const result = await ledger.execute({
    token: issued.token,
    signingSecret,
    action,
    idempotencyKey: "conflicting-adapter-result",
    now: "2026-09-02T08:01:00.000Z",
  });
  assert.deepEqual(result, { status: "OUTCOME_UNKNOWN", reason: "adapter-result-conflict" });
});