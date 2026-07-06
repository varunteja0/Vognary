import type { Metadata } from "next";
import Link from "next/link";
import { VognaryMark } from "../brand";

export const metadata: Metadata = {
  title: "Brand",
  description:
    "The Vognary brand basics: mark, colors, type, and downloadable assets.",
};

const grays: Array<[string, string]> = [
  ["Base", "#0b0c0f"],
  ["Panel", "#131519"],
  ["Inset", "#0f1114"],
  ["Elevated", "#1a1d23"],
];

const verdicts: Array<[string, string]> = [
  ["Keep", "#43c6a0"],
  ["Watch", "#e0a54e"],
  ["Downgrade", "#8891e8"],
  ["Cancel", "#f0705e"],
];

export default function BrandPage() {
  return (
    <main className="relative px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="inline-flex items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
            <VognaryMark size={22} />
            Vognary
          </Link>
          <Link href="/app" className="btn btn-ghost">Back to app</Link>
        </div>

        <article className="panel overflow-hidden rise">
          <div className="grid gap-0 md:grid-cols-[0.9fr_1.1fr]">
            <div className="flex items-center justify-center border-b border-line bg-(--card-2) p-12 md:border-b-0 md:border-r">
              <VognaryMark size={140} className="text-(--ink)" animated title="Vognary mark" />
            </div>
            <div className="p-7 sm:p-9">
              <span className="folio" data-folio="Brand">Identity</span>
              <h1 className="mt-4 font-display text-3xl font-semibold text-(--ink) sm:text-4xl">
                Vognary brand basics
              </h1>
              <p className="mt-4 text-sm leading-7 text-(--muted)">
                The mark turns scattered recurring payments into one clear decision. Graphite carries the product UI; champagne gold highlights money and primary actions.
              </p>
              <p className="mt-3 text-sm leading-7 text-(--muted)">
                Use this page for the mark, colors, type, spacing rules, and downloadable assets.
              </p>
            </div>
          </div>
        </article>

        <section className="panel mt-6 p-5 sm:p-6" data-reveal>
          <span className="folio" data-folio="Use">The mark in use</span>
          <h2 className="mt-2 font-display text-[1.25rem] font-semibold text-(--ink)">One mark for every surface</h2>
          <p className="mt-1 text-sm leading-6 text-(--muted)">The mark works on dark, gold, light, and single-color surfaces without extra effects.</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MarkTile label="On graphite" bg="var(--card-2)" markClass="text-(--ink)" />
            <MarkTile label="On gold" bg="var(--gold)" markClass="text-[#14161b]" mono />
            <MarkTile label="On paper" bg="#f4f1ea" markClass="text-[#17181c]" />
            <MarkTile label="Single ink" bg="#0b0c0f" markClass="text-(--gold)" mono />
          </div>
        </section>

        <section className="panel mt-6 p-5 sm:p-6" data-reveal>
          <span className="folio" data-folio="01">Palette</span>
          <h2 className="mt-2 font-display text-[1.25rem] font-semibold text-(--ink)">Graphite and gold</h2>
          <p className="mt-1 text-sm leading-6 text-(--muted)">Gold is for money, primary actions, and focus states. The other colors label review actions.</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Swatch name="Champagne gold" hex="#d8b87a" ring />
            {grays.map(([name, hex]) => (
              <Swatch key={hex} name={name} hex={hex} />
            ))}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {verdicts.map(([name, hex]) => (
              <Swatch key={hex} name={name} hex={hex} />
            ))}
          </div>
        </section>

        <section className="panel mt-6 p-5 sm:p-6" data-reveal>
          <span className="folio" data-folio="02">Typography</span>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="inset p-5">
              <p className="eyebrow">Display / UI &middot; Geist</p>
              <p className="mt-3 font-display text-3xl font-semibold text-(--ink)">Recurring payments, reviewed</p>
              <p className="mt-2 text-sm text-(--muted)">Aa Bb Cc &middot; The quick brown fox</p>
            </div>
            <div className="inset p-5">
              <p className="eyebrow">Data &middot; Geist Mono</p>
              <p className="font-data mt-3 text-3xl font-medium tnum text-(--ink)">
                &#8377;1,24,900<span className="text-(--muted)">/yr</span>
              </p>
              <p className="font-data mt-2 text-sm tnum text-(--muted)">0 1 2 3 4 5 6 7 8 9 &middot; tabular</p>
            </div>
          </div>
        </section>

        <section className="panel mt-6 p-5 sm:p-6" data-reveal>
          <span className="folio" data-folio="03">Assets &amp; usage</span>
          <div className="mt-4 grid gap-5 md:grid-cols-2">
            <div>
              <h3 className="font-display text-base font-semibold text-(--ink)">Clear space &amp; size</h3>
              <ul className="mt-2 grid gap-1.5 text-sm leading-6 text-(--muted)">
                <li>- Keep clear space of at least the node&rsquo;s diameter on every side.</li>
                <li>- Minimum size 20&nbsp;px for the mark, so the node stays legible.</li>
                <li>- The V may take any single color; the node stays champagne gold.</li>
                <li>- Never recolor the node, rotate the mark, stretch it, or add effects.</li>
              </ul>
            </div>
            <div>
              <h3 className="font-display text-base font-semibold text-(--ink)">Downloads</h3>
              <div className="mt-2 grid gap-2">
                <AssetLink href="/brand/vognary-mark.svg" label="Mark — on dark (SVG)" />
                <AssetLink href="/brand/vognary-mark-ink.svg" label="Mark — on light (SVG)" />
                <AssetLink href="/brand/vognary-lockup.svg" label="Lockup (SVG)" />
                <AssetLink href="/opengraph-image" label="Social card (PNG · 1200×630)" />
              </div>
              <p className="mt-4 text-xs leading-5 text-(--muted)">Vector masters scale to any resolution — sharper than 4K or 8K at any size.</p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function MarkTile({ label, bg, markClass, mono }: { label: string; bg: string; markClass: string; mono?: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <div className="flex h-28 items-center justify-center" style={{ background: bg }}>
        <VognaryMark size={46} className={markClass} mono={mono} />
      </div>
      <div className="border-t border-line bg-(--card-2) px-3 py-2">
        <p className="font-data text-[0.58rem] uppercase tracking-[0.16em] text-(--muted)">{label}</p>
      </div>
    </div>
  );
}

function Swatch({ name, hex, ring }: { name: string; hex: string; ring?: boolean }) {
  return (
    <div className="inset flex items-center gap-3 p-3">
      <span
        className="size-10 shrink-0 rounded-lg"
        style={{
          background: hex,
          boxShadow: ring
            ? "0 0 0 1px rgba(255,255,255,0.12), 0 8px 20px -10px rgba(216,184,122,0.6)"
            : "0 0 0 1px rgba(255,255,255,0.06)",
        }}
      />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-(--ink)">{name}</p>
        <p className="font-data text-xs uppercase text-(--muted)">{hex}</p>
      </div>
    </div>
  );
}

function AssetLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inset flex items-center justify-between gap-3 px-3 py-2.5 text-sm transition hover:border-(--line-strong)"
    >
      <span className="text-(--ink)">{label}</span>
      <span className="font-data text-xs text-(--muted)" aria-hidden>
        &#8599;
      </span>
    </a>
  );
}
