import type {
  ConsentRecord,
  PlatformTokenSummary,
  PrivacyRequest,
  RenewalAlertPreference,
  RetentionPolicy,
} from "./profile-types";

export async function fetchConsentRecords(): Promise<ConsentRecord[]> {
  const response = await fetch("/api/privacy/consents", { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "Consent history is unavailable.");
  if (!Array.isArray(payload.consents)) return [];
  const checkedAt = Date.now();
  return payload.consents.map((consent: Omit<ConsentRecord, "active">) => ({
    ...consent,
    active: !consent.withdrawnAt && (!consent.expiresAt || Date.parse(consent.expiresAt) > checkedAt),
  }));
}

export async function fetchPlatformTokens(): Promise<PlatformTokenSummary[]> {
  const response = await fetch("/api/platform/tokens", { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "Platform tokens are unavailable.");
  return Array.isArray(payload.tokens) ? payload.tokens : [];
}

export async function fetchRenewalAlertPreference(): Promise<RenewalAlertPreference> {
  const response = await fetch("/api/renewal-alerts/preferences", { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "Renewal alert preferences are unavailable.");
  return payload.preference as RenewalAlertPreference;
}

export async function fetchRetentionPolicy(): Promise<RetentionPolicy> {
  const response = await fetch("/api/privacy/retention-policy", { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "Retention policy is unavailable.");
  return payload.policy as RetentionPolicy;
}

export async function fetchPrivacyRequests(): Promise<PrivacyRequest[]> {
  const response = await fetch("/api/privacy/requests", { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "Privacy requests are unavailable.");
  return Array.isArray(payload.requests) ? payload.requests : [];
}
