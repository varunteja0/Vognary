import Link from "next/link";
import { AuthorizationLoop } from "./authorization-loop";
import { VognaryMark } from "./brand";
import { LandingDecisionPreview } from "./landing-decision-preview";
import { commitmentControlPilotOffer, pilotOfferMajorUnits } from "@/lib/pilot-offer";

export default function LaunchLanding() {
  const primaryHref = "#example-decision";
  const primaryLabel = "Cap the next yes";
  const evidenceHref = "/start";
  const evidenceLabel = "Add a bill";
  const price = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: commitmentControlPilotOffer.currency,
    currencyDisplay: "code",
    maximumFractionDigits: 0,
  }).format(pilotOfferMajorUnits());
  return (
    <main id="ledger-main" className="relative overflow-hidden px-4 pb-12 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <nav aria-label="Public" className="flex min-h-16 items-center justify-between gap-3 border-b border-line py-3">
          <Link href="/" className="inline-flex min-h-11 items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
            <VognaryMark size={26} />
            Vognary
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/pay" prefetch={false} className="btn btn-sm btn-ghost">Reserve pilot</Link>
            <Link href="/login?next=/app" className="btn btn-sm btn-ghost">Sign in</Link>
          </div>
        </nav>

        <section className="border-b border-line py-8 sm:py-10">
          <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:grid-rows-[auto_1fr] lg:gap-x-14 lg:gap-y-6">
            <div className="min-w-0 lg:col-start-1 lg:row-start-1">
              <p className="truth-label truth-policy">For India-first AI companies</p>
              <h1 className="mt-3 font-display text-[2.125rem] font-semibold leading-[1.08] tracking-tight text-(--ink) sm:text-5xl">
                Decide before the obligation exists.
              </h1>
              <p className="mt-4 max-w-lg text-base leading-7 text-(--ink-soft)">
                Propose the spend. See cited exposure and versioned policy. A named human freezes a cap, or declines. Later receipts prove the outcome against that authorization.
              </p>
              <p className="mt-3 max-w-lg text-sm leading-6 text-(--muted)">
                One receipt is enough to begin. One-time private pilot {price}. No auto-approval or money movement.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <a href={primaryHref} className="btn btn-primary btn-lg">{primaryLabel}</a>
                <Link href={evidenceHref} className="btn btn-ghost btn-lg">{evidenceLabel}</Link>
              </div>
              <div className="mt-2 sm:mt-0"><AuthorizationLoop activeStep={4} compact /></div>
            </div>

            <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
              <LandingDecisionPreview />
            </div>

            <section className="lg:col-start-1 lg:row-start-2 lg:self-start" aria-labelledby="product-boundaries-heading">
              <h2 id="product-boundaries-heading" className="eyebrow text-(--muted)">What you do not need</h2>
              <ul className="boundary-list mt-2">
                <li>No account required</li>
                <li>No bank passwords</li>
                <li>No mailbox access</li>
              </ul>
            </section>
          </div>
        </section>

        <section className="my-4 hidden justify-between gap-5 border-y border-line py-8 sm:flex sm:flex-row sm:items-center">          <div>
            <h2 className="eyebrow text-ochre">Start with what you already have</h2>
            <h3 className="mt-2 font-display text-2xl font-semibold text-(--ink) sm:text-3xl">Cite the exposure behind the next yes.</h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-(--muted)">Nothing is saved until you sign in. The next unique step is a named human authorization, not Keep or Plan to cancel. Vognary never cancels a service or moves money.</p>
          </div>
          <Link href={evidenceHref} className="btn btn-primary btn-lg shrink-0">{evidenceLabel}</Link>
        </section>

        <footer className="flex flex-col items-center justify-between gap-4 border-t border-line py-7 text-center sm:flex-row sm:text-left">
          <div className="inline-flex items-center gap-2.5">
            <VognaryMark size={22} />
            <span className="font-display font-semibold text-(--ink)">Vognary</span>
          </div>
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm text-(--muted)">
            <Link href="/about" className="-my-2 inline-flex min-h-11 min-w-11 items-center justify-center transition-colors hover:text-(--ink)">About</Link>
            <Link href="/privacy" className="-my-2 inline-flex min-h-11 min-w-11 items-center justify-center transition-colors hover:text-(--ink)">Privacy</Link>
            <Link href="/security" className="-my-2 inline-flex min-h-11 min-w-11 items-center justify-center transition-colors hover:text-(--ink)">Security</Link>
            <Link href="/contact" className="-my-2 inline-flex min-h-11 min-w-11 items-center justify-center transition-colors hover:text-(--ink)">Contact</Link>
            <Link href="/terms" className="-my-2 inline-flex min-h-11 min-w-11 items-center justify-center transition-colors hover:text-(--ink)">Terms</Link>
          </div>
        </footer>
      </div>
    </main>
  );
}
