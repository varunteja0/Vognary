import type { Metadata } from "next";
import Link from "next/link";
import { VognaryMark } from "../brand";

export const metadata: Metadata = {
  title: "Offline",
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return (
    <main className="page-shell flex min-h-screen items-center justify-center px-4 py-16">
      <section className="w-full max-w-2xl border-y-2 border-(--line-strong) py-10" aria-labelledby="offline-heading">
        <div className="flex items-center gap-3">
          <VognaryMark size={36} />
          <span className="font-display text-lg font-semibold text-(--ink)">Vognary</span>
        </div>
        <p className="truth-label truth-frozen mt-10">Protected offline boundary</p>
        <h1 id="offline-heading" className="mt-3 max-w-xl font-display text-4xl font-semibold leading-tight text-(--ink)">Reconnect to open your workspace</h1>
        <p className="mt-5 max-w-xl text-sm leading-7 text-(--muted)">
          Vognary does not store financial pages or API responses in the offline cache. Once your connection returns, your authenticated workspace will load from its protected source.
        </p>
        <Link href="/app" className="btn btn-primary btn-lg mt-7">Try again</Link>
      </section>
    </main>
  );
}
