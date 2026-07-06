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
  const [magicForm, setMagicForm] = useState({ name: "", email: "", workspaceName: "" });
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [status, setStatus] = useState<string | null>("Checking session...");
  const [magicStatus, setMagicStatus] = useState<string | null>(null);
  const [googleStatus, setGoogleStatus] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const googleReason = new URLSearchParams(window.location.search).get("google");
    return googleReason ? getGoogleFailureMessage(googleReason) : null;
  });
  const [submitting, setSubmitting] = useState(false);
  const [magicSubmitting, setMagicSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);

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

  async function requestMagicLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMagicSubmitting(true);
    setMagicStatus("Sending sign-in link...");

    const response = await fetch("/api/auth/magic-link/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...magicForm, redirectPath: "/" }),
    });
    const payload = await response.json();

    if (!response.ok) {
      setMagicStatus(payload.message ?? payload.error ?? "Magic link failed.");
      setMagicSubmitting(false);
      return;
    }

    setMagicStatus(`Sign-in link sent to ${payload.email}.`);
    setMagicSubmitting(false);
  }

  async function startGoogleSignIn() {
    setGoogleSubmitting(true);
    setGoogleStatus("Opening Google sign-in...");

    const response = await fetch("/api/auth/google/start?mode=json", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok || payload.status !== "ready" || !payload.authUrl) {
      setGoogleStatus(payload.message ?? "Google login is not configured yet.");
      setGoogleSubmitting(false);
      return;
    }

    window.location.href = payload.authUrl;
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
            <span className="folio" data-folio="Beta" style={{ color: "var(--dossier-muted)" }}>Private beta sign in</span>
            <h1 className="mt-5 font-display text-3xl font-bold leading-tight text-(--dossier-ink) sm:text-5xl">Sign in to save{" "}<br /><span className="glow-num">your review.</span></h1>
            <p className="mt-5 max-w-2xl text-base leading-7 muted-on-dark">Sign in with Google, email link, or a private beta code to save encrypted snapshots. Provider access still stays separate from financial connectors.</p>
            <div className="mt-8 rounded-[11px] border p-4" style={{ borderColor: "var(--dossier-line)", background: "rgba(243,234,214,0.04)" }}>
              <h2 className="font-display text-lg font-semibold text-(--dossier-ink)">Available now</h2>
              <ul className="mt-3 space-y-2 text-sm leading-6 muted-on-dark">
                <li>Signed session cookie.</li>
                <li>PostgreSQL user and workspace records.</li>
                <li>Workspace APIs stay closed without a valid session.</li>
                <li>Browser-local review data stays on the device unless you save a snapshot.</li>
              </ul>
            </div>
            <div className="mt-4 rounded-[11px] border p-4" style={{ borderColor: "var(--dossier-line)", background: "rgba(243,234,214,0.04)" }}>
              <h2 className="font-display text-lg font-semibold text-(--dossier-ink)">Before public launch</h2>
              <p className="mt-2 text-sm leading-6 muted-on-dark">Public launch still needs deletion controls, encrypted file storage, and durable normalized review history.</p>
            </div>
          </aside>

          <div className="panel p-6 sm:p-8 rise">
            <span className="folio" data-folio="01">Sign in</span>
            <h2 className="mt-3 font-display text-2xl font-semibold text-(--ink)">Private beta login</h2>
            <p className="mt-2 text-sm leading-6 text-(--muted)">Use this only if you were invited to the beta. The access code will be replaced with email verification before public launch.</p>

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
              <div className="mt-5 grid gap-5">
                <div className="rounded-[12px] border border-line bg-(--card-2) p-4">
                  <h3 className="font-display text-lg font-semibold text-(--ink)">Google sign-in</h3>
                  <p className="mt-1 text-sm leading-6 text-(--muted)">Fastest path for beta users. Vognary reads your verified Google identity only; Gmail receipt access is a separate connector.</p>
                  <button disabled={googleSubmitting} type="button" onClick={startGoogleSignIn} className="btn btn-primary mt-3 w-full disabled:cursor-not-allowed disabled:opacity-60">
                    {googleSubmitting ? "Opening Google..." : "Continue with Google"}
                  </button>
                  {googleStatus ? <p className="mt-3 rounded-md border border-indigo bg-(--indigo-tint) px-3 py-2 text-sm text-indigo">{googleStatus}</p> : null}
                </div>

                <form onSubmit={requestMagicLink} className="grid gap-3 rounded-[12px] border border-line bg-(--card-2) p-4">
                  <h3 className="font-display text-lg font-semibold text-(--ink)">Email sign-in link</h3>
                  <p className="text-sm leading-6 text-(--muted)">Optional fallback when Resend is configured.</p>
                  <input value={magicForm.name} onChange={(event) => setMagicForm({ ...magicForm, name: event.target.value })} className="field" placeholder="Name" />
                  <input required type="email" value={magicForm.email} onChange={(event) => setMagicForm({ ...magicForm, email: event.target.value })} className="field" placeholder="Email" />
                  <input value={magicForm.workspaceName} onChange={(event) => setMagicForm({ ...magicForm, workspaceName: event.target.value })} className="field" placeholder="Workspace name" />
                  <button disabled={magicSubmitting} type="submit" className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-60">{magicSubmitting ? "Sending..." : "Send sign-in link"}</button>
                  {magicStatus ? <p className="rounded-md border border-indigo bg-(--indigo-tint) px-3 py-2 text-sm text-indigo">{magicStatus}</p> : null}
                </form>

                <form onSubmit={submit} className="grid gap-3 rounded-[12px] border border-line bg-(--card-2) p-4">
                  <h3 className="font-display text-lg font-semibold text-(--ink)">Private beta code</h3>
                  <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="field" placeholder="Name" />
                  <input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="field" placeholder="Email" />
                  <input value={form.workspaceName} onChange={(event) => setForm({ ...form, workspaceName: event.target.value })} className="field" placeholder="Workspace name" />
                  <input required type="password" value={form.accessCode} onChange={(event) => setForm({ ...form, accessCode: event.target.value })} className="field" placeholder="Private beta access code" />
                  <button disabled={submitting} type="submit" className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-60">{submitting ? "Signing in..." : "Sign in with code"}</button>
                </form>
              </div>
            )}

            {status ? <p className="mt-4 rounded-md border border-indigo bg-(--indigo-tint) px-3 py-2 text-sm text-indigo">{status}</p> : null}
            <div className="mt-5 rounded-[12px] border border-line bg-(--card-2) p-4 text-sm leading-6 text-(--muted)">
              <p><strong className="text-(--ink)">Configuration:</strong> session secret is {session?.configuration.status ?? "checking"}.</p>
              <p className="mt-1">Google login env: <span className="font-data">GOOGLE_AUTH_CLIENT_ID</span>, <span className="font-data">GOOGLE_AUTH_CLIENT_SECRET</span>, <span className="font-data">GOOGLE_AUTH_REDIRECT_URI</span>. Code fallback env: <span className="font-data">PRIVATE_BETA_ACCESS_CODE</span>.</p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function getGoogleFailureMessage(reason: string) {
  const messages: Record<string, string> = {
    "missing-code": "Google did not return an authorization code.",
    "invalid-state": "Google sign-in state expired. Try again.",
    "token-exchange-failed": "Google token exchange failed. Check OAuth client settings.",
    "missing-id-token": "Google did not return an identity token.",
    "token-validation-failed": "Google identity validation failed.",
    "audience-mismatch": "Google OAuth client mismatch. Check client ID and redirect URI.",
    "email-not-verified": "Google email is not verified.",
    "missing-email": "Google did not return an email address.",
    "not-allowed": "This Google account is not allowed for the beta.",
  };
  return messages[reason] ?? "Google sign-in failed. Try again.";
}