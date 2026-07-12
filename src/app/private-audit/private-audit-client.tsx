"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { VognaryMark } from "../brand";

const personas = [
  "Founder",
  "Freelancer",
  "Agency owner",
  "AI builder",
  "Developer",
  "Household / personal user",
  "CA / finance operator",
  "Other",
];

const paymentTypes = [
  "AI tools",
  "SaaS tools",
  "Cloud hosting",
  "Domains",
  "App stores",
  "UPI AutoPay",
  "Card mandates",
  "Insurance",
  "EMIs",
  "SIPs",
  "Utilities",
  "Streaming",
  "Other",
];

const sourceTypes = [
  "Redacted bank/card statement",
  "UPI/card mandate screenshot",
  "SaaS invoices",
  "Cloud invoices",
  "Gmail receipt snippets",
  "Apple/Google Play screenshot",
  "Manual list only",
  "Not sure yet",
];

const concerns = [
  "Privacy",
  "Time",
  "Not sure it is useful",
  "Do not want to upload financial data",
  "Need full bank automation",
  "Price",
  "Other",
];

const auditOutcomes = [
  "One recurring ledger with source, amount, cadence, next expected debit, and confidence.",
  "Missing-source map for Gmail, UPI, cards, app stores, bank debits, SaaS, cloud, domains, EMIs, SIPs, insurance, and utilities.",
  "Action labels for keep, watch, downgrade, cancel, and investigate, with the evidence behind each label.",
  "A redaction-first source plan so you know the minimum proof to share next instead of uploading everything.",
];

const safetyRules = [
  "Share exports, receipts, screenshots, or snippets only after removing account numbers and personal identifiers.",
  "Never send passwords, OTPs, CVV, card numbers, netbanking credentials, or full identity documents.",
  "Use official provider consent or scoped API keys only when a connector is available and clearly marked.",
  "Ask for deletion/export before sharing more evidence if anything feels unclear.",
];

const sourceTiers = [
  { label: "Fastest start", value: "CSV statement + Gmail receipt snippets" },
  { label: "Founder stack", value: "OpenAI, GitHub, Vercel/Render, Cloudflare, domains" },
  { label: "India rails", value: "UPI AutoPay, card mandates, SIPs, EMIs, insurance" },
];

type IntakeForm = {
  name: string;
  email: string;
  contact: string;
  persona: string;
  spendGuess: string;
  paymentTypes: string[];
  sourceTypes: string[];
  biggestConcern: string;
  canContact: boolean;
  message: string;
};

const initialForm: IntakeForm = {
  name: "",
  email: "",
  contact: "",
  persona: "Founder",
  spendGuess: "",
  paymentTypes: ["AI tools", "SaaS tools"],
  sourceTypes: ["Redacted bank/card statement"],
  biggestConcern: "Privacy",
  canContact: false,
  message: "",
};

export default function PrivateAuditClient() {
  const [form, setForm] = useState<IntakeForm>(initialForm);
  const [status, setStatus] = useState<string | null>(null);
  const [brief, setBrief] = useState<string | null>(null);
  const [lead, setLead] = useState<{ id: string; email: string } | null>(null);
  const selectedSummary = useMemo(() => [...form.paymentTypes, ...form.sourceTypes].slice(0, 5).join(" / "), [form.paymentTypes, form.sourceTypes]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("Submitting audit request...");
    setBrief(null);
    setLead(null);

    const sourceTag = new URLSearchParams(window.location.search).get("src") ?? undefined;
    const response = await fetch("/api/audit-intake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...form, sourceTag }),
    });
    const payload = await response.json();

    if (!response.ok) {
      setStatus(payload.error ?? "Audit request failed.");
      return;
    }

    const generatedBrief = buildBrief(form);
    setBrief(generatedBrief);
    if (typeof payload.leadId === "string" && payload.leadId) {
      setLead({ id: payload.leadId, email: form.email.trim().toLowerCase() });
    }
    setStatus(payload.persisted
      ? "Audit request received. I will reply with the safest minimum source to share."
      : "Request prepared. This deployment still needs AUDIT_INTAKE_WEBHOOK_URL to persist leads; copy the brief below as backup.");
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
            <Link href="/sources" className="btn btn-ghost">Source guide</Link>
            <Link href="/app?guest=1" className="btn btn-primary">Open audit app</Link>
          </div>
        </div>

        <section className="grid gap-5 lg:grid-cols-[0.92fr_1.08fr]">
          <aside className="dossier spotlight scan p-7 sm:p-9 rise">
            <span className="folio" data-folio="Beta" style={{ color: "var(--dossier-muted)" }}>Private audit</span>
            <h1 className="mt-5 font-display text-3xl font-bold leading-tight text-(--dossier-ink) sm:text-5xl">
              Prove what renews{" "}<br /><span className="glow-num">before it charges.</span>
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 muted-on-dark">
              Apply for a redaction-first audit across SaaS, AI tools, cloud, domains, app stores, UPI AutoPay, card mandates, insurance, EMIs, SIPs, utilities, and receipt emails.
            </p>
            <div className="mt-8 grid gap-2.5 sm:grid-cols-3">
              <Proof label="Beta spots" value="10" />
              <Proof label="Personal" value="INR 999" />
              <Proof label="Founder/team" value="INR 4,999" />
            </div>
            <div className="mt-8 rounded-[11px] border p-4" style={{ borderColor: "var(--dossier-line)", background: "rgba(243,234,214,0.04)" }}>
              <h2 className="font-display text-lg font-semibold text-(--dossier-ink)">What you get</h2>
              <ul className="mt-3 space-y-2 text-sm leading-6 muted-on-dark">
                {auditOutcomes.map((outcome) => <li key={outcome}>{outcome}</li>)}
              </ul>
            </div>
            <div className="mt-4 grid gap-2.5">
              {sourceTiers.map((tier) => (
                <div key={tier.label} className="rounded-[9px] border px-3 py-2.5" style={{ borderColor: "var(--dossier-line)", background: "rgba(243,234,214,0.04)" }}>
                  <p className="font-data text-[0.54rem] uppercase tracking-[0.18em]" style={{ color: "var(--dossier-muted)" }}>{tier.label}</p>
                  <p className="mt-1.5 text-sm leading-6 text-(--dossier-ink)">{tier.value}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-[11px] border p-4" style={{ borderColor: "var(--dossier-line)", background: "rgba(243,234,214,0.04)" }}>
              <h2 className="font-display text-lg font-semibold text-(--dossier-ink)">Do not send</h2>
              <ul className="mt-3 space-y-2 text-sm leading-6 muted-on-dark">
                {safetyRules.map((rule) => <li key={rule}>{rule}</li>)}
              </ul>
            </div>
          </aside>

          <form onSubmit={submit} className="panel p-6 sm:p-8 rise">
            <span className="folio" data-folio="01">Audit request</span>
            <h2 className="mt-3 font-display text-2xl font-semibold text-(--ink)">Request a proof-backed audit</h2>
            <p className="mt-2 text-sm leading-6 text-(--muted)">Tell us which recurring rails you use. We reply with the safest minimum source to share first. You do not need to upload financial documents on this page.</p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <label className="grid gap-2">
                <span className="field-label">Name</span>
                <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="field" placeholder="Your name" />
              </label>
              <label className="grid gap-2">
                <span className="field-label">Email</span>
                <input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="field" placeholder="you@example.com" />
              </label>
              <label className="grid gap-2">
                <span className="field-label">Who is this for?</span>
                <select value={form.persona} onChange={(event) => setForm({ ...form, persona: event.target.value })} className="field">
                  {personas.map((persona) => <option key={persona} value={persona}>{persona}</option>)}
                </select>
              </label>
              <label className="grid gap-2">
                <span className="field-label">Biggest concern</span>
                <select value={form.biggestConcern} onChange={(event) => setForm({ ...form, biggestConcern: event.target.value })} className="field">
                  {concerns.map((concern) => <option key={concern} value={concern}>{concern}</option>)}
                </select>
              </label>
            </div>

            <div className="mt-5 rounded-[11px] border border-line bg-(--card-2) p-4">
              <p className="font-data text-[0.66rem] uppercase tracking-[0.16em] text-verdict">What happens after you submit</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <MiniStep title="1. Minimum source" body="We reply with the safest first source to share, usually a redacted CSV or receipt set." />
                <MiniStep title="2. Proof pass" body="Vognary identifies recurring items, confidence, next debits, and missing rails." />
                <MiniStep title="3. Action review" body="You get a keep/watch/downgrade/cancel/investigate review before sharing more." />
              </div>
            </div>

            <details className="mt-5 rounded-[11px] border border-line bg-(--card-2) p-4">
              <summary className="cursor-pointer select-none font-display text-base font-semibold text-(--ink)">Add details so we can prepare faster</summary>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="grid gap-2 sm:col-span-2">
                  <span className="field-label">WhatsApp, Telegram, or LinkedIn URL <span className="font-normal text-(--muted)">(optional)</span></span>
                  <input value={form.contact} onChange={(event) => setForm({ ...form, contact: event.target.value })} className="field" placeholder="Where should we reply fastest?" />
                </label>
                <label className="grid gap-2 sm:col-span-2">
                  <span className="field-label">Monthly recurring spend guess <span className="font-normal text-(--muted)">(optional)</span></span>
                  <input value={form.spendGuess} onChange={(event) => setForm({ ...form, spendGuess: event.target.value })} className="field" placeholder="Example: INR 15,000" />
                </label>
              </div>
              <ChoiceGroup
                legend="What do you pay for monthly?"
                values={paymentTypes}
                selected={form.paymentTypes}
                onChange={(next) => setForm({ ...form, paymentTypes: next })}
              />
              <ChoiceGroup
                legend="Which sources can you share after we reply?"
                values={sourceTypes}
                selected={form.sourceTypes}
                onChange={(next) => setForm({ ...form, sourceTypes: next })}
              />
              <div className="mt-5 grid gap-2">
                <label className="text-sm font-semibold text-(--ink)">Anything specific to audit?</label>
                <textarea value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} className="field min-h-28" placeholder="Example: AI tools, AWS, domains, card mandates, SIPs, EMIs, app-store subscriptions..." />
              </div>
            </details>

            <label className="mt-5 flex items-start gap-3 rounded-[11px] border border-line bg-(--card-2) p-3 text-sm leading-6 text-(--ink-soft)">
              <input type="checkbox" checked={form.canContact} onChange={(event) => setForm({ ...form, canContact: event.target.checked })} className="mt-1 accent-(--gold)" />
              You can contact me about this private audit. I understand I should redact sensitive details and never send passwords, OTPs, CVV, bank credentials, or identity documents.
            </label>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button type="submit" className="btn btn-primary">Request private audit</button>
              <span className="font-data text-xs text-(--muted)">{selectedSummary || "Select at least one source"}</span>
            </div>
            {status ? <p className="mt-4 rounded-md border border-indigo bg-(--indigo-tint) px-3 py-2 text-sm text-indigo">{status}</p> : null}
            {lead ? <AuditPaymentStep lead={lead} /> : null}
            {brief ? <textarea readOnly value={brief} className="field field-mono mt-4 min-h-44" aria-label="Generated audit request backup" /> : null}
          </form>
        </section>
      </div>
    </main>
  );
}

function ChoiceGroup({ legend, values, selected, onChange }: { legend: string; values: string[]; selected: string[]; onChange: (next: string[]) => void }) {
  return (
    <fieldset className="mt-5">
      <legend className="text-sm font-semibold text-(--ink)">{legend}</legend>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {values.map((value) => {
          const isSelected = selected.includes(value);
          return (
            <label key={value} className="flex min-h-11 items-center gap-2 rounded-[10px] border border-line bg-(--card-2) px-3 py-2 text-sm text-(--ink-soft)">
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => onChange(isSelected ? selected.filter((item) => item !== value) : [...selected, value])}
                className="accent-(--gold)"
              />
              {value}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

type AuditCheckoutOffer =
  | { state: "loading" }
  | { state: "ready"; amountMinor: number; currency: string }
  | { state: "link-only"; paymentUrl: string }
  | { state: "not-configured" }
  | { state: "unavailable" };

function AuditPaymentStep({ lead }: { lead: { id: string; email: string } }) {
  const [offer, setOffer] = useState<AuditCheckoutOffer>({ state: "loading" });
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/checkout?plan=annual")
      .then(async (response) => {
        const payload = await response.json();
        if (cancelled) return;
        if (payload.status === "ready" && typeof payload.amountMinor === "number") {
          setOffer({ state: "ready", amountMinor: payload.amountMinor, currency: payload.currency ?? "INR" });
        } else if (payload.status === "link-only" && typeof payload.paymentUrl === "string") {
          setOffer({ state: "link-only", paymentUrl: payload.paymentUrl });
        } else {
          setOffer({ state: "not-configured" });
        }
      })
      .catch(() => { if (!cancelled) setOffer({ state: "unavailable" }); });
    return () => { cancelled = true; };
  }, [lead.id]);

  async function pay() {
    if (offer.state !== "ready" || paying) return;
    setPaying(true);
    setPayError(null);
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `private-audit:${lead.id}`,
        },
        body: JSON.stringify({ plan: "annual", email: lead.email, leadId: lead.id }),
      });
      const payload = await response.json();
      if (response.ok && typeof payload.paymentUrl === "string") {
        window.location.href = payload.paymentUrl;
        return;
      }
      setPayError(payload.error ?? "The checkout could not be started. Retry in a moment; the same request is safe to repeat.");
    } catch {
      setPayError("The checkout could not be started. Retry in a moment; the same request is safe to repeat.");
    } finally {
      setPaying(false);
    }
  }

  if (offer.state === "loading") return null;

  return (
    <div className="mt-4 rounded-[11px] border border-line bg-(--card-2) p-4">
      <p className="font-data text-[0.66rem] uppercase tracking-[0.16em] text-verdict">Optional — reserve your audit now</p>
      {offer.state === "ready" ? (
        <>
          <p className="mt-2 text-sm leading-6 text-(--ink-soft)">
            One-time private audit — <span className="font-data font-semibold">INR {(offer.amountMinor / 100).toLocaleString("en-IN")}</span>.
            Payment runs on Razorpay and is confirmed by its signed webhook; you get a public status page and a receipt email.
            Paying now reserves your slot, or simply wait for our reply first.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" onClick={pay} disabled={paying} className="btn btn-primary">
              {paying ? "Opening Razorpay..." : "Pay for the audit"}
            </button>
            <span className="font-data text-xs text-(--muted)">Server-verified amount. No card details touch Vognary.</span>
          </div>
          {payError ? <p className="mt-3 rounded-md border border-line px-3 py-2 text-sm text-(--muted)">{payError}</p> : null}
        </>
      ) : offer.state === "link-only" ? (
        <p className="mt-2 text-sm leading-6 text-(--ink-soft)">
          Tracked checkout is not active yet. You can pay through this fallback payment link;
          it does not grant an automatic entitlement, so we reconcile it manually against your audit request:
          {" "}<a href={offer.paymentUrl} className="underline" rel="noreferrer">open payment link</a>.
        </p>
      ) : offer.state === "not-configured" ? (
        <p className="mt-2 text-sm leading-6 text-(--ink-soft)">
          Online payment is not activated yet. No action needed — we reply to your request with next steps,
          and payment happens only after you see the audit plan.
        </p>
      ) : (
        <p className="mt-2 text-sm leading-6 text-(--ink-soft)">
          Payment status could not be checked right now. Your audit request is saved; we reply by email with next steps.
        </p>
      )}
    </div>
  );
}

function Proof({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[9px] border px-3 py-2.5" style={{ borderColor: "var(--dossier-line)", background: "rgba(243,234,214,0.04)" }}>
      <p className="font-data text-[0.54rem] uppercase tracking-[0.18em]" style={{ color: "var(--dossier-muted)" }}>{label}</p>
      <p className="font-data mt-1.5 text-lg font-semibold tnum text-(--dossier-ink)">{value}</p>
    </div>
  );
}

function MiniStep({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <p className="font-display text-sm font-semibold text-(--ink)">{title}</p>
      <p className="mt-1 text-xs leading-5 text-(--muted)">{body}</p>
    </div>
  );
}

function buildBrief(form: IntakeForm) {
  return [
    "Vognary private audit request",
    `Name: ${form.name}`,
    `Email: ${form.email}`,
    `Contact: ${form.contact || "not provided"}`,
    `Persona: ${form.persona}`,
    `Spend guess: ${form.spendGuess || "not provided"}`,
    `Pays for: ${form.paymentTypes.join(", ")}`,
    `Can share: ${form.sourceTypes.join(", ")}`,
    `Biggest concern: ${form.biggestConcern}`,
    `Message: ${form.message || "not provided"}`,
  ].join("\n");
}
