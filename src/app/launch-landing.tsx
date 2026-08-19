import Link from "next/link";
import { VognaryMark } from "./brand";
import { Nakul } from "./character";

const outcomes = [
  {
    title: "What you are committed to",
    detail: "Cited software, AI, and cloud bills — only when receipts support them.",
  },
  {
    title: "What changed, and what is coming",
    detail: "Price changes, renewals, and duplicates, each tied to evidence.",
  },
  {
    title: "What deserves review, and why",
    detail: "Possible overlap and uncertainty, with the receipt behind every important claim.",
  },
] as const;

export default function LaunchLanding({
  receiptInboxAvailable = false,
}: {
  receiptInboxAvailable?: boolean;
}) {
  const primaryHref = "/login?next=/app";
  const primaryLabel = "Review my software stack";
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

        <section className="scan relative flex min-h-[34rem] items-center overflow-hidden border-b border-line py-12 sm:min-h-[38rem] sm:py-16">
          <div className="relative z-10 max-w-3xl sm:pr-28 lg:pr-0">
            <p className="eyebrow eyebrow-xs text-ochre">
              Software Decision Intelligence for founder-led software and AI companies
            </p>
            <h1 className="mt-5 max-w-3xl font-display text-4xl font-semibold leading-tight text-(--ink) sm:text-6xl">
              Know which software is worth paying for before you pay again.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-(--ink-soft) sm:text-lg">
              Software, AI and cloud spend quietly accumulates across many tools. The founder cannot confidently answer what is still worth paying for. Add a few recent software bills. Vognary reconstructs your commitments, changes, upcoming decisions and evidence.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href={primaryHref} className="btn btn-primary btn-lg">{primaryLabel}</Link>
            </div>
            <p className="mt-6 flex max-w-2xl items-start gap-2 text-sm leading-6 text-(--muted)">
              <span className="live-dot mt-2 shrink-0" aria-hidden />
              <span>{receiptInboxAvailable
                ? "No mailbox access required. Add the billing receipts you already have. After you see what Vognary found, you can keep it current with a private billing address. No bank passwords."
                : "No mailbox access required. Add the billing receipts you already have. Vognary shows the amount, the expected date, and the receipt behind each one. No bank passwords."}</span>
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
            <p className="eyebrow eyebrow-xs text-ochre">Keep it current</p>
            <h2 className="mt-3 font-display text-3xl font-semibold text-(--ink)">Keep it current</h2>
            <p className="mt-4 max-w-xl text-sm leading-7 text-(--muted)">
              {receiptInboxAvailable
                ? "Set up billing forwarding once. Messages sent to your private Vognary address are processed as receipt evidence. Vognary stays current from the billing evidence you choose to forward. Vognary does not read the mailbox."
                : "Add new billing receipts as they arrive and Vognary updates what renews next."}
            </p>
          </div>
          <div>
            <p className="eyebrow eyebrow-xs text-ochre">Clear boundaries</p>
            <h2 className="mt-3 font-display text-3xl font-semibold text-(--ink)">Your data</h2>
            <p className="mt-4 max-w-xl text-sm leading-7 text-(--muted)">
              {receiptInboxAvailable
                ? "Vognary stores normalized receipt evidence and bounded excerpts. Provider-held email copies follow Resend's own retention schedule and are not immediately deletable by Vognary. Account controls export and deletion of data saved by Vognary."
                : "No bank passwords. No mailbox access. You choose which billing text to add. Vognary stores only the evidence you submit, and Account controls its export and deletion."}
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
            {primaryLabel}
          </Link>
          <p className="mt-5 text-sm leading-6 muted-on-dark">
            Want it done for you? <Link href="/private-audit" className="underline underline-offset-4">Request a private audit</Link>.
          </p>
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
