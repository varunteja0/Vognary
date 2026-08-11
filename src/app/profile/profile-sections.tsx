import Link from "next/link";
import type { ReactNode } from "react";
import type { useProfileSettings } from "./use-profile-settings";

type Settings = ReturnType<typeof useProfileSettings>;

export function ProfileGroup({
  name,
  description,
  children,
  defaultOpen = false,
}: {
  name: string;
  description: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="panel group overflow-hidden" open={defaultOpen}>
      <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 marker:content-none sm:px-6">
        <span>
          <span className="block font-display text-xl font-semibold text-(--ink)">{name}</span>
          <span className="mt-1 block text-sm leading-5 text-(--muted)">{description}</span>
        </span>
        <span aria-hidden="true" className="font-data text-xl text-(--muted) group-open:rotate-45">+</span>
      </summary>
      <div className="border-t border-line px-5 py-5 sm:px-6 sm:py-6">{children}</div>
    </details>
  );
}

export function AccountSection({ settings }: { settings: Settings }) {
  const { profile } = settings;
  return (
    <ProfileGroup name="Account" description="Identity, workspace, and stored-data summary" defaultOpen>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="eyebrow">Signed in as</p>
          <p className="mt-2 break-all text-sm font-semibold text-(--ink)">{profile?.session.email ?? "Checking your session…"}</p>
          <p className="mt-1 text-xs leading-5 text-(--muted)">
            {profile ? `Session expires ${new Date(profile.session.expiresAt).toLocaleString("en-IN")}` : "Workspace details will appear after your account loads."}
          </p>
        </div>
        <button type="button" onClick={settings.signOut} className="btn btn-ghost shrink-0">Sign out</button>
      </div>
      <StatusMessage message={settings.statuses.account} />

      {profile?.activeWorkspace ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <Info label="Workspace" value={profile.activeWorkspace.workspaceName} />
          <Info label="Plan" value={profile.activeWorkspace.plan} />
          <Info label="Role" value={profile.activeWorkspace.role} />
        </div>
      ) : null}

      {profile ? (
        <details className="inset mt-4 p-4">
          <summary className="cursor-pointer font-semibold text-(--ink)">Stored data and connection inventory</summary>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Saved account state" value={profile.data.auditReports} />
            <Metric label="Active sources" value={profile.data.connectedAccounts} />
            <Metric label="Receipt and source records" value={profile.data.dataSources} />
            <Metric label="Uploaded files" value={profile.data.uploadedFiles} />
            <Metric label="Transactions" value={profile.data.transactions} />
            <Metric label="Subscriptions" value={profile.data.recurringItems} />
            <Metric label="Received source records" value={profile.data.connectorEvidence} />
            <Metric label="Usage observations" value={profile.data.usageObservations} />
          </div>
          <p className="mt-4 text-xs leading-5 text-(--muted)">
            Latest saved update: {profile.data.latestSnapshotAt ? new Date(profile.data.latestSnapshotAt).toLocaleString("en-IN") : "none yet"}
          </p>
        </details>
      ) : null}
    </ProfileGroup>
  );
}

export function NotificationsSection({ settings }: { settings: Settings }) {
  const alerts = settings.renewalAlerts;
  return (
    <ProfileGroup name="Notifications" description="Evidence-based renewal reminders">
      {alerts ? (
        <>
          <p className="text-sm leading-6 text-(--muted)">Reminders and the weekly digest are off by default. Each is an explicit choice under one revocable notification consent.</p>
          <div className="inset mt-4 p-4">
            <CheckBox label="Weekly recurring-money digest" checked={alerts.weeklyDigestEnabled} disabled={settings.renewalAlertBusy} onChange={(checked) => settings.setRenewalAlerts({ ...alerts, weeklyDigestEnabled: checked })} />
            <p className="mt-2 text-xs leading-5 text-(--muted)">Sent on Monday at your local send hour only when the ledger contains commitments: monthly INR burn, foreign currencies kept separate, renewals due in seven days, and one deterministic review suggestion.</p>
          </div>
          <p className="mt-4 text-sm font-semibold text-(--ink)">Renewal reminders</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <CheckBox label="7 days before" checked={alerts.sevenDayEnabled} disabled={settings.renewalAlertBusy} onChange={(checked) => settings.setRenewalAlerts({ ...alerts, sevenDayEnabled: checked })} />
            <CheckBox label="1 day before" checked={alerts.oneDayEnabled} disabled={settings.renewalAlertBusy} onChange={(checked) => settings.setRenewalAlerts({ ...alerts, oneDayEnabled: checked })} />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="field-label">Time zone</span>
              <input className="field mt-1" value={alerts.timeZone} disabled={settings.renewalAlertBusy} onChange={(event) => settings.setRenewalAlerts({ ...alerts, timeZone: event.target.value })} />
            </label>
            <label className="block">
              <span className="field-label">Local send hour (0–23)</span>
              <input className="field mt-1" type="number" min={0} max={23} value={alerts.sendHourLocal} disabled={settings.renewalAlertBusy} onChange={(event) => settings.setRenewalAlerts({ ...alerts, sendHourLocal: Number(event.target.value) })} />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className={alerts.enabled || alerts.weeklyDigestEnabled ? "pill pill-ready" : "pill pill-planned"}>{alerts.enabled || alerts.weeklyDigestEnabled ? "Notifications on" : "All off"}</span>
            <button
              type="button"
              disabled={settings.renewalAlertBusy || (!alerts.enabled && !alerts.sevenDayEnabled && !alerts.oneDayEnabled)}
              onClick={() => settings.saveRenewalAlerts({ ...alerts, enabled: !alerts.enabled })}
              className="btn btn-primary disabled:opacity-50"
            >
              {alerts.enabled ? "Turn off" : "Enable reminders"}
            </button>
            <button type="button" disabled={settings.renewalAlertBusy} onClick={() => settings.saveRenewalAlerts(alerts)} className="btn btn-ghost disabled:opacity-50">Save notification settings</button>
          </div>
        </>
      ) : <p className="text-sm text-(--muted)">Reminder controls are not available until the server confirms this capability.</p>}
      <StatusMessage message={settings.statuses.notifications} />
    </ProfileGroup>
  );
}

export function PrivacySection({ settings }: { settings: Settings }) {
  const isAdmin = Boolean(settings.profile?.activeWorkspace && ["owner", "admin"].includes(settings.profile.activeWorkspace.role));
  return (
    <ProfileGroup name="Privacy" description="Consent, export, and retention controls">
      {settings.consentsAvailable ? (
        <div>
          <h3 className="font-display text-lg font-semibold text-(--ink)">Optional product analytics</h3>
          <p className="mt-2 text-sm leading-6 text-(--muted)">Allowlisted product events cannot carry merchant names, amounts, currency, email, notes, tokens, source text, or arbitrary metadata.</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className={settings.analyticsConsent ? "pill pill-ready" : "pill pill-planned"}>{settings.analyticsConsent ? "Enabled" : "Off"}</span>
            <button type="button" disabled={settings.consentBusy} onClick={settings.toggleAnalyticsConsent} className={settings.analyticsConsent ? "btn btn-ghost disabled:opacity-50" : "btn btn-primary disabled:opacity-50"}>
              {settings.analyticsConsent ? "Withdraw consent" : "Opt in"}
            </button>
            <Link href="/privacy" className="btn btn-ghost">Read privacy notice</Link>
          </div>
          {settings.profile?.activeWorkspace?.role === "owner" ? (
            <div className="mt-5 border-t border-line pt-5">
              <h3 className="font-display text-lg font-semibold text-(--ink)">Anonymous category benchmarks</h3>
              <p className="mt-2 text-sm leading-6 text-(--muted)">Only coarsened category, currency, cadence, and monthly-cost statistics contribute to daily cohorts of at least 25 opted-in workspaces.</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <span className={settings.benchmarkConsent ? "pill pill-ready" : "pill pill-planned"}>{settings.benchmarkConsent ? "Enabled" : "Off"}</span>
                <button type="button" disabled={settings.consentBusy} onClick={settings.toggleBenchmarkConsent} className={settings.benchmarkConsent ? "btn btn-ghost disabled:opacity-50" : "btn btn-primary disabled:opacity-50"}>
                  {settings.benchmarkConsent ? "Withdraw benchmark consent" : "Opt in to benchmarks"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : <p className="text-sm text-(--muted)">Consent controls are not shown until consent history is available.</p>}
      <StatusMessage message={settings.statuses.privacyConsent} />

      {settings.privacyLifecycleAvailable && settings.retentionPolicy ? (
        <div id="privacy-export" className="mt-6 scroll-mt-6 border-t border-line pt-5">
          <h3 className="font-display text-lg font-semibold text-(--ink)">Export and retention</h3>
          <p className="mt-2 text-sm leading-6 text-(--muted)">Exports exclude connector tokens and raw payload bodies. Retention settings minimize temporary inputs while preserving canonical ledger facts and auditability.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <NumberField label="Raw payload days (7–90)" min={7} max={90} value={settings.retentionPolicy.rawConnectorPayloadDays} disabled={settings.privacyBusy} onChange={(value) => settings.setRetentionPolicy({ ...settings.retentionPolicy!, rawConnectorPayloadDays: value })} />
            <NumberField label="Product event days (30–365)" min={30} max={365} value={settings.retentionPolicy.productEventDays} disabled={settings.privacyBusy} onChange={(value) => settings.setRetentionPolicy({ ...settings.retentionPolicy!, productEventDays: value })} />
            <NumberField label="Error detail days (7–90)" min={7} max={90} value={settings.retentionPolicy.operationalErrorDays} disabled={settings.privacyBusy} onChange={(value) => settings.setRetentionPolicy({ ...settings.retentionPolicy!, operationalErrorDays: value })} />
          </div>
          {isAdmin ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" disabled={settings.privacyBusy} onClick={settings.saveRetentionPolicy} className="btn btn-ghost disabled:opacity-50">Save retention</button>
              <button type="button" disabled={settings.privacyBusy} onClick={settings.createAndDownloadPrivacyExport} className="btn btn-primary disabled:opacity-50">Download my data</button>
            </div>
          ) : <p className="mt-3 text-xs text-(--muted)">Workspace owners and admins manage export and retention settings.</p>}
          <p className="mt-3 text-xs text-(--muted)">{settings.privacyRequests.length ? `${settings.privacyRequests.length} export request(s) recorded; latest status ${settings.privacyRequests[0].status}.` : "No export requests yet."}</p>
          <StatusMessage message={settings.statuses.privacyData} />
        </div>
      ) : <StatusMessage message={settings.statuses.privacyData} />}
    </ProfileGroup>
  );
}

export function DangerZoneSection({ settings }: { settings: Settings }) {
  return (
    <div id="delete-account" className="scroll-mt-6">
      <ProfileGroup name="Danger Zone" description="Permanent account and workspace deletion">
      <h3 className="font-display text-lg font-semibold text-(--ink)">Delete my Vognary data</h3>
      <p className="mt-2 text-sm leading-6 text-(--muted)">Deletion removes active sessions, receipt aliases, Recovery evidence, subscriptions, and decisions, plus solo-owned workspace data. Shared-workspace data and legally retained or provider-held data follow the disclosed boundaries. Recent authentication is required.</p>
      <label className="mt-4 block">
        <span className="field-label">Type {settings.profile?.deleteConfirmation ?? "the confirmation phrase"} to confirm</span>
        <input value={settings.deleteText} onChange={(event) => settings.setDeleteText(event.target.value)} className="field mt-1" autoComplete="off" />
      </label>
      <button
        disabled={!settings.profile || settings.deleting || settings.deleteText !== settings.profile.deleteConfirmation}
        type="button"
        onClick={settings.deleteMyData}
        className="btn btn-ghost mt-3 disabled:cursor-not-allowed disabled:opacity-50"
        style={{ borderColor: "var(--ember)", color: "var(--ember)" }}
      >
        {settings.deleting ? "Deleting…" : "Delete server data"}
      </button>
      <StatusMessage message={settings.statuses.danger} />
      </ProfileGroup>
    </div>
  );
}

function StatusMessage({ message }: { message: string }) {
  return <p role="status" aria-live="polite" aria-atomic="true" className="mt-4 min-h-5 text-xs leading-5 text-(--muted)">{message}</p>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="inset px-3 py-3"><p className="eyebrow text-[0.56rem]">{label}</p><p className="mt-2 break-all font-semibold text-(--ink)">{value}</p></div>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg border border-line px-3 py-3"><p className="eyebrow text-[0.56rem]">{label}</p><p className="font-data mt-2 text-2xl font-semibold tnum text-(--ink)">{value}</p></div>;
}

function CheckBox({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
  return <label className="inset flex items-center gap-3 p-3 text-sm text-(--ink)"><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />{label}</label>;
}

function NumberField({ label, min, max, value, disabled, onChange }: { label: string; min: number; max: number; value: number; disabled: boolean; onChange: (value: number) => void }) {
  return <label className="block"><span className="field-label">{label}</span><input type="number" min={min} max={max} className="field mt-1" disabled={disabled} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}
