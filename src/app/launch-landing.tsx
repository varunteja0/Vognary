import Link from "next/link";
import { AuthorizationLoop } from "./authorization-loop";
import { VognaryMark } from "./brand";
import { LandingDecisionPreview } from "./landing-decision-preview";

export default function LaunchLanding() {
  const primaryHref = "#example-decision";
  const primaryLabel = "Cap the next yes";
  const evidenceHref = "/start";
  const evidenceLabel = "Add a bill";
  return (
    <main id="ledger-main" className="relative overflow-hidden px-4 pb-12 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <nav aria-label="Public" className="flex min-h-16 items-center justify-between gap-3 border-b border-line py-3">
          <Link href="/" className="brandmark">
            <VognaryMark size={26} />
            Vognary
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/login?next=/app" className="btn btn-sm btn-ghost">Sign in</Link>
          </div>
        </nav>

        <section className="border-b border-line py-8 sm:py-10">
          <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:grid-rows-[auto_1fr] lg:gap-x-14 lg:gap-y-6">
            <div className="min-w-0 lg:col-start-1 lg:row-start-1">
              <p className="truth-label truth-policy">For India-first AI companies</p>
              <h1 className="page-title mt-3 text-(--ink)">
                Decide before the obligation exists.
              </h1>
              <p className="lede mt-4 max-w-lg">
                Vognary is Commitment Control. Propose the spend. See cited exposure and versioned policy. A named human freezes a cap — or declines. Later receipts prove the outcome against that authorization. No other live step invents money, auto-approves, or moves funds.
              </p>
              <p className="mt-4 max-w-lg text-sm leading-6 text-(--muted)">
                Private paid pilot: ₹40,000/month upfront. Zero paid customers. No auto-approval. No money movement.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <a href={primaryHref} className="btn btn-primary btn-lg">{primaryLabel}</a>
                <Link href={evidenceHref} className="btn btn-ghost btn-lg">{evidenceLabel}</Link>
              </div>
              <AuthorizationLoop activeStep={4} />
            </div>

            <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
              <LandingDecisionPreview />
            </div>

            <section className="lg:col-start-1 lg:row-start-2 lg:self-start" aria-labelledby="product-boundaries-heading">
              <h2 id="product-boundaries-heading" className="truth-label truth-frozen">What you do not need</h2>
              <ul className="boundary-list mt-3">
                <li>No account required</li>
                <li>No bank passwords</li>
                <li>No mailbox access</li>
                <li>No auto-approve, auto-deny, or payment</li>
              </ul>
            </section>
          </div>
        </section>

        <section className="my-4 flex flex-col justify-between gap-5 border-y border-line py-8 sm:flex-row sm:items-center">
          <div className="min-w-0">
            <h2 className="truth-label truth-citation">Start with what you already have</h2>
            <h3 className="mt-3 font-display text-2xl font-semibold text-(--ink) sm:text-3xl">One receipt is enough to begin.</h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-(--muted)">Nothing is saved until you sign in. The unique next step is a named human authorization on the Control desk, not Keep or Plan to cancel. Vognary never cancels a service or moves money.</p>
          </div>
          <Link href={evidenceHref} className="btn btn-primary btn-lg shrink-0">{evidenceLabel}</Link>
        </section>

        <footer className="flex flex-col items-center justify-between gap-2 border-t border-line py-6 text-center sm:flex-row sm:text-left">
          <div className="inline-flex items-center gap-2.5">
            <VognaryMark size={22} />
            <span className="font-display font-semibold text-(--ink)">Vognary</span>
          </div>
          <div className="flex flex-wrap justify-center gap-x-1 gap-y-0">
            <Link href="/about" className="footer-link">About</Link>
            <Link href="/privacy" className="footer-link">Privacy</Link>
            <Link href="/security" className="footer-link">Security</Link>
            <Link href="/contact" className="footer-link">Contact</Link>
            <Link href="/terms" className="footer-link">Terms</Link>
          </div>
        </footer>
      </div>
    </main>
  );
}
