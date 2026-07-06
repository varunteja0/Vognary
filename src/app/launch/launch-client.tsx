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
    setStatus(response.ok ? (payload.persisted ? "You are on the private beta list." : "Preview accepted. Configure WAITLIST_WEBHOOK_URL before public launch.") : payload.error ?? "Signup failed.");
  }

  return (
    <main className="min-h-screen px-5 py-10 text-foreground sm:px-8">
      <section className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-lg border border-line bg-(--surface) p-6 shadow-sm">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.24em] text-(--accent)">Vognary Launch</p>
          <h1 className="mt-4 text-4xl font-semibold text-[#151712] sm:text-6xl">Find recurring money leaks before they debit.</h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-(--muted)">
            Vognary audits statements, receipts, and manual mandates to show every recurring commitment, upcoming debit, confidence score, and cancellation/downgrade action.
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <Proof label="Private beta" value="Working" />
            <Proof label="Audit API" value="Live" />
            <Proof label="Storage" value="Stateless" />
          </div>
          <div className="mt-8 rounded-lg border border-line bg-[#fbfcf8] p-4">
            <h2 className="text-lg font-semibold text-[#151712]">First customer promise</h2>
            <p className="mt-2 text-sm leading-6 text-(--muted)">Upload statements and add missing app-store/UPI/card mandates. Vognary returns recurring spend, annual burn, reviewable waste, next debits, and evidence you can verify.</p>
          </div>
        </div>

        <form onSubmit={submit} className="rounded-lg border border-line bg-(--surface) p-6 shadow-sm">
          <h2 className="text-2xl font-semibold text-[#151712]">Join the private beta</h2>
          <p className="mt-2 text-sm leading-6 text-(--muted)">Use this for founder interviews, investor demos, and early adopter capture.</p>
          <div className="mt-5 grid gap-3">
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="h-11 rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-(--accent)" placeholder="Name" />
            <input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="h-11 rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-(--accent)" placeholder="Email" />
            <select value={form.segment} onChange={(event) => setForm({ ...form, segment: event.target.value })} className="h-11 rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-(--accent)">
              {segments.map((segment) => <option key={segment} value={segment}>{segment}</option>)}
            </select>
            <textarea value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} className="min-h-28 rounded-md border border-line bg-white p-3 text-sm outline-none focus:border-(--accent)" placeholder="What recurring payments do you want Vognary to find?" />
            <button type="submit" className="h-11 rounded-md bg-(--accent) px-4 text-sm font-semibold text-white transition hover:bg-(--accent-strong)">Request Audit</button>
          </div>
          {status ? <p className="mt-4 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">{status}</p> : null}
          <Link href="/" className="mt-4 inline-flex text-sm font-semibold text-(--accent)">Open product demo</Link>
        </form>
      </section>
    </main>
  );
}

function Proof({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-[#fbfcf8] p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-(--muted)">{label}</p>
      <p className="mt-2 text-lg font-semibold text-[#151712]">{value}</p>
    </div>
  );
}