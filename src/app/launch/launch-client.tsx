"use client";

import Link from "next/link";
import { useState } from "react";

const segments = ["Founder / builder", "Freelancer", "Small team", "Household", "Investor", "Accountant / CFO"];

export default function LaunchClient() {
  const [form, setForm] = useState({ name: "", email: "", segment: segments[0], message: "" });
  const [status, setStatus] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("Submitting...");
    const response = await fetch("/api/waitlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    const payload = await response.json();
    setStatus(response.ok ? (payload.persisted ? "Your audit request is captured." : "Request accepted locally. Configure WAITLIST_WEBHOOK_URL before public launch.") : payload.error ?? "Signup failed.");
  }

  return (
    <main className="relative px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <span className="font-display text-lg font-semibold text-(--ink)">Vognary <span className="text-(--muted)">· Blacklight for money</span></span>
          <Link href="/" className="btn btn-ghost">Open the ledger</Link>
        </div>
        <section className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
          <div
            className="dossier spotlight scan p-7 sm:p-9 rise"
            onMouseMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              event.currentTarget.style.setProperty("--mx", `${((event.clientX - rect.left) / rect.width) * 100}%`);
              event.currentTarget.style.setProperty("--my", `${((event.clientY - rect.top) / rect.height) * 100}%`);
            }}
          >
            <span className="folio" data-folio="§ 00" style={{ color: "var(--dossier-muted)" }}>Recurring intelligence</span>
            <h1 className="mt-5 font-display text-4xl font-bold leading-[1.0] tracking-[-0.03em] text-(--dossier-ink) sm:text-6xl">Find the money<br /><span className="glow-num">leaking in silence.</span></h1>
            <p className="mt-5 max-w-2xl text-base leading-7 muted-on-dark">Vognary audits statements, receipts, and manual mandates to show every recurring commitment, upcoming debit, confidence score, and cancel or downgrade action.</p>
            <div className="mt-8 grid gap-2.5 sm:grid-cols-3">
              <Proof label="Self-serve audit" value="Live" />
              <Proof label="Audit API" value="Live" />
              <Proof label="Storage" value="Stateless" />
            </div>
            <div className="mt-8 rounded-[11px] border p-4" style={{ borderColor: "var(--dossier-line)", background: "rgba(243,234,214,0.04)" }}>
              <h2 className="font-display text-lg font-semibold text-(--dossier-ink)">First-customer promise</h2>
              <p className="mt-2 text-sm leading-6 muted-on-dark">Upload statements and add missing app-store, UPI, and card mandates. Vognary returns recurring spend, annual burn, reviewable waste, next debits, and evidence you can verify.</p>
            </div>
          </div>

          <form onSubmit={submit} className="panel p-6 sm:p-8 rise">
            <span className="folio" data-folio="§ 01">Request access</span>
            <h2 className="mt-3 font-display text-2xl font-semibold text-(--ink)">Request a recurring audit</h2>
            <p className="mt-2 text-sm leading-6 text-(--muted)">Use this to request help auditing cards, bank exports, app-store subscriptions, UPI mandates, cloud bills, and SaaS renewals.</p>
            <div className="mt-5 grid gap-2.5">
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="field" placeholder="Name" />
              <input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="field" placeholder="Email" />
              <select value={form.segment} onChange={(event) => setForm({ ...form, segment: event.target.value })} className="field">
                {segments.map((segment) => <option key={segment} value={segment}>{segment}</option>)}
              </select>
              <textarea value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} className="field min-h-28" placeholder="What recurring payments do you want Vognary to find?" />
              <button type="submit" className="btn btn-ember">Request audit</button>
            </div>
            {status ? <p className="mt-4 rounded-md border border-indigo bg-(--indigo-tint) px-3 py-2 text-sm text-indigo">{status}</p> : null}
            <Link href="/" className="mt-4 inline-flex text-sm font-semibold text-ember">Open Vognary →</Link>
          </form>
        </section>
      </div>
    </main>
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