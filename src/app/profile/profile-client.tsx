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

const localWorkspaceStorageKey = "vognary.workspace.v1";

export default function ProfileClient() {
  const [profile, setProfile] = useState<ProfilePayload | null>(null);
  const [status, setStatus] = useState("Loading profile...");
  const [deleteText, setDeleteText] = useState("");
  const [deleting, setDeleting] = useState(false);

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
      setStatus(payload.error ?? "Could not delete data.");
      setDeleting(false);
      return;
    }
    window.localStorage.removeItem(localWorkspaceStorageKey);
    setStatus(`Deleted ${payload.deletedOwnedWorkspaces ?? 0} workspace(s). Signing out...`);
    window.location.href = "/login?deleted=1";
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
                <Metric label="Snapshots" value={profile?.data.auditReports ?? 0} />
                <Metric label="Connected accounts" value={profile?.data.connectedAccounts ?? 0} />
                <Metric label="Server sources" value={profile?.data.dataSources ?? 0} />
                <Metric label="Uploaded files" value={profile?.data.uploadedFiles ?? 0} />
                <Metric label="Transactions" value={profile?.data.transactions ?? 0} />
                <Metric label="Recurring items" value={profile?.data.recurringItems ?? 0} />
                <Metric label="Connector evidence" value={profile?.data.connectorEvidence ?? 0} />
                <Metric label="Usage observations" value={profile?.data.usageObservations ?? 0} />
              </div>
              <p className="mt-4 text-sm leading-6 text-(--muted)">Latest encrypted snapshot: {profile?.data.latestSnapshotAt ? new Date(profile.data.latestSnapshotAt).toLocaleString("en-IN") : "none yet"}</p>
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
              <SectionTitle label="Delete" title="Delete my Vognary data" />
              <p className="mt-2 text-sm leading-6 text-(--muted)">This deletes your server-side user row, owned workspaces, encrypted snapshots, connected-account records, transactions, recurring items, evidence, and workspace memberships. It also clears this browser&apos;s local Vognary workspace backup.</p>
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