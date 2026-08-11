import Link from "next/link";
import { VognaryMark } from "./brand";
import { Nakul } from "./character";

const outcomes = [
  {
    title: "Renewing soon",
    detail: "See an expected charge before its date arrives.",
  },
  {
    title: "Price changed",
    detail: "Know when a newer receipt shows a different amount.",
  },
  {
    title: "Needs a decision",
    detail: "Keep it, plan to cancel, or review it later.",
  },
] as const;

export default function LaunchLanding({
  receiptInboxAvailable = false,
}: {
  receiptInboxAvailable?: boolean;
}) {
  const primaryHref = receiptInboxAvailable ? "/login?next=/app" : "/private-audit";
  const primaryLabel = receiptInboxAvailable ? "Get started" : "Request private audit";
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
            <Link href={primaryHref} className="btn btn-sm btn-primary">{primaryLabel}</Link>
          </div>
        </nav>

        <section className="scan relative flex min-h-[34rem] items-center overflow-hidden border-b border-line py-12 sm:min-h-[38rem] sm:py-16">
          <div className="relative z-10 max-w-3xl sm:pr-28 lg:pr-0">
            <p className="eyebrow eyebrow-xs text-ochre">
              {receiptInboxAvailable ? "Software renewals, without inbox access" : "Private software renewal review"}
            </p>
            <h1 className="mt-5 max-w-3xl font-display text-4xl font-semibold leading-tight text-(--ink) sm:text-6xl">
              Know what’s renewing before you pay for it.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-(--ink-soft) sm:text-lg">
              {receiptInboxAvailable
                ? "Forward software receipts to your Vognary address. See what may renew next, what changed, and what needs attention."
                : "Receipt forwarding is not active in this deployment. Request a private review based on evidence provided through the agreed intake."}
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href={primaryHref} className="btn btn-primary btn-lg">{primaryLabel}</Link>
              <Link href="/login?next=/app" className="btn btn-ghost btn-lg">Sign in</Link>
            </div>
            <p className="mt-6 flex max-w-2xl items-start gap-2 text-sm leading-6 text-(--muted)">
              <span className="live-dot mt-2 shrink-0" aria-hidden />
              <span>{receiptInboxAvailable
                ? "Messages sent to your private Vognary address are processed as receipt evidence. Keep the address private and forward only billing mail you want reviewed."
                : "Vognary does not access your inbox. A private review uses evidence provided through the agreed intake."}</span>
            </p>
          </div>
          <Nakul
            pose="sentinel"
            size={150}
            className="pointer-events-none absolute bottom-8 right-2 hidden text-(--ink-soft) opacity-80 sm:block lg:right-12"
            title="Nakul, Vognary’s renewal sentinel"
          />
        </section>

        <section aria-labelledby="outcomes-heading" className="py-12 sm:py-16">
          <div className="max-w-2xl">
            <p className="eyebrow eyebrow-xs text-ochre">One useful review</p>
            <h2 id="outcomes-heading" className="mt-3 font-display text-3xl font-semibold text-(--ink)">What you get</h2>
          </div>
          <div className="mt-8 grid border-y border-line sm:grid-cols-3">
            {outcomes.map((outcome, index) => (
              <article key={outcome.title} className={`py-6 sm:px-6 ${index > 0 ? "border-t border-line sm:border-l sm:border-t-0" : ""}`}>
                <p className="font-display text-xl font-semibold text-(--ink)">{outcome.title}</p>
                <p className="mt-2 text-sm leading-6 text-(--muted)">{outcome.detail}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="grid gap-8 border-t border-line py-12 sm:py-16 lg:grid-cols-2 lg:gap-16">
          <div>
            <p className="eyebrow eyebrow-xs text-ochre">Set it once</p>
            <h2 className="mt-3 font-display text-3xl font-semibold text-(--ink)">Keep it current</h2>
            <p className="mt-4 max-w-xl text-sm leading-7 text-(--muted)">
              {receiptInboxAvailable
                ? "Forward billing emails manually to your Vognary address as they arrive."
                : "Receipt forwarding remains unavailable until the provider, webhook, replay, and retention gates are proven."}
            </p>
          </div>
          <div>
            <p className="eyebrow eyebrow-xs text-ochre">Clear boundaries</p>
            <h2 className="mt-3 font-display text-3xl font-semibold text-(--ink)">Your data</h2>
            <p className="mt-4 max-w-xl text-sm leading-7 text-(--muted)">
              {receiptInboxAvailable
                ? "Vognary stores normalized receipt evidence and bounded excerpts. Provider-held email copies follow Resend's own retention schedule and are not immediately deletable by Vognary. Account controls export and deletion of data saved by Vognary."
                : "No bank passwords. The private review starts with a redaction-first source plan before any evidence is requested."}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href="/privacy" className="btn btn-sm btn-ghost">Privacy</Link>
              <Link href="/security" className="btn btn-sm btn-ghost">Security</Link>
            </div>
          </div>
        </section>

        <section className="dossier spotlight my-4 px-6 py-9 text-center sm:px-10 sm:py-12">
          <p className="eyebrow muted-on-dark">Your receipts. Your decisions.</p>
          <h2 className="mx-auto mt-3 max-w-2xl font-display text-3xl font-semibold text-(--dossier-ink) sm:text-4xl">
            Start with the billing emails you already have.
          </h2>
          <Link href={primaryHref} className="btn btn-primary btn-lg mt-6">
            {receiptInboxAvailable ? "Start with my receipts" : "Request private audit"}
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