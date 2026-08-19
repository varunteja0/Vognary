"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { guestAuditTransferKey } from "@/lib/guest-audit-transfer";
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
  availability?: "company-activation-pending";
};

type Tone = "info" | "error" | "success";
type Banner = { tone: Tone; text: string } | null;

const trustPoints = ["No mailbox access required", "No bank passwords", "Google for sign-in only", "Export or delete your data"];
const isDevEnv = process.env.NODE_ENV !== "production";

type LoginClientProps = {
  initialGoogleReason?: string;
  initialNextPath?: string;
  initialSession: SessionPayload;
};

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/app";
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded.startsWith("//") || decoded.includes("\\") || /[\u0000-\u001f\u007f]/.test(decoded)) return "/app";
    const base = new URL("https://vognary.invalid/");
    if (new URL(raw, base).origin !== base.origin) return "/app";
  } catch {
    return "/app";
  }
  if (raw === "/login" || raw.startsWith("/login?") || raw.startsWith("/login/")) return "/app";
  return raw;
}

export default function LoginClient({ initialGoogleReason, initialNextPath, initialSession }: LoginClientProps) {
  const [form, setForm] = useState({ name: "", email: "", workspaceName: "", accessCode: "" });
  const [session, setSession] = useState<SessionPayload>(initialSession);
  const [status, setStatus] = useState<Banner>(null);
  const [googleStatus, setGoogleStatus] = useState<Banner>(() => initialGoogleReason
    ? { tone: "error", text: getGoogleFailureMessage(initialGoogleReason) }
    : null);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const nextPath = safeNextPath(initialNextPath ?? null);
  const [guestAuditWaiting, setGuestAuditWaiting] = useState(false);

  useEffect(() => {
    queueMicrotask(() => setGuestAuditWaiting(Boolean(window.sessionStorage.getItem(guestAuditTransferKey))));
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadSession() {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        const payload = await response.json() as SessionPayload;
        if (!cancelled) setSession(payload);
      } catch {
        if (cancelled) return;
        setSession({ authenticated: false, configuration: { status: "not-configured", cookieName: "vognary_session" }, session: null });
        setStatus({ tone: "error", text: "Could not reach the sign-in service. Check your connection and retry." });
      }
    }
    const recheck = () => {
      if (document.visibilityState === "visible") void loadSession();
    };
    void loadSession();
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, []);

  useEffect(() => {
    if (!session?.authenticated) return;
    const timer = setTimeout(() => window.location.assign(nextPath), 500);
    return () => clearTimeout(timer);
  }, [session, nextPath]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isValidEmail(form.email)) {
      setStatus({ tone: "error", text: "Enter a valid email address to continue." });
      return;
    }
    setSubmitting(true);
    setStatus({ tone: "info", text: "Signing in…" });

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await response.json();
      if (!response.ok) {
        setStatus({ tone: "error", text: payload.message ?? payload.error ?? "Login failed. Check your code and try again." });
        setSubmitting(false);
        return;
      }
      setStatus({ tone: "success", text: `Signed in as ${payload.session.email}. Taking you to your workspace…` });
      window.location.assign(nextPath);
    } catch {
      setStatus({ tone: "error", text: "Login request failed. Please try again." });
      setSubmitting(false);
    }
  }

  async function startGoogleSignIn() {
    setGoogleSubmitting(true);
    setGoogleStatus({ tone: "info", text: "Opening Google sign-in…" });

    try {
      const response = await fetch(`/api/auth/google/start?mode=json&next=${encodeURIComponent(nextPath)}`, { cache: "no-store" });
      const payload = await response.json() as GoogleStartPayload;
      if (!response.ok || payload.status !== "ready" || !payload.authUrl) {
        setGoogleStatus({ tone: "error", text: payload.message ?? "Google sign-in is not available yet." });
        setGoogleSubmitting(false);
        return;
      }
      window.location.href = payload.authUrl;
    } catch {
      setGoogleStatus({ tone: "error", text: "Could not start Google sign-in. Please try again." });
      setGoogleSubmitting(false);
    }
  }

  async function signOut() {
    setStatus({ tone: "info", text: "Signing out…" });
    await fetch("/api/auth/logout", { method: "POST" });
    setSession((current) => (current ? { ...current, authenticated: false, session: null } : current));
    setStatus({ tone: "success", text: "Signed out." });
  }

  const googleButton = (
    <button disabled={googleSubmitting} type="button" onClick={startGoogleSignIn} className="btn btn-google btn-block">
      <GoogleGlyph />
      {googleSubmitting ? "Opening Google…" : "Continue with Google"}
    </button>
  );

  return (
    <main id="ledger-main" className="relative px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-2xl">
        <nav className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="inline-flex items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
            <VognaryMark size={22} />
            Vognary
          </Link>
          <Link href="/" className="btn btn-sm btn-ondark border-transparent text-(--ink-soft)">Home</Link>
        </nav>

        <section className="panel p-6 sm:p-8 rise">
          <span className="folio" data-folio="01">Sign in</span>
          <h1 className="mt-3 font-display text-2xl font-semibold text-(--ink) sm:text-3xl">Know what your company is committed to pay next</h1>
          <p className="mt-2 text-sm leading-6 text-(--muted)">Sign in with Google to save the billing receipts you already have, review what renews next, and open the receipt behind each claim.</p>

          {session.authenticated ? (
            <div className="mt-6 rounded-xl border border-line bg-(--card-2) p-4" role="status" aria-live="polite">
              <p className="font-data text-xs uppercase tracking-[0.16em] text-verdict">Signed in</p>
              <p className="mt-2 font-semibold text-(--ink)">{session.session?.email}</p>
              <p className="mt-1 text-sm leading-6 text-(--muted)">Taking you to your workspace…</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href={nextPath} className="btn btn-primary">Continue to app</Link>
                <button type="button" onClick={signOut} className="btn btn-ghost">Sign out</button>
              </div>
            </div>
          ) : (
            <div className="mt-5 grid gap-5">
              <div className="rounded-xl border border-line bg-(--card-2) p-5">
                {guestAuditWaiting ? (
                  <div className="mb-4 border-b border-line pb-4">
                    <p className="eyebrow eyebrow-xs">Your receipts are waiting</p>
                    <p className="mt-2 text-sm leading-6 text-(--ink-soft)">
                      Sign in to save the receipts staged in this tab. They stay here until Vognary confirms the save.
                    </p>
                  </div>
                ) : null}
                {googleButton}
                <p className="mt-3 text-xs leading-5 text-(--muted)">Google is only for sign-in. Vognary does not access Gmail.</p>
                <Notice banner={googleStatus} />
              </div>

              {isDevEnv ? <details className="rounded-xl border border-line bg-(--card-2) p-4">
                <summary className="cursor-pointer select-none font-display text-base font-semibold text-(--ink)">Other ways to sign in</summary>
                <div className="mt-4">
                  <form onSubmit={submit} className="flex flex-col gap-3">
                      <h2 className="font-display text-base font-semibold text-(--ink)">Development login</h2>
                      <div>
                        <label htmlFor="code-email" className="field-label">Configured developer email</label>
                        <input id="code-email" required type="email" autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="field" placeholder="developer@example.com" />
                      </div>
                      <div>
                        <label htmlFor="code-value" className="field-label">Development access code</label>
                        <div className="flex gap-2">
                          <input id="code-value" required type={showCode ? "text" : "password"} autoComplete="off" value={form.accessCode} onChange={(event) => setForm({ ...form, accessCode: event.target.value })} className="field" placeholder="Access code" />
                          <button type="button" onClick={() => setShowCode((value) => !value)} aria-pressed={showCode} className="btn btn-ghost btn-sm shrink-0">{showCode ? "Hide" : "Show"}</button>
                        </div>
                      </div>
                      <button disabled={submitting} type="submit" className="btn btn-ghost btn-block mt-auto disabled:cursor-not-allowed disabled:opacity-60">{submitting ? "Signing in…" : "Sign in as developer"}</button>
                  </form>
                </div>
              </details> : null}

              <ul className="flex flex-wrap items-center gap-x-4 gap-y-2">
                {trustPoints.map((point) => (
                  <li key={point} className="inline-flex items-center gap-1.5 font-data text-[0.66rem] uppercase tracking-[0.12em] text-(--muted)">
                    <span className="live-dot" aria-hidden />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Notice banner={status} />

          <p className="mt-5 text-center text-xs leading-5 text-(--muted)">
            By continuing you agree to our{" "}
            <Link href="/terms" className="text-(--ink-soft) underline underline-offset-2 transition hover:text-(--ink)">Terms</Link>{" "}
            and{" "}
            <Link href="/privacy" className="text-(--ink-soft) underline underline-offset-2 transition hover:text-(--ink)">Privacy Policy</Link>.
          </p>

        </section>
      </div>
    </main>
  );
}

function Notice({ banner }: { banner: Banner }) {
  if (!banner) return null;
  const toneClass: Record<Tone, string> = {
    info: "border-indigo bg-(--indigo-tint) text-indigo",
    error: "border-ember bg-(--ember-tint) text-ember",
    success: "border-verdict bg-(--verdict-tint) text-verdict",
  };
  return (
    <p role="status" aria-live={banner.tone === "error" ? "assertive" : "polite"} className={`mt-3 wrap-break-word rounded-md border px-3 py-2 text-sm ${toneClass[banner.tone]}`}>
      {banner.text}
    </p>
  );
}

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden focusable="false">
      <path fill="#4285F4" d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.859-3.048.859-2.344 0-4.328-1.583-5.036-3.71H.957v2.332A8.997 8.997 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
    </svg>
  );
}

function getGoogleFailureMessage(reason: string) {
  const messages: Record<string, string> = {
    "missing-code": "Google did not return an authorization code.",
    "invalid-state": "Google sign-in state expired. Try again.",
    "token-exchange-failed": "Google sign-in could not be completed. Try again.",
    "missing-id-token": "Google did not return an identity token.",
    "token-validation-failed": "Google identity validation failed.",
    "audience-mismatch": "Google sign-in could not be verified. Try again or contact support.",
    "email-not-verified": "Google email is not verified.",
    "missing-email": "Google did not return an email address.",
    "missing-subject": "Google did not return a stable account identity.",
    "identity-conflict": "This email is already linked to a different Google account. Use the originally linked account or contact support.",
    "not-allowed": "Google sign-in is not available for this account.",
  };
  return messages[reason] ?? "Google sign-in failed. Try again.";
}
