import type { Metadata } from "next";
import Link from "next/link";
import { VognaryMark } from "../brand";
import { Nakul } from "../character";

export const metadata: Metadata = {
  title: "How Vognary works",
  description:
    "The four-chapter guide: bring evidence, read the ledger, decide and act, prove the savings. What Vognary does, in the order you will do it.",
};

const chapters = [
  {
    folio: "01",
    title: "Bring evidence",
    lead: "Three ways in — use any one, add the rest later.",
    pose: "guide" as const,
    points: [
      ["Connect live sources", "Sign in and connect Gmail receipts (read-only) or provider billing APIs. Connected sources refresh on their own and are labeled with their true state — live, needs setup, or needs a partner. Vognary never asks for a bank password."],
      ["Paste receipts", "Copy any renewal email or invoice into the paste box. Two receipts are enough for a first result, and in guest mode they never leave your tab."],
      ["Import a statement", "Drop a bank CSV or PDF export. The original file is processed for that request and not intentionally retained; only the converted evidence rows stay with you."],
    ],
  },
  {
    folio: "02",
    title: "Read the ledger",
    lead: "Every recurring commitment, with the proof attached.",
    pose: "sentinel" as const,
    points: [
      ["One item per commitment", "Statement rows, receipts, and connector evidence describing the same subscription merge into one item — multi-source verified instead of double counted."],
      ["Confidence you can inspect", "Each item carries a confidence score built from proof density, source diversity, and freshness. Click it to see exactly which evidence produced it."],
      ["A calendar that rolls forward", "Projected debits for the next 45 days, anchored to each commitment's real cadence. Predictions never sit in the past; stale evidence is flagged honestly."],
    ],
  },
  {
    folio: "03",
    title: "Decide and act",
    lead: "One ranked action, not a wall of guilt.",
    pose: "found" as const,
    points: [
      ["Do-this-first", "Vognary ranks the single action with the best evidence behind it — cancel, downgrade, watch, or investigate — and shows why."],
      ["Cancel on the provider's own page", "For known merchants you get the provider's real cancellation page and the exact steps, including UPI AutoPay and e-mandate paths. The decision and the click stay yours."],
      ["Review as a ritual", "Assign owners, leave notes, and close a monthly review. Next month opens with the diff: what's new, what got pricier, what lapsed."],
    ],
  },
  {
    folio: "04",
    title: "Prove it",
    lead: "The part nobody else does: verified outcomes.",
    pose: "celebrate" as const,
    points: [
      ["Verified savings", "After you cancel, Vognary watches the next expected debits. When the charge stops recurring inside covered evidence, the saving is marked verified — proof by absence — and you can mint it as a sealed receipt with a share card."],
      ["Sealed exports", "Every audit pack carries an offline checksum; signed-in exports can carry a Vognary issuer signature. Anyone can check a pack at /verify without uploading its contents."],
      ["Your data, your exit", "Export everything or delete everything, any time. Honesty over lock-in is the whole bet."],
    ],
  },
];

const never = [
  "Ask for a bank password or scrape a banking site",
  "Claim a source is live before it has proven a sync",
  "Sum currencies with an invented exchange rate",
  "Cancel anything without your explicit action",
  "Retain original statement files after processing",
];

export default function GuidePage() {
  return (
    <main className="relative px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="inline-flex items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
            <VognaryMark size={22} /> Vognary
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/sources" className="btn btn-sm btn-ghost">Sources</Link>
            <Link href="/app" className="btn btn-sm btn-primary">Start an audit</Link>
          </div>
        </header>

        <section className="panel mt-6 overflow-hidden rise">
          <div className="grid gap-0 md:grid-cols-[0.42fr_1fr]">
            <div className="flex items-center justify-center border-b border-line bg-(--card-2) p-8 md:border-b-0 md:border-r">
              <Nakul pose="guide" size={150} className="text-(--ink)" title="Nakul, the ledger mongoose, ready to walk you through" />
            </div>
            <div className="p-7 sm:p-9">
              <span className="folio" data-folio="Guide">How Vognary works</span>
              <h1 className="mt-4 font-display text-3xl font-semibold text-(--ink) sm:text-4xl">Four chapters, in the order you&rsquo;ll live them</h1>
              <p className="mt-4 max-w-xl text-sm leading-7 text-(--muted)">
                Vognary is an evidence-first audit of your recurring money — subscriptions, mandates, EMIs, SIPs, cloud bills.
                Bring evidence, read the ledger, decide, and let the proof accumulate. Nakul keeps watch in between.
              </p>
            </div>
          </div>
        </section>

        {chapters.map((chapter) => (
          <section key={chapter.folio} className="panel mt-6 p-5 sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="folio" data-folio={chapter.folio}>{chapter.title}</span>
                <p className="mt-3 font-display text-xl font-semibold text-(--ink)">{chapter.lead}</p>
              </div>
              <Nakul pose={chapter.pose} size={64} className="hidden shrink-0 text-(--ink-soft) sm:block" />
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {chapter.points.map(([title, body]) => (
                <div key={title} className="inset p-4">
                  <p className="text-sm font-semibold text-(--ink)">{title}</p>
                  <p className="mt-2 text-xs leading-5.5 text-(--muted)">{body}</p>
                </div>
              ))}
            </div>
          </section>
        ))}

        <section className="panel mt-6 p-5 sm:p-7">
          <span className="folio" data-folio="Never">The other half of trust</span>
          <h2 className="mt-3 font-display text-xl font-semibold text-(--ink)">What Vognary will not do</h2>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {never.map((item) => (
              <li key={item} className="flex items-baseline gap-2.5 text-sm leading-6 text-(--ink-soft)">
                <span className="font-data text-xs text-(--ember)" aria-hidden>×</span>
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs leading-5 text-(--muted)">
            Source states are published live on <Link href="/sources" className="underline underline-offset-4">Sources</Link> and
            the capability ledger on <Link href="/beta-readiness" className="underline underline-offset-4">Capability status</Link>.
            If a rail needs a regulated partner, the product says so instead of faking a sync.
          </p>
        </section>

        <section className="mt-6 flex flex-col items-start justify-between gap-4 rounded-2xl border border-(--gold-line) bg-card p-6 sm:flex-row sm:items-center">
          <div>
            <h2 className="font-display text-xl font-semibold text-(--ink)">Start with what you have</h2>
            <p className="mt-1 text-sm text-(--muted)">Two pasted receipts are enough for your first proven result.</p>
          </div>
          <div className="flex gap-2">
            <Link href="/app" className="btn btn-primary">Start an audit</Link>
            <Link href="/login?next=/app" className="btn btn-ghost">Sign in to link sources</Link>
          </div>
        </section>
      </div>
    </main>
  );
}
