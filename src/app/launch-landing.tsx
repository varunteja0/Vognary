import Link from "next/link";
import { VognaryMark } from "./brand";
import { Nakul } from "./character";
import { LandingDecisionPreview } from "./landing-decision-preview";

export default function LaunchLanding() {
  const primaryHref = "/start";
  const primaryLabel = "Review one bill";
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

        <section className="scan relative flex min-h-[31rem] items-center overflow-hidden border-b border-line py-10 sm:min-h-[36rem] sm:py-16">
          <div className="relative z-10 max-w-3xl sm:pr-28 lg:pr-0">
            <p className="eyebrow eyebrow-xs text-ochre">
              Commitment Intelligence for 2–20 person software and AI companies
            </p>
            <h1 className="mt-5 max-w-3xl font-display text-4xl font-semibold leading-[1.08] tracking-tight text-(--ink) sm:text-6xl">
              See what your company is about to pay. Decide before the card fires.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-(--ink-soft) sm:text-lg">
              Add one real bill. Vognary cites what it can verify, shows what renews next, and remembers what to check after you decide.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={primaryHref} className="btn btn-primary btn-lg">{primaryLabel}</Link>
            </div>
            <p className="mt-6 flex max-w-2xl items-start gap-2 text-sm leading-6 text-(--muted)">
              <span className="live-dot mt-2 shrink-0" aria-hidden />
              <span>No account to start. No bank password. No mailbox access. Vognary never cancels a service or moves money.</span>
            </p>
          </div>
          <Nakul
            pose="sentinel"
            size={150}
            className="pointer-events-none absolute bottom-8 right-2 hidden text-(--ink-soft) opacity-80 sm:block lg:right-12"
            title="Nakul, Vognary’s renewal sentinel"
          />
        </section>

        <LandingDecisionPreview />

        <section className="dossier spotlight my-4 px-6 py-8 text-center sm:px-10 sm:py-10">
          <p className="eyebrow muted-on-dark">Your receipt. Your decision.</p>
          <h2 className="mx-auto mt-3 max-w-2xl font-display text-3xl font-semibold tracking-tight text-(--dossier-ink) sm:text-4xl">
            Start with one billing receipt you already have.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-6 text-(--dossier-muted)">
            Sign in to remember the decision. When private billing forwarding is available, Sources can keep receipt evidence current without reading your mailbox.
          </p>
          <Link href={primaryHref} className="btn btn-primary btn-lg mt-6">
            {primaryLabel}
          </Link>
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
