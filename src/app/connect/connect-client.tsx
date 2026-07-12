"use client";

import Link from "next/link";
import { useState } from "react";
import { VognaryMark } from "../brand";

type Tone = "info" | "error" | "success";
type Banner = { tone: Tone; text: string } | null;

const steps = [
  { n: "1", title: "Choose a supported source", body: "Start with the source that can prove the most commitments. Gmail is the first automatic discovery source in beta." },
  { n: "2", title: "Approve on the provider screen", body: "Sign in and approve the exact scope on the provider's official page. Vognary never receives that provider password." },
  { n: "3", title: "Track coverage and freshness", body: "Vognary backfills available evidence, shows the last successful sync, and names every source that is still missing." },
];

const trust = ["Read-only where available", "No bank passwords or PINs", "Stored tokens encrypted", "Disconnect anytime"];

const alsoCovered = [
  "Netflix, Spotify, Prime",
  "OpenAI, Claude, Cursor",
  "Apple, Google Play",
  "Domains & hosting",
  "Insurance & SIPs",
  "Cloud & SaaS bills",
];

export default function ConnectClient() {
  const [connectingInbox, setConnectingInbox] = useState(false);
  const [inboxBanner, setInboxBanner] = useState<Banner>(null);
  const [bankEmail, setBankEmail] = useState("");
  const [bankConsent, setBankConsent] = useState(false);
  const [bankSubmitting, setBankSubmitting] = useState(false);
  const [bankBanner, setBankBanner] = useState<Banner>(null);

  async function connectInbox() {
    setConnectingInbox(true);
    setInboxBanner({ tone: "info", text: "Opening Google's secure consent screen…" });
    try {
      const response = await fetch("/api/integrations/gmail/start?mode=json", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));

      if (response.status === 401 || payload?.status === "unauthenticated") {
        window.location.href = "/login?next=/connect";
        return;
      }
      if (payload?.authUrl) {
        window.location.href = payload.authUrl as string;
        return;
      }
      setInboxBanner({
        tone: "error",
        text: payload?.message ?? "Inbox connection is not configured in this environment yet.",
      });
      setConnectingInbox(false);
    } catch {
      setInboxBanner({ tone: "error", text: "Could not reach the connection service. Please try again." });
      setConnectingInbox(false);
    }
  }

  async function requestBankAccess(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = bankEmail.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setBankBanner({ tone: "error", text: "Enter a valid email address to join the regulated-rail pilot." });
      return;
    }
    if (!bankConsent) {
      setBankBanner({ tone: "error", text: "Confirm that Vognary may store your email and contact you about this pilot." });
      return;
    }

    setBankSubmitting(true);
    setBankBanner({ tone: "info", text: "Saving your pilot request…" });
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          segment: "regulated-bank-rail-pilot",
          message: "Requested Account Aggregator / regulated bank-rail early access from /connect.",
          consentNoticeVersion: "privacy-2026-07-11",
          consentPurpose: "regulated-rail-pilot-contact",
          canContact: true,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.persisted !== true) {
        setBankBanner({
          tone: "error",
          text: payload?.error ?? "The pilot request could not be stored yet. Please use the private-audit form instead.",
        });
        return;
      }
      setBankBanner({ tone: "success", text: "Request saved. We will contact you only when a compliant pilot slot is available." });
    } catch {
      setBankBanner({ tone: "error", text: "Could not reach the pilot service. Please try again." });
    } finally {
      setBankSubmitting(false);
    }
  }

  return (
    <main id="ledger-main" className="relative px-4 pb-16 pt-4 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        {/* Nav */}
        <nav className="glass sticky top-3 z-30 flex items-center justify-between gap-3 rounded-2xl border border-line px-4 py-2.5 sm:px-5">
          <Link href="/" className="inline-flex items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
            <VognaryMark size={24} />
            Vognary
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/app" className="btn btn-sm btn-ondark border-transparent text-(--ink-soft)">Skip for now</Link>
            <Link href="/app" className="btn btn-sm btn-ghost">Go to ledger</Link>
          </div>
        </nav>

        {/* Hero */}
        <section className="dossier spotlight scan overflow-hidden p-7 sm:p-10 lg:p-12">
          <span className="folio" data-folio="Connect" style={{ color: "var(--dossier-muted)" }}>Connect once. Know the coverage.</span>
          <h1 className="mt-6 max-w-3xl font-display text-4xl font-bold leading-[0.98] tracking-[-0.035em] text-(--dossier-ink) sm:text-6xl">
            Connect supported sources.<br />Keep renewals current.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-7 muted-on-dark sm:text-lg">
            Approve a source on its official consent screen and Vognary continuously organizes the evidence that source can provide. Coverage, freshness, and unsupported rails stay visible instead of being presented as universal sync.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2">
            {trust.map((item) => (
              <span key={item} className="inline-flex items-center gap-1.5 font-data text-[0.66rem] uppercase tracking-[0.12em] muted-on-dark">
                <span className="live-dot" aria-hidden />
                {item}
              </span>
            ))}
          </div>
        </section>

        {/* The two aggregator lanes */}
        <section className="grid gap-5 lg:grid-cols-2">
          {/* Inbox — beta connector */}
          <article className="panel lift flex flex-col p-6 sm:p-7">
            <div className="flex items-center justify-between gap-3">
              <span className="pill pill-ready">Start here</span>
              <span className="font-data text-[0.62rem] uppercase tracking-[0.16em] text-verdict">Beta connector</span>
            </div>
            <h2 className="mt-4 font-display text-2xl font-semibold text-(--ink)">Connect your Inbox</h2>
            <p className="mt-2 text-sm leading-6 text-(--muted)">
              Gmail can discover supported receipt, invoice, renewal, trial, and pre-debit messages without per-merchant setup. The beta uses read-only Gmail access and shows the evidence it found; complete mailbox coverage is not implied.
            </p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {alsoCovered.map((item) => (
                <span key={item} className="inset px-2.5 py-1 font-data text-[0.66rem] text-(--muted)">{item}</span>
              ))}
            </div>
            <div className="mt-auto pt-6">
              <button type="button" onClick={connectInbox} disabled={connectingInbox} className="btn btn-google btn-lg btn-block">
                <GoogleGlyph />
                {connectingInbox ? "Opening Google…" : "Connect your Inbox"}
              </button>
              <Notice banner={inboxBanner} />
            </div>
          </article>

          {/* Bank — Account Aggregator */}
          <article className="panel flex flex-col p-6 sm:p-7">
            <div className="flex items-center justify-between gap-3">
              <span className="pill pill-partial">The magic one</span>
              <span className="font-data text-[0.62rem] uppercase tracking-[0.16em] text-ochre">Early access</span>
            </div>
            <h2 className="mt-4 font-display text-2xl font-semibold text-(--ink)">Connect your Bank</h2>
            <p className="mt-2 text-sm leading-6 text-(--muted)">
              Automatic Indian bank coverage requires an approved regulated Account Aggregator, FIU/TSP, issuer, or PSP path. Vognary is recruiting pilot users while that partner rail is being established.
            </p>
            <div className="mt-4 inset p-4">
              <p className="eyebrow" style={{ fontSize: "0.6rem" }}>How it stays safe</p>
              <p className="mt-2 text-sm leading-6 text-(--muted)">
                When the rail becomes available, consent will happen through the regulated provider and will be limited by purpose, accounts, data range, and expiry. Vognary will not ask for a netbanking password, UPI PIN, or card PIN.
              </p>
            </div>
            <div className="mt-auto pt-6">
              <form onSubmit={requestBankAccess} className="grid gap-3">
                <label htmlFor="bank-pilot-email" className="field-label">Email for the regulated-rail pilot</label>
                <input
                  id="bank-pilot-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={bankEmail}
                  onChange={(event) => setBankEmail(event.target.value)}
                  className="field"
                  placeholder="you@company.com"
                />
                <label className="flex items-start gap-2 text-xs leading-5 text-(--muted)">
                  <input type="checkbox" checked={bankConsent} onChange={(event) => setBankConsent(event.target.checked)} className="mt-1" />
                  <span>I agree that Vognary may store this email and contact me about the regulated-rail pilot under the <Link href="/privacy" className="underline underline-offset-2">Privacy Notice</Link>.</span>
                </label>
                <button type="submit" disabled={bankSubmitting} className="btn btn-primary btn-lg btn-block disabled:cursor-not-allowed disabled:opacity-60">
                  {bankSubmitting ? "Saving request…" : "Request early access"}
                </button>
              </form>
              <Notice banner={bankBanner} />
              <p className="mt-3 font-data text-[0.66rem] leading-5 text-(--muted)">This records a pilot request; it does not claim that a bank connection is already available.</p>
            </div>
          </article>
        </section>

        {/* How it works */}
        <section className="panel p-6 sm:p-8">
          <span className="folio" data-folio="Flow">How connecting works</span>
          <h2 className="mt-3 font-display text-2xl font-semibold text-(--ink) sm:text-3xl">Automatic where supported. Explicit everywhere else.</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {steps.map((step) => (
              <div key={step.n} className="inset p-5">
                <span className="step-num">{step.n}</span>
                <h3 className="mt-4 font-display text-lg font-semibold text-(--ink)">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-(--muted)">{step.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm leading-6 text-(--muted)">
            OAuth sources use provider consent. Some direct workspace integrations may require an administrator to store a scoped API key in Vognary&apos;s encrypted token vault. Vognary does not ask for bank passwords, card numbers, UPI PINs, or card PINs. Unsupported sources remain visible as coverage gaps or optional recovery imports.
          </p>
        </section>

        {/* Footer */}
        <footer className="panel flex flex-col items-center gap-3 px-5 py-6 text-center">
          <div className="flex items-center gap-2.5">
            <VognaryMark size={22} className="text-(--ink)" />
            <span className="font-display text-base font-semibold text-(--ink)">Vognary <span className="font-normal text-(--muted)">· Connect evidence, see coverage</span></span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 font-data text-[0.66rem] uppercase tracking-[0.16em] text-(--muted)">
            <Link className="transition hover:text-(--ink)" href="/security">Security</Link>
            <span className="text-(--line-strong)">·</span>
            <Link className="transition hover:text-(--ink)" href="/privacy">Privacy</Link>
            <span className="text-(--line-strong)">·</span>
            <Link className="transition hover:text-(--ink)" href="/app">Ledger</Link>
          </div>
        </footer>
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
