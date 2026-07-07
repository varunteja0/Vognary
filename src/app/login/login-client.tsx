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

type GoogleStartPayload = {
  status?: string;
  authUrl?: string;
  message?: string;
  redirectUri?: string;
  requiredEnv?: string[];
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
    const payload = await response.json() as GoogleStartPayload;
    if (!response.ok || payload.status !== "ready" || !payload.authUrl) {
      const missing = payload.requiredEnv?.length ? ` Missing: ${payload.requiredEnv.join(", ")}.` : "";
      const redirect = payload.redirectUri ? ` Redirect URI: ${payload.redirectUri}` : "";
      setGoogleStatus(`${payload.message ?? "Google login is not configured yet."}${missing}${redirect}`);
      setGoogleSubmitting(false);
      return;
    }

    if (payload.redirectUri) window.sessionStorage.setItem("vognary.google.redirectUri", payload.redirectUri);
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
            <Link href="/app" className="btn btn-primary">Open audit app</Link>
          </div>
        </div>

        <section className="panel mx-auto w-full max-w-2xl p-6 sm:p-8 rise">
            <span className="folio" data-folio="01">Sign in</span>
            <h2 className="mt-3 font-display text-2xl font-semibold text-(--ink)">Private beta login</h2>
            <p className="mt-2 text-sm leading-6 text-(--muted)">Google creates the workspace session. Gmail receipt access stays separate inside the app.</p>

            {session?.authenticated ? (
              <div className="mt-6 rounded-xl border border-line bg-(--card-2) p-4">
                <p className="font-data text-xs uppercase tracking-[0.16em] text-(--muted)">Current session</p>
                <p className="mt-2 font-semibold text-(--ink)">{session.session?.email}</p>
                <p className="mt-1 text-sm text-(--muted)">Workspace: {session.session?.workspaceId ?? "not selected"}</p>
                <p className="mt-1 text-sm text-(--muted)">Expires: {session.session ? new Date(session.session.expiresAt).toLocaleString("en-IN") : "unknown"}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link href="/app" className="btn btn-primary">Open audit app</Link>
                  <Link href="/profile" className="btn btn-ghost">View profile</Link>
                  <button type="button" onClick={signOut} className="btn btn-ghost">Sign out</button>
                </div>
              </div>
            ) : (
              <div className="mt-5 grid gap-5">
                <div className="rounded-xl border p-5" style={{ borderColor: "color-mix(in srgb, var(--gold) 40%, var(--line))", background: "color-mix(in srgb, var(--gold) 6%, var(--card-2))" }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="pill pill-ready">Recommended</span>
                    <h3 className="font-display text-lg font-semibold text-(--ink)">Continue with Google</h3>
                  </div>
                  <button disabled={googleSubmitting} type="button" onClick={startGoogleSignIn} className="btn btn-primary btn-lg btn-block mt-4">
                    {googleSubmitting ? "Opening Google..." : "Continue with Google"}
                  </button>
                  {googleStatus ? <p className="mt-3 wrap-break-word rounded-md border border-indigo bg-(--indigo-tint) px-3 py-2 text-sm text-indigo">{googleStatus}</p> : null}
                </div>

                <details className="rounded-xl border border-line bg-(--card-2) p-4">
                  <summary className="cursor-pointer font-display text-base font-semibold text-(--ink)">Fallback sign-in</summary>
                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <form onSubmit={requestMagicLink} className="flex flex-col gap-3">
                      <h3 className="font-display text-base font-semibold text-(--ink)">Email link</h3>
                      <input value={magicForm.name} onChange={(event) => setMagicForm({ ...magicForm, name: event.target.value })} className="field" placeholder="Name" />
                      <input required type="email" value={magicForm.email} onChange={(event) => setMagicForm({ ...magicForm, email: event.target.value })} className="field" placeholder="Email" />
                      <input value={magicForm.workspaceName} onChange={(event) => setMagicForm({ ...magicForm, workspaceName: event.target.value })} className="field" placeholder="Workspace name" />
                      <button disabled={magicSubmitting} type="submit" className="btn btn-ghost btn-block mt-auto disabled:cursor-not-allowed disabled:opacity-60">{magicSubmitting ? "Sending..." : "Send link"}</button>
                      {magicStatus ? <p className="rounded-md border border-indigo bg-(--indigo-tint) px-3 py-2 text-sm text-indigo">{magicStatus}</p> : null}
                    </form>

                    <form onSubmit={submit} className="flex flex-col gap-3">
                      <h3 className="font-display text-base font-semibold text-(--ink)">Beta code</h3>
                      <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="field" placeholder="Name" />
                      <input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="field" placeholder="Email" />
                      <input value={form.workspaceName} onChange={(event) => setForm({ ...form, workspaceName: event.target.value })} className="field" placeholder="Workspace name" />
                      <input required type="password" value={form.accessCode} onChange={(event) => setForm({ ...form, accessCode: event.target.value })} className="field" placeholder="Private beta access code" />
                      <button disabled={submitting} type="submit" className="btn btn-ghost btn-block mt-auto disabled:cursor-not-allowed disabled:opacity-60">{submitting ? "Signing in..." : "Sign in with code"}</button>
                    </form>
                  </div>
                </details>
              </div>
            )}

            {status ? <p className="mt-4 rounded-md border border-indigo bg-(--indigo-tint) px-3 py-2 text-sm text-indigo">{status}</p> : null}
            <div className="mt-5 rounded-xl border border-line bg-(--card-2) p-4 text-sm leading-6 text-(--muted)">
              <p><strong className="text-(--ink)">Configuration:</strong> session secret is {session?.configuration.status ?? "checking"}.</p>
              <p className="mt-1">Google login env: <span className="font-data">GOOGLE_AUTH_CLIENT_ID</span>, <span className="font-data">GOOGLE_AUTH_CLIENT_SECRET</span>, <span className="font-data">GOOGLE_AUTH_REDIRECT_URI</span>. Code fallback env: <span className="font-data">PRIVATE_BETA_ACCESS_CODE</span>.</p>
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