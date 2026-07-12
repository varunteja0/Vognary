export type RetentionPolicyValues = {
  rawConnectorPayloadDays: number;
  productEventDays: number;
  operationalErrorDays: number;
};

export const retentionPolicyDefaults: Readonly<RetentionPolicyValues> = Object.freeze({
  rawConnectorPayloadDays: 30,
  productEventDays: 90,
  operationalErrorDays: 30,
});

export const retentionPolicyBounds = Object.freeze({
  rawConnectorPayloadDays: { min: 7, max: 90 },
  productEventDays: { min: 30, max: 365 },
  operationalErrorDays: { min: 7, max: 90 },
});

export type RetentionPolicyPatch = Partial<RetentionPolicyValues>;

export type RetentionExecutionOptions = {
  dryRun: boolean;
  workspaceId: string | null;
  afterWorkspaceId: string | null;
  workspaceLimit: number;
  batchSize: number;
};

export type PrivacyRequestType = "access_export";

export type PrivacyExportDocument = {
  exportVersion: 1;
  requestId: string;
  generatedAt: string;
  scope: {
    userId: string;
    workspaceId: string;
  };
  account: {
    id: string;
    email: string;
    displayName: string | null;
    createdAt: string;
    updatedAt: string;
  };
  workspace: {
    id: string;
    name: string;
    plan: string;
    role: string;
    createdAt: string;
    updatedAt: string;
  };
  retentionPolicy: RetentionPolicyValues & {
    usesWorkspaceOverride: boolean;
  };
  consents: Array<{
    id: string;
    workspaceId: string | null;
    purpose: string;
    noticeVersion: string;
    source: string;
    scopes: unknown;
    grantedAt: string;
    withdrawnAt: string | null;
    expiresAt: string | null;
  }>;
  connectedSources: PrivacyExportConnectedSource[];
  dataSources: Array<Record<string, unknown>>;
  uploadedFiles: Array<Record<string, unknown>>;
  transactions: Array<Record<string, unknown>>;
  recurringLedger: PrivacyExportRecurringItem[];
  evidence: PrivacyExportEvidence[];
  decisions: Array<Record<string, unknown>>;
  recommendations: Array<Record<string, unknown>>;
  workspaceState: {
    revision: number;
    updatedAt: string;
    state: unknown;
  } | null;
  productEvents: Array<Record<string, unknown>>;
  renewalAlertPreferences: Array<Record<string, unknown>>;
  renewalAlertDeliveries: Array<Record<string, unknown>>;
  apiTokens: Array<Record<string, unknown>>;
  billingCheckouts: Array<Record<string, unknown>>;
  entitlements: Array<Record<string, unknown>>;
  auditHistory: Array<Record<string, unknown>>;
  exclusions: string[];
};

export type PrivacyExportConnectedSource = {
  connectedAccountId: string;
  dataSourceId: string | null;
  connectorId: string;
  authType: string;
  providerAccountId: string | null;
  displayName: string;
  scopes: string[];
  status: string;
  consentExpiresAt: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
  source: {
    kind: string | null;
    provider: string | null;
    displayName: string | null;
    consentScope: string | null;
    status: string | null;
    coverageStartAt: string | null;
    coverageEndAt: string | null;
    coverageCompleteness: string | null;
    freshnessStatus: string | null;
  };
};

export type PrivacyExportRecurringItem = {
  id: string;
  merchant: string;
  normalizedMerchant: string;
  category: string;
  frequency: string;
  currency: string;
  amountMin: number;
  amountMax: number;
  averageAmount: number;
  monthlyCost: number;
  annualCost: number;
  lastChargeDate: string | null;
  nextExpectedDate: string | null;
  confidenceScore: number;
  status: string;
  recommendationReason: string | null;
  riskTags: string[];
  firstDetectedAt: string;
  updatedAt: string;
};

export type PrivacyExportEvidence = {
  id: string;
  connectedAccountId: string | null;
  dataSourceId: string | null;
  recurringItemId: string | null;
  connectorId: string;
  provider: string;
  evidenceType: string;
  observedAt: string;
  amount: number | null;
  currency: string | null;
  cadenceHint: string | null;
  nextDebitHint: string | null;
  confidenceScore: number;
  createdAt: string;
};

const policyKeys = Object.keys(retentionPolicyDefaults) as Array<keyof RetentionPolicyValues>;
const executionKeys = new Set(["dryRun", "workspaceId", "afterWorkspaceId", "workspaceLimit", "batchSize"]);
const privacyRequestKeys = new Set(["requestType"]);
const forbiddenExportKeys = new Set([
  "token",
  "accesstoken",
  "refreshtoken",
  "apikey",
  "secret",
  "password",
  "encryptedpayload",
  "payload",
  "payloadhash",
  "rawpayload",
  "rawrow",
  "storagekey",
  "keyfingerprint",
  "connectortokenrefs",
]);

export function normalizeRetentionPolicyPatch(
  input: unknown,
  current: RetentionPolicyValues = retentionPolicyDefaults,
): RetentionPolicyValues {
  const record = requireRecord(input, "Retention policy");
  rejectUnknownKeys(record, new Set(policyKeys), "retention policy");
  if (!Object.keys(record).length) throw new Error("At least one retention policy field is required.");

  const next = { ...current };
  for (const key of policyKeys) {
    if (!(key in record)) continue;
    const value = record[key];
    const bounds = retentionPolicyBounds[key];
    if (!Number.isInteger(value) || (value as number) < bounds.min || (value as number) > bounds.max) {
      throw new Error(`${key} must be an integer from ${bounds.min} to ${bounds.max}.`);
    }
    next[key] = value as number;
  }
  return next;
}

export function normalizeRetentionExecutionOptions(input: unknown): RetentionExecutionOptions {
  const record = requireRecord(input, "Retention execution request");
  rejectUnknownKeys(record, executionKeys, "retention execution request");

  if (record.dryRun !== undefined && typeof record.dryRun !== "boolean") {
    throw new Error("dryRun must be a boolean.");
  }
  const dryRun = record.dryRun ?? true;
  const workspaceId = record.workspaceId === undefined || record.workspaceId === null
    ? null
    : normalizeUuid(record.workspaceId, "workspaceId");
  const afterWorkspaceId = record.afterWorkspaceId === undefined || record.afterWorkspaceId === null
    ? null
    : normalizeUuid(record.afterWorkspaceId, "afterWorkspaceId");
  if (workspaceId && afterWorkspaceId) throw new Error("afterWorkspaceId cannot be combined with workspaceId.");
  if (afterWorkspaceId && !dryRun) throw new Error("afterWorkspaceId is supported only for dry runs.");

  return {
    dryRun,
    workspaceId,
    afterWorkspaceId,
    workspaceLimit: normalizeBoundedInteger(record.workspaceLimit, 5, 1, 10, "workspaceLimit"),
    batchSize: normalizeBoundedInteger(record.batchSize, 500, 100, 2_000, "batchSize"),
  };
}

export function normalizePrivacyRequestInput(input: unknown): { requestType: PrivacyRequestType } {
  const record = requireRecord(input, "Privacy request");
  rejectUnknownKeys(record, privacyRequestKeys, "privacy request");
  if (record.requestType !== "access_export") {
    throw new Error("requestType must be access_export.");
  }
  return { requestType: "access_export" };
}

export function assertPrivacyExportExcludesSecrets(document: unknown) {
  visit(document);
  return document;

  function visit(value: unknown) {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value)) {
      const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
      if (forbiddenExportKeys.has(normalizedKey) || normalizedKey.endsWith("accesstoken") || normalizedKey.endsWith("refreshtoken")) {
        throw new Error(`Privacy export contains forbidden field ${key}.`);
      }
      visit(entry);
    }
  }
}

export const assertPrivacyExportIsMetadataOnly = assertPrivacyExportExcludesSecrets;

export function buildPrivacyExportDocument(input: Omit<PrivacyExportDocument, "exportVersion" | "exclusions">): PrivacyExportDocument {
  const document: PrivacyExportDocument = {
    exportVersion: 1,
    ...input,
    exclusions: [
      "Authentication sessions and token hashes",
      "Connector secrets and encrypted token material",
      "Raw connector and webhook payload bodies",
      "Internal payload hashes, storage keys, and monitoring delivery details",
      "Data belonging only to other workspaces or users",
    ],
  };
  assertPrivacyExportExcludesSecrets(document);
  return document;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a JSON object.`);
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(record: Record<string, unknown>, allowed: Set<string>, label: string) {
  const unknown = Object.keys(record).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`${label} field ${unknown} is not supported.`);
}

function normalizeBoundedInteger(value: unknown, fallback: number, min: number, max: number, label: string) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}.`);
  }
  return value as number;
}

function normalizeUuid(value: unknown, label: string) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${label} must be a UUID.`);
  }
  return value.toLowerCase();
}
