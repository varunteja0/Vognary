import Link from "next/link";
import { VognaryMark } from "./brand";
import { LandingDecisionPreview } from "./landing-decision-preview";

export default function LaunchLanding() {
  const primaryHref = "/start";
  const primaryLabel = "Check a bill";
  return (
    <main id="ledger-main" className="relative overflow-hidden px-4 pb-12 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <nav aria-label="Public" className="flex min-h-16 items-center justify-between gap-3 border-b border-line py-3">
          <Link href="/" className="inline-flex items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
            <VognaryMark size={26} />
            Vognary
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/login?next=/app" className="btn btn-sm btn-ghost">Sign in</Link>
          </div>
        </nav>

        <section className="border-b border-line py-12 sm:py-16">
          <div className="max-w-4xl">
            <p className="eyebrow text-ochre">For small software teams</p>
            <h1 className="mt-4 max-w-4xl font-display text-4xl font-semibold leading-tight text-(--ink) sm:text-5xl">
              Know what renews. Decide what stays.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-(--ink-soft) sm:text-lg">
              Vognary turns the software bills you already have into upcoming charges you can act on. Every amount opens to its receipt.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link href={primaryHref} className="btn btn-primary btn-lg">{primaryLabel}</Link>
              <Link href="#example-decision" className="btn btn-ghost btn-lg">See how it works</Link>
            </div>
            <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-sm text-(--muted)" aria-label="Product boundaries">
              <li>No account required</li>
              <li>No bank passwords</li>
              <li>No mailbox access</li>
            </ul>
          </div>
        </section>

        <LandingDecisionPreview />

        <section className="my-4 flex flex-col justify-between gap-5 border-y border-line py-8 sm:flex-row sm:items-center">
          <div>
            <p className="eyebrow text-ochre">Start with what you already have</p>
            <h2 className="mt-2 font-display text-2xl font-semibold text-(--ink) sm:text-3xl">One receipt is enough to begin.</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-(--muted)">Nothing is saved until you sign in. Vognary never cancels a service or moves money.</p>
          </div>
          <Link href={primaryHref} className="btn btn-primary btn-lg shrink-0">{primaryLabel}</Link>
        </section>

        <footer className="flex flex-col items-center justify-between gap-4 border-t border-line py-7 text-center sm:flex-row sm:text-left">
          <div className="inline-flex items-center gap-2.5">
            <VognaryMark size={22} />
            <span className="font-display font-semibold text-(--ink)">Vognary</span>
          </div>
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm text-(--muted)">
            <Link href="/privacy" className="transition hover:text-(--ink)">Privacy</Link>
            <Link href="/security" className="transition hover:text-(--ink)">Security</Link>
            <Link href="/terms" className="transition hover:text-(--ink)">Terms</Link>
          </div>
        </footer>
      </div>
    </main>
  );
}
