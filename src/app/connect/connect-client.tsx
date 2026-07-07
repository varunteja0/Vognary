"use client";

import Link from "next/link";
import { useState } from "react";
import { VognaryMark } from "../brand";

type Tone = "info" | "error" | "success";
type Banner = { tone: Tone; text: string } | null;

const steps = [
  { n: "1", title: "Click Connect", body: "Pick your inbox or your bank. That's the only decision you make." },
  { n: "2", title: "Approve on their screen", body: "You log in and approve on the provider's own official page — never on ours." },
  { n: "3", title: "We do the rest", body: "Vognary reads only what you allowed and builds one live recurring-money ledger." },
];

const trust = ["Read-only access", "No passwords, ever", "Bank-grade encryption", "Delete anytime"];

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
  const [bankOpen, setBankOpen] = useState(false);

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
        text: payload?.message ?? "Inbox connection isn't available in this environment yet. It's live on vognary.com.",
      });
      setConnectingInbox(false);
    } catch {
      setInboxBanner({ tone: "error", text: "Could not reach the connection service. Please try again." });
      setConnectingInbox(false);
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
          <span className="folio" data-folio="Connect" style={{ color: "var(--dossier-muted)" }}>One click. Everything.</span>
          <h1 className="mt-6 max-w-3xl font-display text-4xl font-bold leading-[0.98] tracking-[-0.035em] text-(--dossier-ink) sm:text-6xl">
            Connect once.<br />See every rupee that renews.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-7 muted-on-dark sm:text-lg">
            You never paste an API key or a password. You click <span className="text-(--dossier-ink)">Connect</span>, approve on the provider&apos;s own screen, and Vognary builds one live ledger of every subscription, EMI, loan, mandate, and auto-debit.
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
          {/* Inbox — LIVE */}
          <article className="panel lift flex flex-col p-6 sm:p-7">
            <div className="flex items-center justify-between gap-3">
              <span className="pill pill-ready">Start here</span>
              <span className="font-data text-[0.62rem] uppercase tracking-[0.16em] text-verdict">Live</span>
            </div>
            <h2 className="mt-4 font-display text-2xl font-semibold text-(--ink)">Connect your Inbox</h2>
            <p className="mt-2 text-sm leading-6 text-(--muted)">
              One consent to Gmail finds subscriptions from your receipts automatically — hundreds of merchants, no per-app setup. Read-only; Vognary never sees your Google password.
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
              One secure consent shows <span className="text-(--ink-soft)">every</span> EMI, loan, UPI AutoPay, card mandate, SIP, and auto-debit — because it all flows through your account. Exactly like the consent you approve in PhonePe or Google Pay.
            </p>
            <div className="mt-4 inset p-4">
              <p className="eyebrow" style={{ fontSize: "0.6rem" }}>How it stays safe</p>
              <p className="mt-2 text-sm leading-6 text-(--muted)">
                Bank data connects through India&apos;s <span className="text-(--ink-soft)">RBI-regulated Account Aggregator</span> network. You approve a read-only consent with your bank — no account numbers or passwords are ever shared with Vognary.
              </p>
            </div>
            <div className="mt-auto pt-6">
              <button type="button" onClick={() => setBankOpen((v) => !v)} aria-expanded={bankOpen} className="btn btn-primary btn-lg btn-block">
                {bankOpen ? "Got it — keep me posted" : "Request early access"}
              </button>
              {bankOpen ? (
                <div className="mt-3 rounded-md border border-verdict bg-(--verdict-tint) px-3 py-2 text-sm text-verdict" role="status" aria-live="polite">
                  You&apos;re on the early-access list for bank connections. Want a hands-on review meanwhile? <Link href="/private-audit" className="underline underline-offset-2">Ask for a private audit →</Link>
                </div>
              ) : (
                <p className="mt-3 font-data text-[0.66rem] leading-5 text-(--muted)">Onboarding as an Account Aggregator partner — join the first cohort.</p>
              )}
            </div>
          </article>
        </section>

        {/* How it works */}
        <section className="panel p-6 sm:p-8">
          <span className="folio" data-folio="Flow">How connecting works</span>
          <h2 className="mt-3 font-display text-2xl font-semibold text-(--ink) sm:text-3xl">No API. No pasting. No technical work.</h2>
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
            You will never be asked for an API key, a token, a card number, or a bank password — anywhere in Vognary. If a provider can&apos;t be connected safely, we simply read its receipt from your inbox instead.
          </p>
        </section>

        {/* Footer */}
        <footer className="panel flex flex-col items-center gap-3 px-5 py-6 text-center">
          <div className="flex items-center gap-2.5">
            <VognaryMark size={22} className="text-(--ink)" />
            <span className="font-display text-base font-semibold text-(--ink)">Vognary <span className="font-normal text-(--muted)">· Connect once, see everything</span></span>
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
