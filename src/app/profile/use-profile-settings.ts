import { useEffect, useState } from "react";
import { guestAuditTransferBindingKey, guestAuditTransferKey } from "@/lib/guest-audit-transfer";
import {
  fetchConsentRecords,
  fetchPlatformTokens,
  fetchPrivacyRequests,
  fetchRenewalAlertPreference,
  fetchRetentionPolicy,
} from "./profile-api";
import type {
  ConsentRecord,
  PlatformTokenSummary,
  PrivacyRequest,
  ProfilePayload,
  ProfileStatuses,
  ProfileStatusScope,
  RenewalAlertPreference,
  RetentionPolicy,
} from "./profile-types";

const localWorkspaceStorageKey = "vognary.workspace.v1";
const initialStatuses: ProfileStatuses = {
  account: "Loading account…",
  notifications: "Loading reminder settings…",
  privacyConsent: "Loading privacy choices…",
  privacyData: "Loading export and retention controls…",
  developer: "Loading developer access…",
  danger: "",
};
export function useProfileSettings() {
  const [profile, setProfile] = useState<ProfilePayload | null>(null);
  const [statuses, setStatuses] = useState<ProfileStatuses>(initialStatuses);
  const [deleteText, setDeleteText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [consents, setConsents] = useState<ConsentRecord[]>([]);
  const [consentsAvailable, setConsentsAvailable] = useState<boolean | null>(null);
  const [consentBusy, setConsentBusy] = useState(false);
  const [platformTokens, setPlatformTokens] = useState<PlatformTokenSummary[]>([]);
  const [developerAvailable, setDeveloperAvailable] = useState<boolean | null>(null);
  const [tokenName, setTokenName] = useState("Finance automation");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [tokenBusy, setTokenBusy] = useState(false);
  const [renewalAlerts, setRenewalAlerts] = useState<RenewalAlertPreference | null>(null);
  const [renewalAlertBusy, setRenewalAlertBusy] = useState(false);
  const [retentionPolicy, setRetentionPolicy] = useState<RetentionPolicy | null>(null);
  const [privacyRequests, setPrivacyRequests] = useState<PrivacyRequest[]>([]);
  const [privacyLifecycleAvailable, setPrivacyLifecycleAvailable] = useState<boolean | null>(null);
  const [privacyBusy, setPrivacyBusy] = useState(false);

  function setStatus(scope: ProfileStatusScope, message: string) {
    setStatuses((current) => ({ ...current, [scope]: message }));
  }
  useEffect(() => {
    let cancelled = false;
    fetch("/api/profile", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) {
          setStatus("account", payload.message ?? payload.error ?? "Could not load account.");
          return;
        }
        setProfile(payload);
        setStatus("account", "Account loaded.");
      })
      .catch(() => {
        if (!cancelled) setStatus("account", "Could not load account. Check your connection and retry.");
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchRetentionPolicy(), fetchPrivacyRequests()])
      .then(([policy, requests]) => {
        if (cancelled) return;
        setRetentionPolicy(policy);
        setPrivacyRequests(requests);
        setPrivacyLifecycleAvailable(true);
        setStatus("privacyData", "Export and retention controls loaded.");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPrivacyLifecycleAvailable(false);
        setStatus("privacyData", errorMessage(error, "Export and retention controls are temporarily unavailable."));
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchRenewalAlertPreference()
      .then((preference) => {
        if (cancelled) return;
        setRenewalAlerts(preference);
        setStatus("notifications", "Reminder settings loaded.");
      })
      .catch((error: unknown) => {
        if (!cancelled) setStatus("notifications", errorMessage(error, "Reminder settings are temporarily unavailable."));
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchPlatformTokens()
      .then((tokens) => {
        if (cancelled) return;
        setPlatformTokens(tokens);
        setDeveloperAvailable(true);
        setStatus("developer", "Developer access loaded.");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setDeveloperAvailable(false);
        setStatus("developer", errorMessage(error, "Developer access is unavailable for this account."));
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchConsentRecords()
      .then((records) => {
        if (cancelled) return;
        setConsents(records);
        setConsentsAvailable(true);
        setStatus("privacyConsent", "Privacy choices loaded.");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setConsentsAvailable(false);
        setStatus("privacyConsent", errorMessage(error, "Consent history is temporarily unavailable."));
      });
    return () => { cancelled = true; };
  }, []);

  const analyticsConsent = consents.find((consent) => consent.purpose === "product-analytics-opt-in" && consent.active);
  const benchmarkConsent = consents.find((consent) => consent.purpose === "merchant-intelligence-opt-in" && consent.active);

  async function signOut() {
    setStatus("account", "Signing out…");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) {
        setStatus("account", "Could not sign out. Please retry.");
        return;
      }
      window.location.href = "/login";
    } catch {
      setStatus("account", "Could not sign out. Check your connection and retry.");
    }
  }
  async function deleteMyData() {
    if (!profile) return;
    setDeleting(true);
    setStatus("danger", "Deleting server data…");
    try {
      const response = await fetch("/api/profile", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: deleteText }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const workspaceNames = Array.isArray(payload.workspaces)
          ? ` Affected: ${payload.workspaces.map((workspace: { name?: string }) => workspace.name).filter(Boolean).join(", ")}.`
          : "";
        setStatus("danger", `${payload.error ?? "Could not delete data."}${workspaceNames}`);
        return;
      }
      window.localStorage.removeItem(localWorkspaceStorageKey);
      window.sessionStorage.removeItem(guestAuditTransferKey);
      window.sessionStorage.removeItem(guestAuditTransferBindingKey);
      const providerFollowUp = Array.isArray(payload.providerRevocations)
        ? payload.providerRevocations
          .filter((outcome: { remoteCredentialMayRemainActive?: boolean }) => outcome.remoteCredentialMayRemainActive)
          .map((outcome: { connectorId?: string; message?: string }) => `${outcome.connectorId ?? "Provider"}: ${outcome.message ?? "Revoke the credential at the provider."}`)
        : [];
      setProfile(null);
      setStatus("danger", [
        `Deleted ${payload.deletedOwnedWorkspaces ?? 0} workspace(s) and signed out.`,
        ...providerFollowUp,
        payload.backupNotice,
      ].filter(Boolean).join(" "));
    } catch {
      setStatus("danger", "Could not delete data. Check your connection and retry.");
    } finally {
      setDeleting(false);
    }
  }
  async function changeConsent(options: {
    consent: ConsentRecord | undefined;
    purpose: string;
    scopes: string[];
    enabledMessage: string;
    disabledMessage: string;
  }) {
    setConsentBusy(true);
    setStatus("privacyConsent", options.consent ? "Withdrawing consent…" : "Saving privacy choice…");
    try {
      const response = await fetch("/api/privacy/consents", {
        method: options.consent ? "DELETE" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(options.consent
          ? { id: options.consent.id }
          : { purpose: options.purpose, scopes: options.scopes }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus("privacyConsent", payload.error ?? "Could not save privacy choice.");
        return;
      }
      setConsents(await fetchConsentRecords());
      setStatus("privacyConsent", options.consent ? options.disabledMessage : options.enabledMessage);
    } catch {
      setStatus("privacyConsent", "Could not save privacy choice. Check your connection and retry.");
    } finally {
      setConsentBusy(false);
    }
  }
  const toggleAnalyticsConsent = () => changeConsent({
    consent: analyticsConsent,
    purpose: "product-analytics-opt-in",
    scopes: ["privacy-safe-product-events"],
    enabledMessage: "Privacy-safe product analytics enabled. No merchant, amount, email, note, or source payload is recorded.",
    disabledMessage: "Product analytics consent withdrawn. New product-experience events will be ignored.",
  });
  const toggleBenchmarkConsent = () => changeConsent({
    consent: benchmarkConsent,
    purpose: "merchant-intelligence-opt-in",
    scopes: ["category-currency-frequency-aggregates", "minimum-cohort-25", "per-workspace-contribution-cap-10"],
    enabledMessage: "Anonymous category benchmarks enabled. Direct identifiers and source evidence remain excluded.",
    disabledMessage: "Anonymous benchmark consent withdrawn; this workspace is excluded from future cohorts.",
  });
  async function createReadOnlyApiToken() {
    setTokenBusy(true);
    setCreatedToken(null);
    setStatus("developer", "Creating a read-only platform token…");
    try {
      const response = await fetch("/api/platform/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: tokenName, scopes: ["ledger:read", "sources:read"], expiresInDays: 90 }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus("developer", payload.error ?? "Could not create API token.");
        return;
      }
      setCreatedToken(payload.token ?? null);
      setPlatformTokens(await fetchPlatformTokens());
      setStatus("developer", "Read-only API token created. Copy it now; only its hash is stored.");
    } catch {
      setStatus("developer", "Could not create API token. Check your connection and retry.");
    } finally {
      setTokenBusy(false);
    }
  }

  async function revokeReadOnlyApiToken(id: string) {
    setTokenBusy(true);
    setStatus("developer", "Revoking platform token…");
    try {
      const response = await fetch("/api/platform/tokens", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus("developer", payload.error ?? "Could not revoke API token.");
        return;
      }
      setPlatformTokens(await fetchPlatformTokens());
      setStatus("developer", "Platform token revoked immediately.");
    } catch {
      setStatus("developer", "Could not revoke API token. Check your connection and retry.");
    } finally {
      setTokenBusy(false);
    }
  }

  async function copyCreatedToken() {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(createdToken);
      setStatus("developer", "API token copied to clipboard.");
    } catch {
      setStatus("developer", "Could not copy automatically. Select and copy the token manually.");
    }
  }

  async function saveRenewalAlerts(next: RenewalAlertPreference) {
    setRenewalAlertBusy(true);
    setStatus("notifications", next.enabled ? "Saving renewal reminders…" : "Turning renewal reminders off…");
    try {
      const response = await fetch("/api/renewal-alerts/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled: next.enabled,
          weeklyDigestEnabled: next.weeklyDigestEnabled,
          sevenDayEnabled: next.sevenDayEnabled,
          oneDayEnabled: next.oneDayEnabled,
          timeZone: next.timeZone,
          sendHourLocal: next.sendHourLocal,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus("notifications", payload.error ?? "Could not update renewal reminders.");
        return;
      }
      setRenewalAlerts(payload.preference);
      setStatus("notifications", next.enabled || next.weeklyDigestEnabled
        ? `${next.enabled ? "Renewal reminders" : "Renewal reminders remain off"}; weekly digest ${next.weeklyDigestEnabled ? "enabled" : "off"}.`
        : "Renewal reminders, weekly digest, and their active consent are disabled.");
    } catch {
      setStatus("notifications", "Could not update renewal reminders. Check your connection and retry.");
    } finally {
      setRenewalAlertBusy(false);
    }
  }

  async function saveRetentionPolicy() {
    if (!retentionPolicy) return;
    setPrivacyBusy(true);
    setStatus("privacyData", "Updating workspace retention…");
    try {
      const response = await fetch("/api/privacy/retention-policy", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rawConnectorPayloadDays: retentionPolicy.rawConnectorPayloadDays,
          productEventDays: retentionPolicy.productEventDays,
          operationalErrorDays: retentionPolicy.operationalErrorDays,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus("privacyData", payload.error ?? "Could not update retention.");
        return;
      }
      setRetentionPolicy(payload.policy);
      setStatus("privacyData", "Workspace retention policy updated. The minimization worker applies it on its next authorized run.");
    } catch {
      setStatus("privacyData", "Could not update retention. Check your connection and retry.");
    } finally {
      setPrivacyBusy(false);
    }
  }

  async function createAndDownloadPrivacyExport() {
    setPrivacyBusy(true);
    setStatus("privacyData", "Preparing a live privacy export…");
    try {
      const createResponse = await fetch("/api/privacy/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestType: "access_export" }),
      });
      const created = await createResponse.json().catch(() => ({}));
      if (!createResponse.ok || !created.request?.id) {
        setStatus("privacyData", created.error ?? "Could not create privacy export.");
        return;
      }
      const downloadResponse = await fetch(`/api/privacy/requests/${created.request.id}/download`, { method: "POST" });
      if (!downloadResponse.ok) {
        const payload = await downloadResponse.json().catch(() => ({}));
        setStatus("privacyData", payload.error ?? "Could not download privacy export.");
        return;
      }
      const blob = await downloadResponse.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "vognary-privacy-export.json";
      link.click();
      URL.revokeObjectURL(url);
      setPrivacyRequests(await fetchPrivacyRequests());
      setStatus("privacyData", "Privacy export downloaded. It was generated live and was not stored as a Vognary file.");
    } catch {
      setStatus("privacyData", "Could not download privacy export. Check your connection and retry.");
    } finally {
      setPrivacyBusy(false);
    }
  }

  return {
    profile, statuses, deleteText, deleting, setDeleteText, deleteMyData, signOut,
    consentsAvailable, analyticsConsent, benchmarkConsent, consentBusy, toggleAnalyticsConsent, toggleBenchmarkConsent,
    renewalAlerts, renewalAlertBusy, setRenewalAlerts, saveRenewalAlerts,
    developerAvailable, platformTokens, tokenName, createdToken, tokenBusy, setTokenName,
    createReadOnlyApiToken, revokeReadOnlyApiToken, copyCreatedToken,
    privacyLifecycleAvailable, retentionPolicy, privacyRequests, privacyBusy, setRetentionPolicy,
    saveRetentionPolicy, createAndDownloadPrivacyExport,
  };
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
