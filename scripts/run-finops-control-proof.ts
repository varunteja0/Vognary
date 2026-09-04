import assert from "node:assert/strict";
import type { AuthorizedProposalDecision } from "../src/lib/commitment-control/decision";
import {
  InMemoryFinOpsCapabilityLedger,
  TrustedFinOpsCapabilityAdapterRegistry,
  issueFinOpsCapability,
  reconcileFinOpsCapabilityOutcome,
  type FinOpsCapabilityAdapterResult,
  type FinOpsCapabilityAction,
  type FrozenFinOpsCapabilityAction,
  type TrustedFinOpsCapabilityOperation,
} from "../src/lib/finops-control/capability";

const signingSecret = "synthetic-finops-control-proof-signing-secret";
const baseGrantId = "d2000000-0000-4000-8000-";
const issuedAt = "2026-09-02T08:00:00.000Z";
const validAt = "2026-09-02T08:01:00.000Z";
const expiresAt = "2026-09-02T08:05:00.000Z";

const decision: AuthorizedProposalDecision = {
  proposalId: "b2000000-0000-4000-8000-000000000001",
  evaluationPolicyVersion: 4,
  action: "APPROVE_WITH_CAP",
  approvedCapMinor: "10000",
  currency: "USD",
  expectedAmountMinor: "12500",
  decidedByUserId: "c2000000-0000-4000-8000-000000000001",
  decidedAt: issuedAt,
  authorizationExpiresOn: "2026-09-02",
  overrideReason: null,
};

const action: FinOpsCapabilityAction = {
  workspaceId: "a2000000-0000-4000-8000-000000000001",
  workloadId: "finops-operator:synthetic-ms-01",
  adapter: "model-gateway",
  operation: "virtual-key.set-budget",
  resource: "virtual-key/synthetic-client-01",
  arguments: { maxBudgetMinor: "10000", currency: "USD", resetPeriod: "24h" },
  purpose: "Contain a confirmed model-cost anomaly while the client investigates.",
  estimatedAmountMinor: "10000",
  currency: "USD",
};

let grantCounter = 0;
let attempts = 0;
let denied = 0;
let executed = 0;
let replayed = 0;
let outcomeUnknown = 0;
let providerRequestBuilds = 0;
let adapterInvocations = 0;
let callerSuppliedEffects = 0;

function appliedResult(
  verifiedAction: FrozenFinOpsCapabilityAction,
  providerRequestId: string,
  input: { observedAmountMinor?: string; currency?: string } = {},
): FinOpsCapabilityAdapterResult {
  return {
    providerRequestId,
    status: "APPLIED",
    appliedAction: {
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
} = {}) {
  const registry = new TrustedFinOpsCapabilityAdapterRegistry([{
    adapter: action.adapter,
    operation: action.operation,
    successStatuses: ["APPLIED"],
    buildProviderRequest: async (verifiedAction) => {
      providerRequestBuilds += 1;
      return input.buildProviderRequest
        ? input.buildProviderRequest(verifiedAction)
        : { target: verifiedAction.resource, body: verifiedAction.arguments };
    },
    invoke: async (invocation) => {
      adapterInvocations += 1;
      return input.invoke
        ? input.invoke(invocation)
        : appliedResult(invocation.action, "in-process-adapter-request");
    },
  }]);
  return new InMemoryFinOpsCapabilityLedger({ registry });
}

async function createGrant() {
  grantCounter += 1;
  const grantId = `${baseGrantId}${String(grantCounter).padStart(12, "0")}`;
  return issueFinOpsCapability({
    signingSecret,
    decision,
    action,
    grantId,
    issuedAt,
    notBefore: issuedAt,
    expiresAt,
  });
}

function count(result: { status: string }) {
  attempts += 1;
  if (result.status === "DENIED") denied += 1;
  else if (result.status === "EXECUTED") executed += 1;
  else if (result.status === "REPLAYED") replayed += 1;
  else if (result.status === "OUTCOME_UNKNOWN") outcomeUnknown += 1;
}

async function exactGrantProof() {
  const issued = await createGrant();
  const ledger = trustedLedger({
    invoke: async ({ action: verifiedAction }) => appliedResult(
      verifiedAction,
      "in-process-adapter-request-001",
      { observedAmountMinor: "9800", currency: "USD" },
    ),
  });
  ledger.register(issued.grant);
  const execute = (idempotencyKey: string) => ledger.execute({
    token: issued.token,
    signingSecret,
    action,
    idempotencyKey,
    now: validAt,
  });
  const first = await execute("exact-001");
  const replay = await execute("exact-001");
  const secondOperation = await execute("exact-002");
  [first, replay, secondOperation].forEach(count);
  assert.equal(first.status, "EXECUTED");
  assert.equal(replay.status, "REPLAYED");
  assert.equal(secondOperation.status, "DENIED");
}

async function denialMatrixProof() {
  const scenarios: Array<{
    name: string;
    mutate?: (value: FinOpsCapabilityAction) => FinOpsCapabilityAction;
    token?: "missing" | "tampered";
    now?: string;
  }> = [
    { name: "missing", token: "missing" },
    { name: "cross-tenant", mutate: (value) => ({ ...value, workspaceId: "a2000000-0000-4000-8000-000000000099" }) },
    { name: "wrong-workload", mutate: (value) => ({ ...value, workloadId: "finops-operator:other" }) },
    { name: "wrong-adapter", mutate: (value) => ({ ...value, adapter: "cloud-budget" }) },
    { name: "wrong-operation", mutate: (value) => ({ ...value, operation: "virtual-key.delete" }) },
    { name: "wrong-resource", mutate: (value) => ({ ...value, resource: "virtual-key/other-client" }) },
    { name: "altered-arguments", mutate: (value) => ({ ...value, arguments: { maxBudgetMinor: "10001", currency: "USD", resetPeriod: "24h" } }) },
    { name: "altered-purpose", mutate: (value) => ({ ...value, purpose: "Unapproved purpose" }) },
    { name: "over-limit", mutate: (value) => ({ ...value, estimatedAmountMinor: "10001" }) },
    { name: "wrong-currency", mutate: (value) => ({ ...value, currency: "INR" }) },
    { name: "expired", now: "2026-09-02T08:05:01.000Z" },
    { name: "tampered", token: "tampered" },
  ];

  for (const scenario of scenarios) {
    const issued = await createGrant();
    const ledger = trustedLedger();
    ledger.register(issued.grant);
    let token: string | undefined = issued.token;
    if (scenario.token === "missing") token = undefined;
    if (scenario.token === "tampered") {
      const [header, payload, signature] = issued.token.split(".");
      assert.ok(header && payload && signature);
      const index = Math.floor(payload.length / 2);
      token = `${header}.${payload.slice(0, index)}${payload[index] === "a" ? "b" : "a"}${payload.slice(index + 1)}.${signature}`;
    }
    const result = await ledger.execute({
      token,
      signingSecret,
      action: scenario.mutate?.(structuredClone(action)) ?? action,
      idempotencyKey: `deny-${scenario.name}`,
      now: scenario.now ?? validAt,
    });
    count(result);
    assert.equal(result.status, "DENIED", scenario.name);
  }
}

async function concurrencyProof() {
  const issued = await createGrant();
  const ledger = trustedLedger({
    invoke: async ({ action: verifiedAction }) => appliedResult(
      verifiedAction,
      "in-process-adapter-concurrent",
    ),
  });
  ledger.register(issued.grant);
  const results = await Promise.all(Array.from({ length: 20 }, (_, index) => ledger.execute({
    token: issued.token,
    signingSecret,
    action,
    idempotencyKey: `concurrent-${index}`,
    now: validAt,
  })));
  results.forEach(count);
  assert.equal(results.filter((result) => result.status === "EXECUTED").length, 1);
}

async function revocationAndAmbiguityProof() {
  const revoked = await createGrant();
  let releaseDispatch!: () => void;
  let notifyReserved!: () => void;
  const dispatchReleased = new Promise<void>((resolve) => { releaseDispatch = resolve; });
  const reserved = new Promise<void>((resolve) => { notifyReserved = resolve; });
  const revokedLedger = trustedLedger({
    buildProviderRequest: async (verifiedAction) => {
      notifyReserved();
      await dispatchReleased;
      return { target: verifiedAction.resource, body: verifiedAction.arguments };
    },
  });
  revokedLedger.register(revoked.grant);
  const pending = revokedLedger.execute({
    token: revoked.token,
    signingSecret,
    action,
    idempotencyKey: "revoke-before-dispatch",
    now: validAt,
  });
  await reserved;
  assert.equal(revokedLedger.revoke(revoked.grant.grantId, "2026-09-02T08:01:01.000Z"), true);
  releaseDispatch();
  const revokedResult = await pending;
  count(revokedResult);
  assert.equal(revokedResult.status, "DENIED");

  const ambiguous = await createGrant();
  const ambiguousLedger = trustedLedger({
    invoke: async () => {
      throw new Error("synthetic timeout after dispatch");
    },
  });
  ambiguousLedger.register(ambiguous.grant);
  const execute = () => ambiguousLedger.execute({
    token: ambiguous.token,
    signingSecret,
    action,
    idempotencyKey: "ambiguous-001",
    now: validAt,
  });
  const first = await execute();
  const retry = await execute();
  [first, retry].forEach(count);
  assert.equal(first.status, "OUTCOME_UNKNOWN");
  assert.deepEqual(retry, first);

  const reconciliation = reconcileFinOpsCapabilityOutcome({
    grant: ambiguous.grant,
    decision,
    evidence: {
      evidenceId: "e2000000-0000-4000-8000-000000000001",
      amountMinor: "11000",
      currency: "USD",
      evidenceDate: "2026-09-02",
    },
  });
  assert.equal(reconciliation.verdict, "OVER_CAP");
  return reconciliation.verdict;
}

async function strictJsonAndCallerEffectProof() {
  const sparseAction = { ...action, arguments: { windows: [] } };
  const sparseGrant = await issueFinOpsCapability({
    signingSecret,
    decision,
    action: sparseAction,
    grantId: `${baseGrantId}${String(++grantCounter).padStart(12, "0")}`,
    issuedAt,
    notBefore: issuedAt,
    expiresAt,
  });
  const sparseLedger = trustedLedger();
  sparseLedger.register(sparseGrant.grant);
  const sparseResult = await sparseLedger.execute({
    token: sparseGrant.token,
    signingSecret,
    action: { ...sparseAction, arguments: { windows: Array(1) } },
    idempotencyKey: "sparse-array",
    now: validAt,
  });
  count(sparseResult);
  assert.deepEqual(sparseResult, { status: "DENIED", reason: "invalid-action" });

  const callerEffectGrant = await createGrant();
  const noRegistryLedger = new InMemoryFinOpsCapabilityLedger();
  noRegistryLedger.register(callerEffectGrant.grant);
  const untrustedInput = {
    token: callerEffectGrant.token,
    signingSecret,
    action,
    idempotencyKey: "caller-supplied-delete",
    now: validAt,
    downstream: async () => {
      callerSuppliedEffects += 1;
      return { providerRequestId: "must-not-run", status: "DELETED" };
    },
  } as Parameters<InMemoryFinOpsCapabilityLedger["execute"]>[0] & {
    downstream: () => Promise<unknown>;
  };
  const callerEffectResult = await noRegistryLedger.execute(untrustedInput);
  count(callerEffectResult);
  assert.deepEqual(callerEffectResult, { status: "DENIED", reason: "adapter-operation-not-allowed" });
  assert.equal(callerSuppliedEffects, 0);
}

async function main() {
  await exactGrantProof();
  await denialMatrixProof();
  await concurrencyProof();
  const reconciliationVerdict = await revocationAndAmbiguityProof();
  await strictJsonAndCallerEffectProof();

  assert.ok(attempts >= 20);
  assert.equal(providerRequestBuilds, 4, "only the exact, concurrent winner, revoked reservation, and ambiguous dispatch may build requests");
  assert.equal(adapterInvocations, 3, "only the exact, concurrent winner, and ambiguous dispatch may invoke a trusted adapter");
  assert.equal(callerSuppliedEffects, 0, "execution callers cannot inject effects");
  assert.equal(executed, 2);
  assert.equal(replayed, 1);
  assert.equal(outcomeUnknown, 2);

  console.log(JSON.stringify({
    proof: "finops-capability-state-machine",
    executionBoundary: "trusted-internal-adapter-registry",
    attempts,
    executed,
    replayed,
    denied,
    outcomeUnknown,
    providerRequestBuilds,
    adapterInvocations,
    callerSuppliedEffects,
    unauthorizedAdapterInvocations: 0,
    reconciliationVerdict,
    customerData: false,
    providerCredentials: false,
    businessValidationRaised: false,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "FinOps control proof failed.");
  process.exitCode = 1;
});