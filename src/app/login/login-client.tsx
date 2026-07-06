"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { VognaryMark } from "../brand";

type SessionPayload = {
  authenticated: boolean;
  configuration: { status: "not-configured" | "ready"; cookieName: string };
  session: null | {
    userId: string;
    email: string;
    workspaceId: string | null;
    expiresAt: string;
  };
};

export default function LoginClient() {
  const [form, setForm] = useState({ name: "", email: "", workspaceName: "", accessCode: "" });
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [status, setStatus] = useState<string | null>("Checking session...");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    refreshSession();
  }, []);

  async function refreshSession() {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    const payload = await response.json() as SessionPayload;
    setSession(payload);
    setStatus(payload.authenticated ? "Signed in." : null);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setStatus("Signing in...");

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    const payload = await response.json();

    if (!response.ok) {
      setStatus(payload.message ?? payload.error ?? "Login failed.");
      setSubmitting(false);
      return;
    }

    setStatus(`Signed in as ${payload.session.email}.`);
    setSubmitting(false);
    await refreshSession();
  }

  async function signOut() {
    setStatus("Signing out...");
    await fetch("/api/auth/logout", { method: "POST" });
    await refreshSession();
    setStatus("Signed out.");
  }

  return (
    <main id="ledger-main" className="relative px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="inline-flex items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
            <VognaryMark size={22} />
            Vognary
          </Link>
          <div className="flex flex-wrap gap-2">
            <Link href="/private-audit" className="btn btn-ghost">Private audit</Link>
            <Link href="/" className="btn btn-primary">Open audit app</Link>
          </div>
        </div>

        <section className="grid gap-5 lg:grid-cols-[0.88fr_1.12fr]">
          <aside className="dossier spotlight scan p-7 sm:p-9 rise">
            <span className="folio" data-folio="§ ID" style={{ color: "var(--dossier-muted)" }}>Private beta identity</span>
            <h1 className="mt-5 font-display text-4xl font-bold leading-none tracking-[-0.03em] text-(--dossier-ink) sm:text-6xl">A workspace for<br /><span className="glow-num">your recurring money.</span></h1>
            <p className="mt-5 max-w-2xl text-base leading-7 muted-on-dark">This login creates a signed private-beta session and workspace envelope. It is not yet an open public password or OTP login.</p>
            <div className="mt-8 rounded-[11px] border p-4" style={{ borderColor: "var(--dossier-line)", background: "rgba(243,234,214,0.04)" }}>
              <h2 className="font-display text-lg font-semibold text-(--dossier-ink)">What is real now</h2>
              <ul className="mt-3 space-y-2 text-sm leading-6 muted-on-dark">
                <li>Signed HTTP-only session cookie.</li>
                <li>PostgreSQL user and workspace records.</li>
                <li>Workspace APIs stay closed without a valid session.</li>
                <li>Browser-local audit data still stays on the device until persistence is fully wired.</li>
              </ul>
            </div>
            <div className="mt-4 rounded-[11px] border p-4" style={{ borderColor: "var(--dossier-line)", background: "rgba(243,234,214,0.04)" }}>
              <h2 className="font-display text-lg font-semibold text-(--dossier-ink)">Next trust gate</h2>
              <p className="mt-2 text-sm leading-6 muted-on-dark">Public launch needs magic-link or OAuth login, encrypted file storage, deletion controls, and durable per-workspace audit history.</p>
            </div>
          </aside>

          <div className="panel p-6 sm:p-8 rise">
            <span className="folio" data-folio="§ 01">Sign in</span>
            <h2 className="mt-3 font-display text-2xl font-semibold text-(--ink)">Private beta login</h2>
            <p className="mt-2 text-sm leading-6 text-(--muted)">Use this only for invited beta users. The access code should be rotated and replaced with email verification before public launch.</p>

            {session?.authenticated ? (
              <div className="mt-6 rounded-[12px] border border-line bg-(--card-2) p-4">
                <p className="font-data text-xs uppercase tracking-[0.16em] text-(--muted)">Current session</p>
                <p className="mt-2 font-semibold text-(--ink)">{session.session?.email}</p>
                <p className="mt-1 text-sm text-(--muted)">Workspace: {session.session?.workspaceId ?? "not selected"}</p>
                <p className="mt-1 text-sm text-(--muted)">Expires: {session.session ? new Date(session.session.expiresAt).toLocaleString("en-IN") : "unknown"}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link href="/" className="btn btn-primary">Open audit app</Link>
                  <button type="button" onClick={signOut} className="btn btn-ghost">Sign out</button>
                </div>
              </div>
            ) : (
              <form onSubmit={submit} className="mt-5 grid gap-3">
                <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="field" placeholder="Name" />
                <input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="field" placeholder="Email" />
                <input value={form.workspaceName} onChange={(event) => setForm({ ...form, workspaceName: event.target.value })} className="field" placeholder="Workspace name" />
                <input required type="password" value={form.accessCode} onChange={(event) => setForm({ ...form, accessCode: event.target.value })} className="field" placeholder="Private beta access code" />
                <button disabled={submitting} type="submit" className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-60">{submitting ? "Signing in..." : "Sign in"}</button>
              </form>
            )}

            {status ? <p className="mt-4 rounded-md border border-indigo bg-(--indigo-tint) px-3 py-2 text-sm text-indigo">{status}</p> : null}
            <div className="mt-5 rounded-[12px] border border-line bg-(--card-2) p-4 text-sm leading-6 text-(--muted)">
              <p><strong className="text-(--ink)">Configuration:</strong> session secret is {session?.configuration.status ?? "checking"}.</p>
              <p className="mt-1">Required production env: <span className="font-data">SESSION_SECRET</span>, <span className="font-data">DATABASE_URL</span>, <span className="font-data">PRIVATE_BETA_ACCESS_CODE</span>.</p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}