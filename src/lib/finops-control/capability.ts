import { createHash } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { proposalDecisionActions, type AuthorizedProposalDecision } from "../commitment-control/decision";
import { normalizeCurrency, parsePositiveMinorUnits, requireUuid } from "../commitment-control/money";
import { reconcileAuthorizedProposal } from "../commitment-control/reconcile";

const capabilityAudience = "vognary:finops-control:v1";
const capabilityIssuer = "vognary";
const maximumLifetimeMs = 15 * 60 * 1_000;

export type FinOpsCapabilityAction = {
  workspaceId: string;
  workloadId: string;
  adapter: string;
  operation: string;
  resource: string;
  arguments: unknown;
  purpose: string;
  estimatedAmountMinor: string;
  currency: string;
};

export type FinOpsCapabilityJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly FinOpsCapabilityJsonValue[]
  | { readonly [key: string]: FinOpsCapabilityJsonValue };

export type FrozenFinOpsCapabilityAction = Readonly<Omit<FinOpsCapabilityAction, "arguments"> & {
  arguments: FinOpsCapabilityJsonValue;
}>;

export type FinOpsCapabilityGrant = Readonly<{
  grantId: string;
  proposalId: string;
  evaluationPolicyVersion: number;
  decidedByUserId: string;
  workspaceId: string;
  workloadId: string;
  adapter: string;
  operation: string;
  resource: string;
  argumentsHash: string;
  purposeHash: string;
  decisionDigest: string;
  estimatedAmountMinor: string;
  maxAmountMinor: string;
  expectedAmountMinor: string;
  currency: string;
  issuedAt: string;
  notBefore: string;
  expiresAt: string;
}>;

type AppliedAction = Readonly<{
  adapter: string;
  operation: string;
  resource: string;
  arguments: FinOpsCapabilityJsonValue;
}>;

export type FinOpsCapabilityAdapterResult = {
  providerRequestId: string;
  status: string;
  appliedAction: {
    adapter: string;
    operation: string;
    resource: string;
    arguments: unknown;
  };
  observedAmountMinor?: string;
  currency?: string;
};

type NormalizedAdapterResult = Readonly<{
  providerRequestId: string;
  status: string;
  appliedAction: AppliedAction;
  observedAmountMinor?: string;
  currency?: string;
}>;

export type TrustedFinOpsCapabilityOperation = Readonly<{
  adapter: string;
  operation: string;
  successStatuses: readonly string[];
  buildProviderRequest: (action: FrozenFinOpsCapabilityAction) => unknown | Promise<unknown>;
  invoke: (input: Readonly<{
    action: FrozenFinOpsCapabilityAction;
    providerRequest: FinOpsCapabilityJsonValue;
  }>) => Promise<FinOpsCapabilityAdapterResult>;
}>;

const trustedOperationMaps = new WeakMap<
  TrustedFinOpsCapabilityAdapterRegistry,
  ReadonlyMap<string, TrustedFinOpsCapabilityOperation>
>();

export class TrustedFinOpsCapabilityAdapterRegistry {
  constructor(operations: readonly TrustedFinOpsCapabilityOperation[]) {
    const operationMap = new Map<string, TrustedFinOpsCapabilityOperation>();
    for (const candidate of operations) {
      const adapter = normalizeText(candidate.adapter, 80, "Trusted capability adapter");
      const operation = normalizeText(candidate.operation, 120, "Trusted capability operation");
      if (typeof candidate.buildProviderRequest !== "function" || typeof candidate.invoke !== "function") {
        throw new Error("Trusted capability operations require request-builder and invoke functions.");
      }
      if (!Array.isArray(candidate.successStatuses) || candidate.successStatuses.length === 0) {
        throw new Error("Trusted capability operations require at least one success status.");
      }
      const successStatuses = Object.freeze(candidate.successStatuses.map((status) => (
        normalizeText(status, 80, "Trusted capability success status")
      )));
      const key = operationKey(adapter, operation);
      if (operationMap.has(key)) throw new Error("Trusted capability adapter operation is duplicated.");
      operationMap.set(key, Object.freeze({
        adapter,
        operation,
        successStatuses,
        buildProviderRequest: candidate.buildProviderRequest,
        invoke: candidate.invoke,
      }));
    }
    trustedOperationMaps.set(this, operationMap);
    Object.freeze(this);
  }
}

type CapabilityLogEntry = {
  event: "capability.denied" | "capability.reserved" | "capability.dispatched" | "capability.executed" | "capability.outcome_unknown";
  grantId: string | null;
  reason?: string;
};

type LedgerRecord = {
  grant: FinOpsCapabilityGrant;
  state: "ACTIVE" | "RESERVED" | "DISPATCHED" | "CONSUMED" | "REVOKED" | "OUTCOME_UNKNOWN";
  idempotencyKey: string | null;
  result: NormalizedAdapterResult | null;
  outcomeUnknownReason: OutcomeUnknownReason | null;
  inFlight: Promise<FinOpsCapabilityExecutionResult> | null;
  revokedAt: string | null;
};

type OutcomeUnknownReason = "provider-outcome-unknown" | "adapter-result-conflict";

export type FinOpsCapabilityExecutionResult =
  | { status: "EXECUTED"; result: NormalizedAdapterResult }
  | { status: "REPLAYED"; result: NormalizedAdapterResult }
  | { status: "OUTCOME_UNKNOWN"; reason: OutcomeUnknownReason }
  | { status: "DENIED"; reason: string };

export async function issueFinOpsCapability(input: {
  signingSecret: string;
  decision: AuthorizedProposalDecision;
  action: FinOpsCapabilityAction;
  grantId: string;
  issuedAt: string;
  notBefore: string;
  expiresAt: string;
}) {
  const signingKey = signingKeyFrom(input.signingSecret);
  const decision = normalizeDecisionIdentity(input.decision);
  if (decision.action === "DECLINE" || decision.approvedCapMinor === null) {
    throw new Error("A declined proposal cannot issue an economic capability.");
  }

  const action = normalizeAction(input.action);
  const approvedCap = parsePositiveMinorUnits(decision.approvedCapMinor, "Approved capability ceiling");
  const estimatedAmount = parsePositiveMinorUnits(action.estimatedAmountMinor, "Estimated action amount");
  const decisionCurrency = decision.currency;
  if (action.currency !== decisionCurrency) throw new Error("Capability action currency must match the human decision.");
  if (estimatedAmount > approvedCap) throw new Error("Capability action exceeds the human-approved ceiling.");

  const issuedAt = parseTimestamp(input.issuedAt, "Capability issued-at timestamp");
  const notBefore = parseTimestamp(input.notBefore, "Capability not-before timestamp");
  const expiresAt = parseTimestamp(input.expiresAt, "Capability expiry timestamp");
  validateGrantTimes(issuedAt, notBefore, expiresAt);

  const grant = normalizeGrant({
    grantId: requireUuid(input.grantId, "Capability grant id"),
    proposalId: decision.proposalId,
    evaluationPolicyVersion: decision.evaluationPolicyVersion,
    decidedByUserId: decision.decidedByUserId,
    workspaceId: action.workspaceId,
    workloadId: action.workloadId,
    adapter: action.adapter,
    operation: action.operation,
    resource: action.resource,
    argumentsHash: hashCanonical(action.arguments),
    purposeHash: hashText(action.purpose),
    decisionDigest: hashCanonical(decision),
    estimatedAmountMinor: estimatedAmount.toString(),
    maxAmountMinor: approvedCap.toString(),
    expectedAmountMinor: decision.expectedAmountMinor,
    currency: decisionCurrency,
    issuedAt: issuedAt.toISOString(),
    notBefore: notBefore.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });

  const token = await new SignJWT({
    version: 1,
    proposalId: grant.proposalId,
    evaluationPolicyVersion: grant.evaluationPolicyVersion,
    decidedByUserId: grant.decidedByUserId,
    workspaceId: grant.workspaceId,
    adapter: grant.adapter,
    operation: grant.operation,
    resource: grant.resource,
    argumentsHash: grant.argumentsHash,
    purposeHash: grant.purposeHash,
    decisionDigest: grant.decisionDigest,
    estimatedAmountMinor: grant.estimatedAmountMinor,
    maxAmountMinor: grant.maxAmountMinor,
    expectedAmountMinor: grant.expectedAmountMinor,
    currency: grant.currency,
    issuedAt: grant.issuedAt,
    notBefore: grant.notBefore,
    expiresAt: grant.expiresAt,
  })
    .setProtectedHeader({ alg: "HS256", typ: "vognary-finops-capability+jwt" })
    .setIssuer(capabilityIssuer)
    .setAudience(capabilityAudience)
    .setSubject(grant.workloadId)
    .setJti(grant.grantId)
    .setIssuedAt(toEpochSeconds(issuedAt))
    .setNotBefore(toEpochSeconds(notBefore))
    .setExpirationTime(toEpochSeconds(expiresAt))
    .sign(signingKey);

  return { grant, token };
}

export class InMemoryFinOpsCapabilityLedger {
  readonly #records = new Map<string, LedgerRecord>();
  readonly #registry: TrustedFinOpsCapabilityAdapterRegistry;
  readonly #log: ((entry: CapabilityLogEntry) => void) | undefined;

  constructor(input: {
    registry?: TrustedFinOpsCapabilityAdapterRegistry;
    log?: (entry: CapabilityLogEntry) => void;
  } = {}) {
    this.#registry = input.registry ?? new TrustedFinOpsCapabilityAdapterRegistry([]);
    this.#log = input.log;
  }

  register(grant: FinOpsCapabilityGrant) {
    const normalizedGrant = normalizeGrant(grant);
    if (this.#records.has(normalizedGrant.grantId)) throw new Error("Capability grant is already registered.");
    this.#records.set(normalizedGrant.grantId, {
      grant: normalizedGrant,
      state: "ACTIVE",
      idempotencyKey: null,
      result: null,
      outcomeUnknownReason: null,
      inFlight: null,
      revokedAt: null,
    });
  }

  revoke(grantId: string, revokedAt: string) {
    const record = this.#records.get(grantId);
    if (!record || record.state === "DISPATCHED" || record.state === "CONSUMED" || record.state === "OUTCOME_UNKNOWN") return false;
    record.state = "REVOKED";
    record.revokedAt = parseTimestamp(revokedAt, "Capability revocation timestamp").toISOString();
    return true;
  }

  async execute(input: {
    token?: string;
    signingSecret: string;
    action: FinOpsCapabilityAction;
    idempotencyKey: string;
    now: string;
  }): Promise<FinOpsCapabilityExecutionResult> {
    const now = parseTimestamp(input.now, "Capability execution timestamp");
    const idempotencyKey = normalizeText(input.idempotencyKey, 160, "Capability idempotency key");
    if (!input.token) return denied(this.#log, null, "missing-grant");

    let payload: Awaited<ReturnType<typeof jwtVerify>>["payload"];
    try {
      ({ payload } = await jwtVerify(input.token, signingKeyFrom(input.signingSecret), {
        algorithms: ["HS256"],
        issuer: capabilityIssuer,
        audience: capabilityAudience,
        currentDate: now,
      }));
    } catch {
      return denied(this.#log, null, "invalid-grant");
    }

    const grantId = typeof payload.jti === "string" ? payload.jti : null;
    if (!grantId) return denied(this.#log, null, "unknown-grant");
    const record = this.#records.get(grantId);
    if (!record || !tokenMatchesGrant(payload, record.grant)) return denied(this.#log, grantId, "unknown-grant");

    let action: ReturnType<typeof normalizeAction>;
    try {
      action = normalizeAction(input.action);
    } catch {
      return denied(this.#log, grantId, "invalid-action");
    }
    const actionMismatch = action.workspaceId !== record.grant.workspaceId
      || action.workloadId !== record.grant.workloadId
      || action.adapter !== record.grant.adapter
      || action.operation !== record.grant.operation
      || action.resource !== record.grant.resource
      || hashCanonical(action.arguments) !== record.grant.argumentsHash
      || hashText(action.purpose) !== record.grant.purposeHash
      || action.estimatedAmountMinor !== record.grant.estimatedAmountMinor
      || action.currency !== record.grant.currency;
    if (actionMismatch) return denied(this.#log, grantId, "action-binding-mismatch");
    if (parsePositiveMinorUnits(action.estimatedAmountMinor, "Estimated action amount") > parsePositiveMinorUnits(record.grant.maxAmountMinor, "Capability ceiling")) {
      return denied(this.#log, grantId, "amount-over-cap");
    }

    if (record.state === "CONSUMED") {
      if (record.idempotencyKey === idempotencyKey && record.result) return { status: "REPLAYED", result: cloneAdapterResult(record.result) };
      return denied(this.#log, grantId, "grant-consumed");
    }
    if (record.state === "OUTCOME_UNKNOWN") {
      const reason = record.outcomeUnknownReason ?? "provider-outcome-unknown";
      if (record.idempotencyKey === idempotencyKey) return { status: "OUTCOME_UNKNOWN", reason };
      return denied(this.#log, grantId, reason);
    }
    if (record.state === "REVOKED") return denied(this.#log, grantId, "grant-revoked");
    if (record.state === "RESERVED" || record.state === "DISPATCHED") {
      if (record.idempotencyKey !== idempotencyKey || !record.inFlight) return denied(this.#log, grantId, "grant-in-use");
      const settled = await record.inFlight;
      return settled.status === "EXECUTED"
        ? { status: "REPLAYED", result: cloneAdapterResult(settled.result) }
        : cloneExecutionResult(settled);
    }

    const trustedOperation = resolveTrustedOperation(this.#registry, record.grant.adapter, record.grant.operation);
    if (!trustedOperation) return denied(this.#log, grantId, "adapter-operation-not-allowed");

    record.state = "RESERVED";
    record.idempotencyKey = idempotencyKey;
    const inFlight = Promise.resolve()
      .then(() => this.#dispatch(record, action, trustedOperation))
      .finally(() => {
        if (record.inFlight === inFlight) record.inFlight = null;
      });
    record.inFlight = inFlight;
    return inFlight;
  }

  async #dispatch(
    record: LedgerRecord,
    action: FrozenFinOpsCapabilityAction,
    trustedOperation: TrustedFinOpsCapabilityOperation,
  ): Promise<FinOpsCapabilityExecutionResult> {
    const grantId = record.grant.grantId;
    if (!emitLog(this.#log, { event: "capability.reserved", grantId })) {
      resetUndispatchedRecord(record);
      return denied(this.#log, grantId, "audit-log-unavailable");
    }

    let providerRequest: FinOpsCapabilityJsonValue;
    try {
      providerRequest = normalizeJsonValue(await trustedOperation.buildProviderRequest(action));
    } catch {
      if (record.state === "REVOKED") return denied(this.#log, grantId, "grant-revoked");
      resetUndispatchedRecord(record);
      return denied(this.#log, grantId, "provider-request-build-failed");
    }

    if (record.state === "REVOKED") return denied(this.#log, grantId, "grant-revoked");
    if (record.state !== "RESERVED") return denied(this.#log, grantId, "grant-not-dispatchable");
    record.state = "DISPATCHED";
    if (!emitLog(this.#log, { event: "capability.dispatched", grantId })) {
      resetUndispatchedRecord(record);
      return denied(this.#log, grantId, "audit-log-unavailable");
    }

    let rawResult: FinOpsCapabilityAdapterResult;
    try {
      rawResult = await trustedOperation.invoke(Object.freeze({ action, providerRequest }));
    } catch {
      return markOutcomeUnknown(record, this.#log, "provider-outcome-unknown");
    }

    let result: NormalizedAdapterResult;
    try {
      result = normalizeAdapterResult(rawResult);
    } catch {
      return markOutcomeUnknown(record, this.#log, "adapter-result-conflict");
    }
    if (!trustedOperation.successStatuses.includes(result.status) || !adapterResultMatchesAction(result, action)) {
      return markOutcomeUnknown(record, this.#log, "adapter-result-conflict");
    }

    record.result = result;
    record.state = "CONSUMED";
    emitLog(this.#log, { event: "capability.executed", grantId });
    return { status: "EXECUTED", result: cloneAdapterResult(result) };
  }
}

export function reconcileFinOpsCapabilityOutcome(input: {
  grant: FinOpsCapabilityGrant;
  decision: AuthorizedProposalDecision;
  evidence: { evidenceId: string; amountMinor: string | null; currency: string | null };
}) {
  const grant = normalizeGrant(input.grant);
  const decision = normalizeDecisionIdentity(input.decision);
  if (grant.proposalId !== decision.proposalId) throw new Error("Capability and decision proposal ids do not match.");
  if (grant.evaluationPolicyVersion !== decision.evaluationPolicyVersion) throw new Error("Capability policy version does not match the frozen human decision.");
  if (grant.decidedByUserId !== decision.decidedByUserId) throw new Error("Capability decision actor does not match the frozen human decision.");
  if (grant.expectedAmountMinor !== decision.expectedAmountMinor) throw new Error("Capability expected amount does not match the frozen human decision.");
  if (grant.maxAmountMinor !== decision.approvedCapMinor) throw new Error("Capability ceiling does not match the frozen human authorization.");
  if (grant.currency !== decision.currency) throw new Error("Capability currency does not match the frozen human authorization.");
  if (grant.decisionDigest !== hashCanonical(decision)) throw new Error("Capability decision identity does not match the frozen human decision.");
  return reconcileAuthorizedProposal({ decision: input.decision, evidence: input.evidence });
}

function tokenMatchesGrant(payload: Awaited<ReturnType<typeof jwtVerify>>["payload"], grant: FinOpsCapabilityGrant) {
  try {
    return payload.sub === grant.workloadId
      && payload.proposalId === grant.proposalId
      && payload.evaluationPolicyVersion === grant.evaluationPolicyVersion
      && payload.decidedByUserId === grant.decidedByUserId
      && payload.workspaceId === grant.workspaceId
      && payload.adapter === grant.adapter
      && payload.operation === grant.operation
      && payload.resource === grant.resource
      && payload.argumentsHash === grant.argumentsHash
      && payload.purposeHash === grant.purposeHash
      && payload.decisionDigest === grant.decisionDigest
      && payload.estimatedAmountMinor === grant.estimatedAmountMinor
      && payload.maxAmountMinor === grant.maxAmountMinor
      && payload.expectedAmountMinor === grant.expectedAmountMinor
      && payload.currency === grant.currency
      && payload.issuedAt === grant.issuedAt
      && payload.notBefore === grant.notBefore
      && payload.expiresAt === grant.expiresAt
      && payload.iat === toEpochSeconds(parseTimestamp(grant.issuedAt, "Registered capability issued-at timestamp"))
      && payload.nbf === toEpochSeconds(parseTimestamp(grant.notBefore, "Registered capability not-before timestamp"))
      && payload.exp === toEpochSeconds(parseTimestamp(grant.expiresAt, "Registered capability expiry timestamp"));
  } catch {
    return false;
  }
}

function normalizeAction(action: FinOpsCapabilityAction) {
  const currency = normalizeCurrency(action.currency, "Capability action currency");
  return Object.freeze({
    workspaceId: requireUuid(action.workspaceId, "Capability workspace id"),
    workloadId: normalizeText(action.workloadId, 180, "Capability workload id"),
    adapter: normalizeText(action.adapter, 80, "Capability adapter"),
    operation: normalizeText(action.operation, 120, "Capability operation"),
    resource: normalizeText(action.resource, 240, "Capability resource"),
    arguments: normalizeJsonValue(action.arguments),
    purpose: normalizeText(action.purpose, 500, "Capability purpose"),
    estimatedAmountMinor: parsePositiveMinorUnits(action.estimatedAmountMinor, "Estimated action amount").toString(),
    currency,
  });
}

function normalizeAdapterResult(result: FinOpsCapabilityAdapterResult): NormalizedAdapterResult {
  const normalized: {
    providerRequestId: string;
    status: string;
    appliedAction: AppliedAction;
    observedAmountMinor?: string;
    currency?: string;
  } = {
    providerRequestId: normalizeText(result.providerRequestId, 200, "Provider request id"),
    status: normalizeText(result.status, 80, "Provider status"),
    appliedAction: Object.freeze({
      adapter: normalizeText(result.appliedAction.adapter, 80, "Applied adapter"),
      operation: normalizeText(result.appliedAction.operation, 120, "Applied operation"),
      resource: normalizeText(result.appliedAction.resource, 240, "Applied resource"),
      arguments: normalizeJsonValue(result.appliedAction.arguments),
    }),
  };
  if (result.observedAmountMinor !== undefined) normalized.observedAmountMinor = parsePositiveMinorUnits(result.observedAmountMinor, "Observed provider amount").toString();
  if (result.currency !== undefined) normalized.currency = normalizeCurrency(result.currency, "Observed provider currency");
  return Object.freeze(normalized);
}

function normalizeDecisionIdentity(decision: AuthorizedProposalDecision) {
  const data = requirePlainDataRecord(decision, "Capability decision");
  requireExactKeys(data, [
    "proposalId",
    "evaluationPolicyVersion",
    "action",
    "approvedCapMinor",
    "currency",
    "expectedAmountMinor",
    "decidedByUserId",
    "decidedAt",
    "overrideReason",
  ], "Capability decision");
  const action = requireString(data.action, "Capability decision action");
  if (!proposalDecisionActions.includes(action as AuthorizedProposalDecision["action"])) {
    throw new Error("Capability decision action is not supported.");
  }
  const approvedCapMinor = data.approvedCapMinor === null
    ? null
    : parsePositiveMinorUnits(requireString(data.approvedCapMinor, "Approved capability ceiling"), "Approved capability ceiling").toString();
  const actorId = requireString(data.decidedByUserId, "Capability decision actor id");
  const overrideReason = data.overrideReason === null
    ? null
    : normalizeText(requireString(data.overrideReason, "Capability override reason"), 500, "Capability override reason");
  return Object.freeze({
    proposalId: requireUuid(requireString(data.proposalId, "Capability proposal id"), "Capability proposal id"),
    evaluationPolicyVersion: normalizePolicyVersion(data.evaluationPolicyVersion),
    action: action as AuthorizedProposalDecision["action"],
    approvedCapMinor,
    currency: normalizeCurrency(requireString(data.currency, "Decision currency"), "Decision currency"),
    expectedAmountMinor: parsePositiveMinorUnits(requireString(data.expectedAmountMinor, "Expected proposal amount"), "Expected proposal amount").toString(),
    decidedByUserId: requireUuid(actorId, "Capability decision actor id"),
    decidedAt: parseTimestamp(requireString(data.decidedAt, "Decision timestamp"), "Decision timestamp").toISOString(),
    overrideReason,
  });
}

function normalizeGrant(grant: FinOpsCapabilityGrant): FinOpsCapabilityGrant {
  const data = requirePlainDataRecord(grant, "Capability grant");
  requireExactKeys(data, [
    "grantId",
    "proposalId",
    "evaluationPolicyVersion",
    "decidedByUserId",
    "workspaceId",
    "workloadId",
    "adapter",
    "operation",
    "resource",
    "argumentsHash",
    "purposeHash",
    "decisionDigest",
    "estimatedAmountMinor",
    "maxAmountMinor",
    "expectedAmountMinor",
    "currency",
    "issuedAt",
    "notBefore",
    "expiresAt",
  ], "Capability grant");
  const issuedAt = parseCanonicalTimestamp(data.issuedAt, "Capability issued-at timestamp");
  const notBefore = parseCanonicalTimestamp(data.notBefore, "Capability not-before timestamp");
  const expiresAt = parseCanonicalTimestamp(data.expiresAt, "Capability expiry timestamp");
  validateGrantTimes(issuedAt, notBefore, expiresAt);
  const estimatedAmountMinor = parsePositiveMinorUnits(requireString(data.estimatedAmountMinor, "Estimated action amount"), "Estimated action amount");
  const maxAmountMinor = parsePositiveMinorUnits(requireString(data.maxAmountMinor, "Capability ceiling"), "Capability ceiling");
  if (estimatedAmountMinor > maxAmountMinor) throw new Error("Capability action exceeds the human-approved ceiling.");
  return Object.freeze({
    grantId: requireUuid(requireString(data.grantId, "Capability grant id"), "Capability grant id"),
    proposalId: requireUuid(requireString(data.proposalId, "Capability proposal id"), "Capability proposal id"),
    evaluationPolicyVersion: normalizePolicyVersion(data.evaluationPolicyVersion),
    decidedByUserId: requireUuid(requireString(data.decidedByUserId, "Capability decision actor id"), "Capability decision actor id"),
    workspaceId: requireUuid(requireString(data.workspaceId, "Capability workspace id"), "Capability workspace id"),
    workloadId: requireCanonicalText(data.workloadId, 180, "Capability workload id"),
    adapter: requireCanonicalText(data.adapter, 80, "Capability adapter"),
    operation: requireCanonicalText(data.operation, 120, "Capability operation"),
    resource: requireCanonicalText(data.resource, 240, "Capability resource"),
    argumentsHash: requireSha256Digest(data.argumentsHash, "Capability arguments digest"),
    purposeHash: requireSha256Digest(data.purposeHash, "Capability purpose digest"),
    decisionDigest: requireSha256Digest(data.decisionDigest, "Capability decision digest"),
    estimatedAmountMinor: estimatedAmountMinor.toString(),
    maxAmountMinor: maxAmountMinor.toString(),
    expectedAmountMinor: parsePositiveMinorUnits(requireString(data.expectedAmountMinor, "Expected proposal amount"), "Expected proposal amount").toString(),
    currency: normalizeCurrency(requireString(data.currency, "Capability currency"), "Capability currency"),
    issuedAt: issuedAt.toISOString(),
    notBefore: notBefore.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
}

function resolveTrustedOperation(
  registry: TrustedFinOpsCapabilityAdapterRegistry,
  adapter: string,
  operation: string,
) {
  return trustedOperationMaps.get(registry)?.get(operationKey(adapter, operation)) ?? null;
}

function operationKey(adapter: string, operation: string) {
  return `${adapter}\u0000${operation}`;
}

function adapterResultMatchesAction(result: NormalizedAdapterResult, action: FrozenFinOpsCapabilityAction) {
  return result.appliedAction.adapter === action.adapter
    && result.appliedAction.operation === action.operation
    && result.appliedAction.resource === action.resource
    && hashCanonical(result.appliedAction.arguments) === hashCanonical(action.arguments);
}

function markOutcomeUnknown(
  record: LedgerRecord,
  log: ((entry: CapabilityLogEntry) => void) | undefined,
  reason: OutcomeUnknownReason,
): FinOpsCapabilityExecutionResult {
  record.state = "OUTCOME_UNKNOWN";
  record.outcomeUnknownReason = reason;
  emitLog(log, { event: "capability.outcome_unknown", grantId: record.grant.grantId, reason });
  return { status: "OUTCOME_UNKNOWN", reason };
}

function resetUndispatchedRecord(record: LedgerRecord) {
  record.state = "ACTIVE";
  record.idempotencyKey = null;
  record.result = null;
  record.outcomeUnknownReason = null;
}

function cloneAdapterResult(result: NormalizedAdapterResult): NormalizedAdapterResult {
  return structuredClone(result);
}

function cloneExecutionResult(result: FinOpsCapabilityExecutionResult): FinOpsCapabilityExecutionResult {
  return result.status === "EXECUTED" || result.status === "REPLAYED"
    ? { status: result.status, result: cloneAdapterResult(result.result) }
    : { ...result };
}

function denied(log: ((entry: CapabilityLogEntry) => void) | undefined, grantId: string | null, reason: string) {
  emitLog(log, { event: "capability.denied", grantId, reason });
  return { status: "DENIED" as const, reason };
}

function emitLog(log: ((entry: CapabilityLogEntry) => void) | undefined, entry: CapabilityLogEntry) {
  try {
    log?.(entry);
    return true;
  } catch {
    return false;
  }
}

function signingKeyFrom(secret: string) {
  const bytes = new TextEncoder().encode(secret);
  if (bytes.byteLength < 32) throw new Error("Capability signing secret must be at least 32 bytes.");
  return bytes;
}

function parseTimestamp(value: string, label: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} is invalid.`);
  return parsed;
}

function parseCanonicalTimestamp(value: unknown, label: string) {
  const text = requireString(value, label);
  const parsed = parseTimestamp(text, label);
  if (parsed.toISOString() !== text) throw new Error(`${label} must use canonical ISO-8601 form.`);
  return parsed;
}

function validateGrantTimes(issuedAt: Date, notBefore: Date, expiresAt: Date) {
  if (notBefore.getTime() < issuedAt.getTime()) throw new Error("Capability cannot become valid before it is issued.");
  if (expiresAt.getTime() <= notBefore.getTime()) throw new Error("Capability expiry must follow its not-before timestamp.");
  if (expiresAt.getTime() - issuedAt.getTime() > maximumLifetimeMs) throw new Error("Capability lifetime cannot exceed 15 minutes.");
}

function normalizeText(value: string, maximumLength: number, label: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > maximumLength) throw new Error(`${label} must be 1 to ${maximumLength} characters.`);
  return normalized;
}

function hashText(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

function hashCanonical(value: unknown) {
  return hashText(canonicalize(normalizeJsonValue(value)));
}

function canonicalize(value: FinOpsCapabilityJsonValue): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  const object = value as { readonly [key: string]: FinOpsCapabilityJsonValue };
  const entries = Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(object[key]!)}`);
  return `{${entries.join(",")}}`;
}

function normalizeJsonValue(value: unknown, seen = new Set<object>()): FinOpsCapabilityJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Capability arguments must use finite JSON numbers.");
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") throw new Error("Capability arguments must be JSON-compatible.");
  if (seen.has(value)) throw new Error("Capability arguments cannot contain cycles.");
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) throw new Error("Capability arguments must use plain JSON arrays.");
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.some((key) => typeof key === "symbol")) throw new Error("Capability arguments cannot contain symbol keys.");
      const allowedKeys = new Set(["length", ...Array.from({ length: value.length }, (_, index) => String(index))]);
      if (ownKeys.some((key) => !allowedKeys.has(key as string))) throw new Error("Capability arrays cannot contain non-index properties.");
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const normalized: FinOpsCapabilityJsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor) throw new Error("Capability arguments cannot contain sparse arrays.");
        if (!("value" in descriptor) || !descriptor.enumerable) throw new Error("Capability arguments cannot contain accessors or hidden values.");
        normalized.push(normalizeJsonValue(descriptor.value, seen));
      }
      return Object.freeze(normalized);
    }

    const object = requirePlainDataRecord(value, "Capability arguments");
    const normalized: Record<string, FinOpsCapabilityJsonValue> = {};
    for (const key of Object.keys(object).sort()) {
      Object.defineProperty(normalized, key, {
        value: normalizeJsonValue(object[key], seen),
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return Object.freeze(normalized);
  } finally {
    seen.delete(value);
  }
}

function requirePlainDataRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must use plain JSON objects.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} must use plain JSON objects.`);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key === "symbol")) throw new Error(`${label} cannot contain symbol keys.`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const record: Record<string, unknown> = {};
  for (const key of ownKeys as string[]) {
    const descriptor = descriptors[key]!;
    if (!("value" in descriptor) || !descriptor.enumerable) throw new Error(`${label} cannot contain accessors or hidden values.`);
    Object.defineProperty(record, key, {
      value: descriptor.value,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return record;
}

function requireExactKeys(record: Record<string, unknown>, expectedKeys: readonly string[], label: string) {
  const actualKeys = Object.keys(record).sort();
  const expected = [...expectedKeys].sort();
  if (actualKeys.length !== expected.length || actualKeys.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} fields are malformed.`);
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  return value;
}

function requireCanonicalText(value: unknown, maximumLength: number, label: string) {
  const text = requireString(value, label);
  const normalized = normalizeText(text, maximumLength, label);
  if (normalized !== text) throw new Error(`${label} must already be normalized.`);
  return normalized;
}

function requireSha256Digest(value: unknown, label: string) {
  const digest = requireString(value, label);
  if (!/^[A-Za-z0-9_-]{43}$/.test(digest)) throw new Error(`${label} is malformed.`);
  return digest;
}

function normalizePolicyVersion(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error("Capability policy version must be a positive safe integer.");
  return value as number;
}

function toEpochSeconds(value: Date) {
  return Math.floor(value.getTime() / 1_000);
}