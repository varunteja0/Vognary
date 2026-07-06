"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
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
  canContact: true,
  message: "",
};

export default function PrivateAuditClient() {
  const [form, setForm] = useState<IntakeForm>(initialForm);
  const [status, setStatus] = useState<string | null>(null);
  const [brief, setBrief] = useState<string | null>(null);
  const selectedSummary = useMemo(() => [...form.paymentTypes, ...form.sourceTypes].slice(0, 5).join(" / "), [form.paymentTypes, form.sourceTypes]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("Submitting audit request...");
    setBrief(null);

    const response = await fetch("/api/audit-intake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    const payload = await response.json();

    if (!response.ok) {
      setStatus(payload.error ?? "Audit request failed.");
      return;
    }

    const generatedBrief = buildBrief(form);
    setBrief(generatedBrief);
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
            <Link href="/" className="btn btn-primary">Open audit app</Link>
          </div>
        </div>

        <section className="grid gap-5 lg:grid-cols-[0.92fr_1.08fr]">
          <aside className="dossier spotlight scan p-7 sm:p-9 rise">
            <span className="folio" data-folio="Beta" style={{ color: "var(--dossier-muted)" }}>Private audit</span>
            <h1 className="mt-5 font-display text-3xl font-bold leading-tight text-(--dossier-ink) sm:text-5xl">
              Get help reviewing{" "}<br /><span className="glow-num">recurring payments.</span>
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 muted-on-dark">
              Apply for a private review across SaaS, AI tools, cloud, domains, app stores, UPI AutoPay, card mandates, insurance, EMIs, SIPs, utilities, and receipt emails.
            </p>
            <div className="mt-8 grid gap-2.5 sm:grid-cols-3">
              <Proof label="Beta spots" value="10" />
              <Proof label="Personal" value="INR 999" />
              <Proof label="Founder/team" value="INR 4,999" />
            </div>
            <div className="mt-8 rounded-[11px] border p-4" style={{ borderColor: "var(--dossier-line)", background: "rgba(243,234,214,0.04)" }}>
              <h2 className="font-display text-lg font-semibold text-(--dossier-ink)">What you get</h2>
              <ul className="mt-3 space-y-2 text-sm leading-6 muted-on-dark">
                <li>Monthly total and yearly total.</li>
                <li>Upcoming debits before they hit.</li>
                <li>Keep, watch, cancel, downgrade, and investigate labels.</li>
                <li>List of missing sources to check.</li>
                <li>PDF/CSV report with proof for every recommendation.</li>
              </ul>
            </div>
            <div className="mt-4 rounded-[11px] border p-4" style={{ borderColor: "var(--dossier-line)", background: "rgba(243,234,214,0.04)" }}>
              <h2 className="font-display text-lg font-semibold text-(--dossier-ink)">Do not send</h2>
              <p className="mt-2 text-sm leading-6 muted-on-dark">Passwords, OTPs, CVV, netbanking credentials, full identity documents, card numbers, or unredacted account numbers.</p>
            </div>
          </aside>

          <form onSubmit={submit} className="panel p-6 sm:p-8 rise">
            <span className="folio" data-folio="01">Audit request</span>
            <h2 className="mt-3 font-display text-2xl font-semibold text-(--ink)">Request a private audit</h2>
            <p className="mt-2 text-sm leading-6 text-(--muted)">Fill this first. I will reply with the safest minimum source to share. You do not need to upload financial documents on this page.</p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="field" placeholder="Name" />
              <input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="field" placeholder="Email" />
              <input value={form.contact} onChange={(event) => setForm({ ...form, contact: event.target.value })} className="field sm:col-span-2" placeholder="WhatsApp, Telegram, or LinkedIn URL" />
              <select value={form.persona} onChange={(event) => setForm({ ...form, persona: event.target.value })} className="field">
                {personas.map((persona) => <option key={persona} value={persona}>{persona}</option>)}
              </select>
              <input value={form.spendGuess} onChange={(event) => setForm({ ...form, spendGuess: event.target.value })} className="field" placeholder="Monthly recurring spend guess" />
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
              <label className="text-sm font-semibold text-(--ink)">Biggest concern</label>
              <select value={form.biggestConcern} onChange={(event) => setForm({ ...form, biggestConcern: event.target.value })} className="field">
                {concerns.map((concern) => <option key={concern} value={concern}>{concern}</option>)}
              </select>
            </div>

            <div className="mt-5 grid gap-2">
              <label className="text-sm font-semibold text-(--ink)">Anything specific to audit?</label>
              <textarea value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} className="field min-h-28" placeholder="Example: AI tools, AWS, domains, card mandates, SIPs, EMIs, app-store subscriptions..." />
            </div>

            <label className="mt-5 flex items-start gap-3 rounded-[11px] border border-line bg-(--card-2) p-3 text-sm leading-6 text-(--ink-soft)">
              <input type="checkbox" checked={form.canContact} onChange={(event) => setForm({ ...form, canContact: event.target.checked })} className="mt-1 accent-[var(--gold)]" />
              You can contact me about this private audit. I understand I should redact sensitive details and never send passwords, OTPs, CVV, bank credentials, or identity documents.
            </label>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button type="submit" className="btn btn-primary">Request private audit</button>
              <span className="font-data text-xs text-(--muted)">{selectedSummary || "Select at least one source"}</span>
            </div>
            {status ? <p className="mt-4 rounded-md border border-indigo bg-(--indigo-tint) px-3 py-2 text-sm text-indigo">{status}</p> : null}
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
                className="accent-[var(--gold)]"
              />
              {value}
            </label>
          );
        })}
      </div>
    </fieldset>
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