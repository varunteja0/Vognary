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
      <section className="panel w-full max-w-xl p-6 sm:p-8" aria-labelledby="offline-heading">
        <div className="flex items-center gap-3">
          <VognaryMark size={36} />
          <span className="font-display text-lg font-semibold text-(--ink)">Vognary</span>
        </div>
        <p className="eyebrow mt-8">Private by default</p>
        <h1 id="offline-heading" className="mt-3 font-display text-3xl font-semibold text-(--ink)">Reconnect to open your workspace</h1>
        <p className="mt-4 text-sm leading-6 text-(--muted)">
          Vognary does not store financial pages or API responses in the offline cache. Once your connection returns, your authenticated workspace will load from its protected source.
        </p>
        <Link href="/app" className="btn btn-primary mt-6">Try again</Link>
      </section>
    </main>
  );
}
