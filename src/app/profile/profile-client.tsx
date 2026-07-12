"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { VognaryMark } from "../brand";

type ProfilePayload = {
  status: "ok";
  session: {
    email: string;
    workspaceId: string | null;
    issuedAt: string;
    expiresAt: string;
  };
  user: null | {
    id: string;
    email: string;
    displayName: string | null;
    createdAt: string;
    updatedAt: string;
  };
  activeWorkspace: null | {
    workspaceId: string;
    workspaceName: string;
    role: string;
    plan: string;
  };
  workspaces: Array<{
    workspaceId: string;
    workspaceName: string;
    role: string;
    plan: string;
  }>;
  data: {
    auditReports: number;
    dataSources: number;
    connectedAccounts: number;
    uploadedFiles: number;
    transactions: number;
    recurringItems: number;
    connectorEvidence: number;
    usageObservations: number;
    latestSnapshotAt: string | null;
    latestSummary: Record<string, unknown> | null;
  };
  integrations: {
    connectedNow: string[];
    pending: string[];
    connectorSummary: Record<string, number>;
    tokenVault: string;
  };
  deleteConfirmation: string;
};

type ConsentRecord = {
  id: string;
  purpose: string;
  noticeVersion: string;
  source: string;
  scopes: unknown;
  grantedAt: string;
  withdrawnAt: string | null;
  expiresAt: string | null;
  active: boolean;
};

type PlatformTokenSummary = {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

type RenewalAlertPreference = {
  enabled: boolean;
  sevenDayEnabled: boolean;
  oneDayEnabled: boolean;
  timeZone: string;
  sendHourLocal: number;
  consentActive?: boolean;
  disabledReason?: string | null;
};

type RetentionPolicy = {
  workspaceId: string;
  rawConnectorPayloadDays: number;
  productEventDays: number;
  operationalErrorDays: number;
  usesWorkspaceOverride: boolean;
  updatedAt: string | null;
};

type PrivacyRequest = {
  id: string;
  requestType: "access_export";
  status: "ready" | "completed" | "failed" | "expired";
  requestedAt: string;
  downloadExpiresAt: string;
  downloadCount: number;
};

const localWorkspaceStorageKey = "vognary.workspace.v1";

export default function ProfileClient() {
  const [profile, setProfile] = useState<ProfilePayload | null>(null);
  const [status, setStatus] = useState("Loading profile...");
  const [deleteText, setDeleteText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [consents, setConsents] = useState<ConsentRecord[]>([]);
  const [consentBusy, setConsentBusy] = useState(false);
  const [platformTokens, setPlatformTokens] = useState<PlatformTokenSummary[]>([]);
  const [tokenName, setTokenName] = useState("Finance automation");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [tokenBusy, setTokenBusy] = useState(false);
  const [renewalAlerts, setRenewalAlerts] = useState<RenewalAlertPreference | null>(null);
  const [renewalAlertBusy, setRenewalAlertBusy] = useState(false);
  const [retentionPolicy, setRetentionPolicy] = useState<RetentionPolicy | null>(null);
  const [privacyRequests, setPrivacyRequests] = useState<PrivacyRequest[]>([]);
  const [privacyBusy, setPrivacyBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/profile", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          setStatus(payload.message ?? payload.error ?? "Could not load profile.");
          return;
        }
        setProfile(payload);
        setStatus("Profile loaded.");
      })
      .catch(() => {
        if (!cancelled) setStatus("Could not load profile.");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchRetentionPolicy(), fetchPrivacyRequests()]).then(([policy, requests]) => {
      if (cancelled) return;
      setRetentionPolicy(policy);
      setPrivacyRequests(requests);
    }).catch(() => {
      // Privacy lifecycle controls appear after their migration is active.
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchRenewalAlertPreference().then((preference) => {
      if (!cancelled) setRenewalAlerts(preference);
    }).catch(() => {
      // The preference panel remains unavailable until its migration/env exist.
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchPlatformTokens().then((tokens) => {
      if (!cancelled) setPlatformTokens(tokens);
    }).catch(() => {
      // Token management is admin-only; non-admin profiles keep this hidden.
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchConsentRecords().then((records) => {
      if (!cancelled) setConsents(records);
    }).catch(() => {
      if (!cancelled) setStatus("Profile loaded, but consent history is temporarily unavailable.");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const analyticsConsent = consents.find((consent) => consent.purpose === "product-analytics-opt-in"
    && consent.active);
  const benchmarkConsent = consents.find((consent) => consent.purpose === "merchant-intelligence-opt-in"
    && consent.active);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  async function deleteMyData() {
    if (!profile) return;
    setDeleting(true);
    setStatus("Deleting server data...");
    const response = await fetch("/api/profile", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: deleteText }),
    });
    const payload = await response.json();
    if (!response.ok) {
      const workspaceNames = Array.isArray(payload.workspaces)
        ? ` Affected: ${payload.workspaces.map((workspace: { name?: string }) => workspace.name).filter(Boolean).join(", ")}.`
        : "";
      setStatus(`${payload.error ?? "Could not delete data."}${workspaceNames}`);
      setDeleting(false);
      return;
    }
    window.localStorage.removeItem(localWorkspaceStorageKey);
    const providerFollowUp = Array.isArray(payload.providerRevocations)
      ? payload.providerRevocations
        .filter((outcome: { remoteCredentialMayRemainActive?: boolean }) => outcome.remoteCredentialMayRemainActive)
        .map((outcome: { connectorId?: string; message?: string }) => `${outcome.connectorId ?? "Provider"}: ${outcome.message ?? "Revoke the credential at the provider."}`)
      : [];
    setProfile(null);
    setDeleting(false);
    setStatus([
      `Deleted ${payload.deletedOwnedWorkspaces ?? 0} workspace(s) and signed out.`,
      ...providerFollowUp,
      payload.backupNotice,
    ].filter(Boolean).join(" "));
  }

  async function enablePrivacySafeAnalytics() {
    setConsentBusy(true);
    setStatus("Saving analytics choice...");
    try {
      const response = await fetch("/api/privacy/consents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          purpose: "product-analytics-opt-in",
          scopes: ["privacy-safe-product-events"],
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(payload.error ?? "Could not save analytics choice.");
        return;
      }
      setConsents(await fetchConsentRecords());
      setStatus("Privacy-safe product analytics enabled. No merchant, amount, email, note, or source payload is recorded in these events.");
    } finally {
      setConsentBusy(false);
    }
  }

  async function disablePrivacySafeAnalytics() {
    if (!analyticsConsent) return;
    setConsentBusy(true);
    setStatus("Withdrawing analytics consent...");
    try {
      const response = await fetch("/api/privacy/consents", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: analyticsConsent.id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(payload.error ?? "Could not withdraw analytics consent.");
        return;
      }
      setConsents(await fetchConsentRecords());
      setStatus("Product analytics consent withdrawn. New product-experience events will be ignored.");
    } finally {
      setConsentBusy(false);
    }
  }

  async function enableAnonymousBenchmarks() {
    setConsentBusy(true);
    setStatus("Saving benchmark choice...");
    try {
      const response = await fetch("/api/privacy/consents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          purpose: "merchant-intelligence-opt-in",
          scopes: ["category-currency-frequency-aggregates", "minimum-cohort-25", "per-workspace-contribution-cap-10"],
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(payload.error ?? "Could not save benchmark choice.");
        return;
      }
      setConsents(await fetchConsentRecords());
      setStatus("Anonymous category benchmarks enabled. Merchant, user, workspace, date, evidence, notes, and provider-account dimensions are excluded.");
    } finally {
      setConsentBusy(false);
    }
  }

  async function disableAnonymousBenchmarks() {
    if (!benchmarkConsent) return;
    setConsentBusy(true);
    setStatus("Withdrawing benchmark consent...");
    try {
      const response = await fetch("/api/privacy/consents", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: benchmarkConsent.id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(payload.error ?? "Could not withdraw benchmark consent.");
        return;
      }
      setConsents(await fetchConsentRecords());
      setStatus("Anonymous benchmark consent withdrawn; this workspace is excluded from future cohorts.");
    } finally {
      setConsentBusy(false);
    }
  }

  async function createReadOnlyApiToken() {
    setTokenBusy(true);
    setCreatedToken(null);
    setStatus("Creating a read-only platform token...");
    try {
      const response = await fetch("/api/platform/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: tokenName, scopes: ["ledger:read", "sources:read"], expiresInDays: 90 }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(payload.error ?? "Could not create API token.");
        return;
      }
      setCreatedToken(payload.token ?? null);
      setPlatformTokens(await fetchPlatformTokens());
      setStatus("Read-only API token created. Copy it now; only its hash is stored.");
    } finally {
      setTokenBusy(false);
    }
  }

  async function revokeReadOnlyApiToken(id: string) {
    setTokenBusy(true);
    setStatus("Revoking platform token...");
    try {
      const response = await fetch("/api/platform/tokens", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(payload.error ?? "Could not revoke API token.");
        return;
      }
      setPlatformTokens(await fetchPlatformTokens());
      setStatus("Platform token revoked immediately.");
    } finally {
      setTokenBusy(false);
    }
  }

  async function saveRenewalAlerts(next: RenewalAlertPreference) {
    setRenewalAlertBusy(true);
    setStatus(next.enabled ? "Enabling renewal reminders..." : "Turning renewal reminders off...");
    try {
      const response = await fetch("/api/renewal-alerts/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled: next.enabled,
          sevenDayEnabled: next.sevenDayEnabled,
          oneDayEnabled: next.oneDayEnabled,
          timeZone: next.timeZone,
          sendHourLocal: next.sendHourLocal,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(payload.error ?? "Could not update renewal reminders.");
        return;
      }
      setRenewalAlerts(payload.preference);
      setStatus(next.enabled
        ? "Renewal reminders enabled with explicit consent. Vognary will email only the selected 7-day/1-day windows."
        : "Renewal reminders and their active consent are disabled.");
    } finally {
      setRenewalAlertBusy(false);
    }
  }

  async function saveRetentionPolicy() {
    if (!retentionPolicy) return;
    setPrivacyBusy(true);
    setStatus("Updating workspace retention...");
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
        setStatus(payload.error ?? "Could not update retention.");
        return;
      }
      setRetentionPolicy(payload.policy);
      setStatus("Workspace retention policy updated. The internal minimization worker applies it on its next authorized run.");
    } finally {
      setPrivacyBusy(false);
    }
  }

  async function createAndDownloadPrivacyExport() {
    setPrivacyBusy(true);
    setStatus("Preparing a live privacy export...");
    try {
      const createResponse = await fetch("/api/privacy/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestType: "access_export" }),
      });
      const created = await createResponse.json().catch(() => ({}));
      if (!createResponse.ok || !created.request?.id) {
        setStatus(created.error ?? "Could not create privacy export.");
        return;
      }
      const downloadResponse = await fetch(`/api/privacy/requests/${created.request.id}/download`, { method: "POST" });
      if (!downloadResponse.ok) {
        const payload = await downloadResponse.json().catch(() => ({}));
        setStatus(payload.error ?? "Could not download privacy export.");
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
      setStatus("Privacy export downloaded. It was generated live and was not stored as a file artifact on Vognary.");
    } finally {
      setPrivacyBusy(false);
    }
  }

  return (
    <main id="ledger-main" className="relative px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="inline-flex items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
            <VognaryMark size={22} />
            Vognary
          </Link>
          <div className="flex flex-wrap gap-2">
            <Link href="/app" className="btn btn-primary">Audit workspace</Link>
            <Link href="/private-audit" className="btn btn-ghost">Private audit</Link>
            <button type="button" onClick={signOut} className="btn btn-ghost">Sign out</button>
          </div>
        </div>

        <section className="grid gap-5 lg:grid-cols-[0.82fr_1.18fr]">
          <aside className="dossier spotlight scan p-7 sm:p-9 rise">
            <span className="folio" data-folio="ID" style={{ color: "var(--dossier-muted)" }}>Profile</span>
            <h1 className="mt-5 font-display text-4xl font-bold leading-none tracking-[-0.03em] text-(--dossier-ink) sm:text-6xl">Your account,<br /><span className="glow-num">your data.</span></h1>
            <p className="mt-5 max-w-2xl text-base leading-7 muted-on-dark">See where you are signed in, what Vognary has stored, which integrations are active, and what still needs real provider access.</p>
            <div className="mt-8 rounded-[11px] border p-4" style={{ borderColor: "var(--dossier-line)", background: "rgba(243,234,214,0.04)" }}>
              <h2 className="font-display text-lg font-semibold text-(--dossier-ink)">Current identity</h2>
              <p className="mt-2 text-sm leading-6 muted-on-dark">{profile?.session.email ?? "Loading..."}</p>
              <p className="mt-1 text-xs leading-5 muted-on-dark">Session expires: {profile ? new Date(profile.session.expiresAt).toLocaleString("en-IN") : "checking"}</p>
            </div>
          </aside>

          <div className="grid gap-5">
            <section className="panel p-5 sm:p-6">
              <SectionTitle label="Workspace" title={profile?.activeWorkspace?.workspaceName ?? "Vognary Workspace"} />
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <Info label="Plan" value={profile?.activeWorkspace?.plan ?? "private_beta"} />
                <Info label="Role" value={profile?.activeWorkspace?.role ?? "owner"} />
                <Info label="Workspace ID" value={profile?.activeWorkspace?.workspaceId ?? "not loaded"} mono />
              </div>
            </section>

            <section className="panel p-5 sm:p-6">
              <SectionTitle label="Stored data" title="What Vognary currently has" />
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="Synced state" value={profile?.data.auditReports ?? 0} />
                <Metric label="Connected accounts" value={profile?.data.connectedAccounts ?? 0} />
                <Metric label="Server sources" value={profile?.data.dataSources ?? 0} />
                <Metric label="Uploaded files" value={profile?.data.uploadedFiles ?? 0} />
                <Metric label="Transactions" value={profile?.data.transactions ?? 0} />
                <Metric label="Recurring items" value={profile?.data.recurringItems ?? 0} />
                <Metric label="Connector evidence" value={profile?.data.connectorEvidence ?? 0} />
                <Metric label="Usage observations" value={profile?.data.usageObservations ?? 0} />
              </div>
              <p className="mt-4 text-sm leading-6 text-(--muted)">Latest encrypted workspace sync: {profile?.data.latestSnapshotAt ? new Date(profile.data.latestSnapshotAt).toLocaleString("en-IN") : "none yet"}</p>
            </section>

            <section className="grid gap-5 lg:grid-cols-2">
              <div className="panel p-5 sm:p-6">
                <SectionTitle label="Integrated now" title="Active surfaces" />
                <ul className="mt-4 grid gap-2 text-sm leading-6 text-(--muted)">
                  {(profile?.integrations.connectedNow.length ? profile.integrations.connectedNow : ["Google/private beta identity only"]).map((item) => <li key={item} className="inset px-3 py-2">{item}</li>)}
                </ul>
              </div>
              <div className="panel p-5 sm:p-6">
                <SectionTitle label="Pending" title="Not live yet" />
                <ul className="mt-4 grid gap-2 text-sm leading-6 text-(--muted)">
                  {profile?.integrations.pending.map((item) => <li key={item} className="inset px-3 py-2">{item}</li>)}
                </ul>
              </div>
            </section>

            <section className="panel p-5 sm:p-6">
              <SectionTitle label="Privacy choices" title="Optional product analytics" />
              <p className="mt-2 text-sm leading-6 text-(--muted)">Help improve activation, review, and export flows using an allowlisted event name plus bounded numeric counts. These events cannot carry merchant names, amounts, currency, email, notes, tokens, source text, or arbitrary metadata. This is off until you opt in, and you can withdraw at any time.</p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <span className={analyticsConsent ? "pill pill-ready" : "pill pill-planned"}>{analyticsConsent ? "Enabled" : "Off"}</span>
                {analyticsConsent ? (
                  <button type="button" disabled={consentBusy} onClick={disablePrivacySafeAnalytics} className="btn btn-ghost disabled:opacity-50">Withdraw consent</button>
                ) : (
                  <button type="button" disabled={consentBusy} onClick={enablePrivacySafeAnalytics} className="btn btn-primary disabled:opacity-50">Opt in</button>
                )}
                <Link href="/privacy" className="btn btn-ghost">Read privacy notice</Link>
              </div>
              {profile?.activeWorkspace?.role === "owner" ? <div className="mt-5 border-t border-line pt-5">
                <h3 className="font-display text-lg font-semibold text-(--ink)">Anonymous category benchmarks</h3>
                <p className="mt-2 text-sm leading-6 text-(--muted)">Optionally contribute only category, currency, cadence, and monthly-cost statistics. Results are daily, coarsened, capped per workspace, and appear only after at least 25 opted-in workspaces share a cohort; merchant, user, workspace, exact event date, evidence, notes, and provider-account dimensions are excluded.</p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <span className={benchmarkConsent ? "pill pill-ready" : "pill pill-planned"}>{benchmarkConsent ? "Enabled" : "Off"}</span>
                  {benchmarkConsent ? (
                    <button type="button" disabled={consentBusy} onClick={disableAnonymousBenchmarks} className="btn btn-ghost disabled:opacity-50">Withdraw benchmark consent</button>
                  ) : (
                    <button type="button" disabled={consentBusy} onClick={enableAnonymousBenchmarks} className="btn btn-primary disabled:opacity-50">Opt in to benchmarks</button>
                  )}
                </div>
              </div> : null}
            </section>

            {renewalAlerts ? (
              <section className="panel p-5 sm:p-6">
                <SectionTitle label="Automatic monitoring" title="Renewal email reminders" />
                <p className="mt-2 text-sm leading-6 text-(--muted)">Get an evidence-based reminder before a predicted renewal. This is off by default; enabling it records purpose-specific consent, and disabling it stops future delivery.</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="inset flex items-center gap-3 p-3 text-sm text-(--ink)">
                    <input type="checkbox" checked={renewalAlerts.sevenDayEnabled} disabled={renewalAlertBusy} onChange={(event) => setRenewalAlerts({ ...renewalAlerts, sevenDayEnabled: event.target.checked })} />
                    7 days before
                  </label>
                  <label className="inset flex items-center gap-3 p-3 text-sm text-(--ink)">
                    <input type="checkbox" checked={renewalAlerts.oneDayEnabled} disabled={renewalAlertBusy} onChange={(event) => setRenewalAlerts({ ...renewalAlerts, oneDayEnabled: event.target.checked })} />
                    1 day before
                  </label>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="field-label">Time zone</span>
                    <input className="field mt-1" value={renewalAlerts.timeZone} disabled={renewalAlertBusy} onChange={(event) => setRenewalAlerts({ ...renewalAlerts, timeZone: event.target.value })} />
                  </label>
                  <label className="block">
                    <span className="field-label">Local send hour (0–23)</span>
                    <input className="field mt-1" type="number" min={0} max={23} value={renewalAlerts.sendHourLocal} disabled={renewalAlertBusy} onChange={(event) => setRenewalAlerts({ ...renewalAlerts, sendHourLocal: Number(event.target.value) })} />
                  </label>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <span className={renewalAlerts.enabled ? "pill pill-ready" : "pill pill-planned"}>{renewalAlerts.enabled ? "Enabled" : "Off"}</span>
                  <button
                    type="button"
                    disabled={renewalAlertBusy || (!renewalAlerts.enabled && !renewalAlerts.sevenDayEnabled && !renewalAlerts.oneDayEnabled)}
                    onClick={() => saveRenewalAlerts({ ...renewalAlerts, enabled: !renewalAlerts.enabled })}
                    className="btn btn-primary disabled:opacity-50"
                  >
                    {renewalAlerts.enabled ? "Turn off" : "Enable reminders"}
                  </button>
                  {renewalAlerts.enabled ? <button type="button" disabled={renewalAlertBusy} onClick={() => saveRenewalAlerts(renewalAlerts)} className="btn btn-ghost disabled:opacity-50">Save schedule</button> : null}
                </div>
              </section>
            ) : null}

            {profile?.activeWorkspace && ["owner", "admin"].includes(profile.activeWorkspace.role) ? (
              <section className="panel p-5 sm:p-6">
                <SectionTitle label="Platform API" title="Read-only workspace tokens" />
                <p className="mt-2 text-sm leading-6 text-(--muted)">Create a 90-day token for your own finance automation. It can read the canonical ledger and source freshness only—never credentials, raw evidence, connector setup, or actions.</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
                  <input value={tokenName} onChange={(event) => setTokenName(event.target.value)} className="field" maxLength={80} aria-label="API token name" />
                  <button type="button" disabled={tokenBusy || !tokenName.trim()} onClick={createReadOnlyApiToken} className="btn btn-primary disabled:opacity-50">Create token</button>
                </div>
                {createdToken ? (
                  <div className="mt-4 rounded-[11px] border border-verdict bg-(--verdict-tint) p-3">
                    <p className="text-sm font-semibold text-verdict">Copy now — this value is shown once</p>
                    <code className="mt-2 block break-all text-xs text-(--ink)">{createdToken}</code>
                    <button type="button" className="btn btn-ghost mt-3 h-9 px-3 text-xs" onClick={() => { void navigator.clipboard.writeText(createdToken); setStatus("API token copied to clipboard."); }}>Copy token</button>
                  </div>
                ) : null}
                <div className="mt-4 grid gap-2">
                  {platformTokens.length ? platformTokens.map((token) => (
                    <div key={token.id} className="inset flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-(--ink)">{token.name} <span className="font-data text-xs font-normal text-(--muted)">{token.tokenPrefix}…</span></p>
                        <p className="mt-1 text-xs text-(--muted)">{token.scopes.join(" · ")} · expires {new Date(token.expiresAt).toLocaleDateString("en-IN")}{token.revokedAt ? " · revoked" : ""}</p>
                      </div>
                      {!token.revokedAt ? <button type="button" disabled={tokenBusy} onClick={() => revokeReadOnlyApiToken(token.id)} className="btn btn-ghost h-9 px-3 text-xs disabled:opacity-50">Revoke</button> : null}
                    </div>
                  )) : <p className="text-xs text-(--muted)">No platform tokens created.</p>}
                </div>
              </section>
            ) : null}

            {retentionPolicy ? (
              <section className="panel p-5 sm:p-6">
                <SectionTitle label="Data rights" title="Export and retention" />
                <p className="mt-2 text-sm leading-6 text-(--muted)">Download a machine-readable workspace export without connector tokens or raw payload bodies. Retention controls minimize raw connector payloads, optional product events, and operational errors while preserving canonical ledger facts and auditability.</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <label className="block">
                    <span className="field-label">Raw payload days (7–90)</span>
                    <input type="number" min={7} max={90} className="field mt-1" disabled={privacyBusy} value={retentionPolicy.rawConnectorPayloadDays} onChange={(event) => setRetentionPolicy({ ...retentionPolicy, rawConnectorPayloadDays: Number(event.target.value) })} />
                  </label>
                  <label className="block">
                    <span className="field-label">Product event days (30–365)</span>
                    <input type="number" min={30} max={365} className="field mt-1" disabled={privacyBusy} value={retentionPolicy.productEventDays} onChange={(event) => setRetentionPolicy({ ...retentionPolicy, productEventDays: Number(event.target.value) })} />
                  </label>
                  <label className="block">
                    <span className="field-label">Error detail days (7–90)</span>
                    <input type="number" min={7} max={90} className="field mt-1" disabled={privacyBusy} value={retentionPolicy.operationalErrorDays} onChange={(event) => setRetentionPolicy({ ...retentionPolicy, operationalErrorDays: Number(event.target.value) })} />
                  </label>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {profile?.activeWorkspace && ["owner", "admin"].includes(profile.activeWorkspace.role) ? <button type="button" disabled={privacyBusy} onClick={saveRetentionPolicy} className="btn btn-ghost disabled:opacity-50">Save retention</button> : null}
                  {profile?.activeWorkspace && ["owner", "admin"].includes(profile.activeWorkspace.role) ? <button type="button" disabled={privacyBusy} onClick={createAndDownloadPrivacyExport} className="btn btn-primary disabled:opacity-50">Download my data</button> : null}
                </div>
                <p className="mt-3 text-xs text-(--muted)">{privacyRequests.length ? `${privacyRequests.length} export request(s) recorded; latest status ${privacyRequests[0].status}.` : "No export requests yet."}</p>
              </section>
            ) : null}

            <section className="panel p-5 sm:p-6">
              <SectionTitle label="Delete" title="Delete my Vognary data" />
              <p className="mt-2 text-sm leading-6 text-(--muted)">This deletes your server-side user row, solo-owned workspaces and their encrypted synchronized state, connected accounts, transactions, recurring items, and evidence; it also deletes waitlist/audit leads and pending magic links for your email, anonymizes your consent identifiers, removes memberships, and clears this browser&apos;s local backup. Data owned by a shared workspace remains for its other members, so owned shared workspaces must first be transferred or emptied. Deletion requires a sign-in from the last 15 minutes.</p>
              <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
                <input value={deleteText} onChange={(event) => setDeleteText(event.target.value)} className="field" placeholder={profile?.deleteConfirmation ?? "DELETE MY VOGNARY DATA"} />
                <button disabled={!profile || deleting || deleteText !== profile.deleteConfirmation} type="button" onClick={deleteMyData} className="btn btn-ghost disabled:cursor-not-allowed disabled:opacity-50" style={{ borderColor: "var(--ember)", color: "var(--ember)" }}>{deleting ? "Deleting..." : "Delete server data"}</button>
              </div>
              <p className="mt-3 text-xs leading-5 text-(--muted)">{status}</p>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}

async function fetchConsentRecords(): Promise<ConsentRecord[]> {
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

async function fetchPlatformTokens(): Promise<PlatformTokenSummary[]> {
  const response = await fetch("/api/platform/tokens", { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "Platform tokens are unavailable.");
  return Array.isArray(payload.tokens) ? payload.tokens : [];
}

async function fetchRenewalAlertPreference(): Promise<RenewalAlertPreference> {
  const response = await fetch("/api/renewal-alerts/preferences", { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "Renewal alert preferences are unavailable.");
  return payload.preference as RenewalAlertPreference;
}

async function fetchRetentionPolicy(): Promise<RetentionPolicy> {
  const response = await fetch("/api/privacy/retention-policy", { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "Retention policy is unavailable.");
  return payload.policy as RetentionPolicy;
}

async function fetchPrivacyRequests(): Promise<PrivacyRequest[]> {
  const response = await fetch("/api/privacy/requests", { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "Privacy requests are unavailable.");
  return Array.isArray(payload.requests) ? payload.requests : [];
}

function SectionTitle({ label, title }: { label: string; title: string }) {
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <h2 className="mt-2 font-display text-2xl font-semibold text-(--ink)">{title}</h2>
    </div>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="inset px-3 py-3">
      <p className="eyebrow" style={{ fontSize: "0.56rem" }}>{label}</p>
      <p className={`${mono ? "font-data text-xs" : "font-semibold"} mt-2 break-all text-(--ink)`}>{value}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="inset px-3 py-3">
      <p className="eyebrow" style={{ fontSize: "0.56rem" }}>{label}</p>
      <p className="font-data mt-2 text-2xl font-semibold tnum text-(--ink)">{value}</p>
    </div>
  );
}
