import { createHash } from "node:crypto";

export const consentPurposes = [
  "regulated-rail-pilot-contact",
  "launch-audit-contact",
  "private-audit-contact",
  "gmail-readonly-sync",
  "receipt-inbox-ingest",
  "provider-connector-sync",
  "merchant-intelligence-opt-in",
  "product-analytics-opt-in",
  "product-research-contact",
  "renewal-alerts",
  "standing-mandate-autopilot",
] as const;

export type ConsentPurpose = typeof consentPurposes[number];

export type ConsentGrantInput = {
  workspaceId?: string | null;
  userId?: string | null;
  subjectEmail?: string | null;
  resourceKey?: string | null;
  purpose: ConsentPurpose;
  noticeVersion: string;
  source: string;
  scopes: string[] | Record<string, boolean | number | string>;
  grantedAt?: string;
  expiresAt?: string | null;
};

export function normalizeConsentGrant(input: ConsentGrantInput) {
  if (!consentPurposes.includes(input.purpose)) throw new Error("Consent purpose is not allowlisted.");
  const noticeVersion = normalizeText(input.noticeVersion, 80, "notice version");
  const source = normalizeText(input.source, 80, "source");
  const grantedAt = normalizeTimestamp(input.grantedAt ?? new Date().toISOString(), "granted at");
  const expiresAt = input.expiresAt ? normalizeTimestamp(input.expiresAt, "expiry") : null;
  if (expiresAt && Date.parse(expiresAt) < Date.parse(grantedAt)) throw new Error("Consent expiry cannot precede the grant.");

  const subjectEmail = input.subjectEmail?.trim().toLowerCase() || null;
  if (subjectEmail && !/^\S+@\S+\.\S+$/.test(subjectEmail)) throw new Error("Consent subject email is invalid.");
  const resourceKey = input.resourceKey ? normalizeText(input.resourceKey, 240, "resource key") : null;

  const scopes = Array.isArray(input.scopes)
    ? [...new Set(input.scopes.map((scope) => normalizeText(scope, 120, "scope")))].slice(0, 30)
    : Object.fromEntries(Object.entries(input.scopes).slice(0, 30).map(([key, value]) => [normalizeText(key, 120, "scope"), value]));

  return {
    workspaceId: normalizeUuid(input.workspaceId),
    userId: normalizeUuid(input.userId),
    subjectEmail,
    resourceKey,
    purpose: input.purpose,
    noticeVersion,
    source,
    scopes,
    grantedAt,
    expiresAt,
  };
}

export function buildConnectorConsentResourceKey(connectorId: string, providerAccountId: string) {
  const connector = normalizeText(connectorId, 120, "connector id");
  const accountDigest = createHash("sha256").update(providerAccountId.trim()).digest("base64url").slice(0, 24);
  return `connector:${connector}:${accountDigest}`;
}

function normalizeText(value: string, max: number, label: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(`Consent ${label} is invalid.`);
  return normalized;
}

function normalizeTimestamp(value: string, label: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Consent ${label} timestamp is invalid.`);
  return parsed.toISOString();
}

function normalizeUuid(value: string | null | undefined) {
  if (!value) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("Consent identifier must be a UUID.");
  }
  return value.toLowerCase();
}
