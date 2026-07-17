export const ledgerEventTypes = [
  "graph.baseline.created",
  "graph.materialized",
  "commitment.decision.updated",
  "action.case.created",
  "action.case.transitioned",
  "action.authorization.recorded",
  "saving.verification.updated",
  "saving.receipt.minted",
  "saving.receipt.amended",
  "workspace.type.updated",
] as const;

export type LedgerEventType = typeof ledgerEventTypes[number];

export const ledgerEntityKinds = [
  "workspace",
  "commitment",
  "source",
  "action",
  "saving",
  "graph",
] as const;

export type LedgerEntityKind = typeof ledgerEntityKinds[number];

export type LedgerEventPayloadValue = string | number | boolean | null | string[];
export type LedgerEventPayload = Record<string, LedgerEventPayloadValue>;

const payloadKeys = new Set([
  "action",
  "previousAction",
  "status",
  "previousStatus",
  "reasonCode",
  "score",
  "modelVersion",
  "proofNodeCount",
  "proofEdgeCount",
  "commitmentCount",
  "sourceCount",
  "currency",
  "monthlyDelta",
  "annualSaving",
  "cleanCycles",
  "requiredCleanCycles",
  "coverageStart",
  "coverageEnd",
  "workspaceType",
  "previousWorkspaceType",
  "authorizedAction",
  "authorizationVersion",
]);

export function normalizeLedgerEventInput(input: {
  eventType: unknown;
  entityKind: unknown;
  entityRef: unknown;
  idempotencyKey: unknown;
  payload?: unknown;
  schemaVersion?: unknown;
}) {
  if (typeof input.eventType !== "string" || !ledgerEventTypes.includes(input.eventType as LedgerEventType)) {
    throw new Error("Ledger event type is not allowlisted.");
  }
  if (typeof input.entityKind !== "string" || !ledgerEntityKinds.includes(input.entityKind as LedgerEntityKind)) {
    throw new Error("Ledger event entity kind is not allowlisted.");
  }
  const entityRef = normalizeBoundedText(input.entityRef, 240, "entity reference");
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const schemaVersion = input.schemaVersion ?? 1;
  if (!Number.isInteger(schemaVersion) || Number(schemaVersion) < 1 || Number(schemaVersion) > 1000) {
    throw new Error("Ledger event schema version is invalid.");
  }
  const rawPayload = input.payload ?? {};
  if (!isPlainObject(rawPayload)) throw new Error("Ledger event payload must be an object.");
  const payload: LedgerEventPayload = {};
  for (const [key, value] of Object.entries(rawPayload)) {
    if (!payloadKeys.has(key)) throw new Error(`Ledger event payload field ${key} is not allowlisted.`);
    payload[key] = normalizePayloadValue(value, key);
  }
  return {
    eventType: input.eventType as LedgerEventType,
    entityKind: input.entityKind as LedgerEntityKind,
    entityRef,
    idempotencyKey,
    payload,
    schemaVersion: Number(schemaVersion),
  };
}

function normalizePayloadValue(value: unknown, key: string): LedgerEventPayloadValue {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Math.abs(value) > 1_000_000_000_000) {
      throw new Error(`Ledger event payload field ${key} is not a bounded number.`);
    }
    return value;
  }
  if (typeof value === "string") return normalizeBoundedText(value, 240, `payload field ${key}`);
  if (Array.isArray(value) && value.length <= 20 && value.every((entry) => typeof entry === "string")) {
    return value.map((entry) => normalizeBoundedText(entry, 120, `payload field ${key}`));
  }
  throw new Error(`Ledger event payload field ${key} has an unsupported value.`);
}

function normalizeIdempotencyKey(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{16,160}$/.test(value)) {
    throw new Error("Ledger event idempotency key is invalid.");
  }
  return value;
}

function normalizeBoundedText(value: unknown, maxLength: number, label: string) {
  if (typeof value !== "string") throw new Error(`Ledger event ${label} is required.`);
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > maxLength) throw new Error(`Ledger event ${label} is invalid.`);
  return normalized;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
