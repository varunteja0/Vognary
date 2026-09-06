import "../public.css";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { VognaryMark } from "../brand";

export const metadata: Metadata = {
  title: "Brand",
  description:
    "The Vognary brand basics: mark, colors, type, and downloadable assets.",
  robots: { index: false, follow: false },
};

/*
  Every hex on this page is asserted against src/app/globals.css by
  tests/brand-page-truth.test.ts. This page previously documented a Fraunces /
  graphite / gold identity the product had stopped rendering, so the swatches
  now paint from the live token and the printed hex is gate-checked against it.
  A brand page that can drift from the product is worse than no brand page.
*/

/** Paper and ink: the record surface, and what is written on it. */
const foundations: Array<[string, string, string]> = [
  ["Mist", "#f3f6f4", "--paper"],
  ["Recessed surface", "#e7ece9", "--paper-2"],
  ["White", "#ffffff", "--card"],
  ["Ink", "#202e29", "--ink"],
  ["Secondary ink", "#44564d", "--ink-soft"],
  ["Muted", "#53665b", "--muted"],
  ["Evergreen", "#173f35", "--brand"],
  ["Citron", "#d9ed8c", "--citron"],
];

/** Colour is spent on exactly these meanings and nothing else. */
const signals: Array<[string, string, string, string]> = [
  ["Limit crossed", "#ae3048", "--ember", "Rose. Past a policy limit or past a frozen cap."],
  ["Human froze it", "#286747", "--frozen", "Forest. A named person set a boundary."],
  ["Policy context", "#3f527f", "--policy", "Blue. A policy result, never a human decision."],
  ["Someone typed it", "#53665b", "--assumption", "Muted. Explicitly unverified."],
];

export default function BrandPage() {
  return (
    <main className="relative px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="inline-flex min-h-11 items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
            <VognaryMark size={22} />
            Vognary
          </Link>
          <Link href="/app" className="btn btn-ghost">Back to app</Link>
        </div>

        <p className="inset mb-5 px-4 py-3 text-sm leading-6 text-(--ink-soft)">
          <b className="text-(--ink)">Unaccepted candidate.</b> This is the Clearline
          frontend candidate. The founder has not accepted it, it is not a
          released identity, and it must not be used externally or treated as final.
        </p>

        <article className="overflow-hidden border-y border-line rise">
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
                The Ledger-to-Authorization mark turns scattered evidence into one human-controlled
                commitment record: evidence rows in ink, and one champagne-gold V for the human
                authorization. The mark is versioned and gate-checked, and this candidate does not
                change it.
              </p>
              <p className="mt-3 text-sm leading-7 text-(--muted)">
                The interface around the mark is a different question, and this candidate does
                change that: white and mist working surfaces, evergreen navigation, citron identity accents,
                and separately labelled financial states. Everything below describes the local candidate.
              </p>
            </div>
          </div>
        </article>

        <section className="mt-6 border-b border-line py-6">
          <span className="folio" data-folio="Use">The mark in use</span>
          <h2 className="mt-2 font-display text-[1.25rem] font-semibold text-(--ink)">One mark for every surface</h2>
          <p className="mt-1 text-sm leading-6 text-(--muted)">Two evidence tiers resolve into the authorization V. The silhouette stays recognizable on card, on the inverted register, on paper, and in one-color production.</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MarkTile label="On card" bg="var(--card-2)" markClass="text-(--ink)" />
            <MarkTile label="On the inverted register" bg="var(--field)" markClass="text-(--field-ink)" />
            <MarkTile label="On paper" bg="var(--paper)" markClass="text-(--ink)" />
            <MarkTile label="Single ink" bg="var(--field-2)" markClass="text-(--field-ink)" mono />
          </div>
        </section>

        <section className="mt-6 border-b border-line py-6">
          <span className="folio" data-folio="Social">Platform-fit exports</span>
          <h2 className="mt-2 font-display text-[1.25rem] font-semibold text-(--ink)">One system, three correct aspect ratios</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-(--muted)">
            These are candidate identity exports, not customer records or product evidence.
            The X profile header is a 3:1 composition with
            critical copy outside the avatar-overlap zone. The square avatar is circle-crop safe.
            The 1200&times;630 card is only for shared links — never stretch it into a profile
            header.
          </p>
          <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_15rem]">
            <div className="overflow-hidden rounded-xl border border-line bg-(--card-2)">
              <Image src="/brand/vognary-x-header.png" alt="Vognary X profile header" width={1500} height={500} className="h-auto w-full" priority unoptimized />
              <p className="eyebrow eyebrow-xs border-t border-line px-3 py-2">X header · 1500×500 · crop safe</p>
            </div>
            <div className="overflow-hidden rounded-xl border border-line bg-(--card-2)">
              <Image src="/brand/vognary-x-avatar.png" alt="Vognary X profile avatar" width={800} height={800} className="h-auto w-full" loading="eager" unoptimized />
              <p className="eyebrow eyebrow-xs border-t border-line px-3 py-2">X avatar · 800×800 · circle safe</p>
            </div>
          </div>
          <div className="mt-4 overflow-hidden rounded-xl border border-line bg-(--card-2)">
            <Image
              src="/brand/vognary-social-card.png"
              alt="Vognary social link card"
              width={1200}
              height={630}
              loading="eager"
              className="h-auto w-full"
              unoptimized
            />
            <p className="eyebrow eyebrow-xs border-t border-line px-3 py-2">Open Graph / X link card · 1200×630</p>
          </div>
        </section>

        <section className="mt-6 border-b border-line py-6">
          <span className="folio" data-folio="01">Palette</span>
          <h2 className="mt-2 font-display text-[1.25rem] font-semibold text-(--ink)">Identity and financial meaning are separate</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-(--muted)">
            Evergreen and citron carry the identity. Financial states carry their own labels and
            structural cues, so meaning survives grayscale. <code className="font-data text-xs">--gold</code> still
            exists as a legacy alias, but it now resolves to forest; the champagne gold survives
            only inside the mark.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {foundations.map(([name, hex, token]) => (
              <Swatch key={token} name={name} hex={hex} token={token} />
            ))}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {signals.map(([name, hex, token, meaning]) => (
              <Swatch key={token} name={name} hex={hex} token={token} meaning={meaning} />
            ))}
          </div>
        </section>

        <section className="mt-6 border-b border-line py-6">
          <span className="folio" data-folio="02">Typography</span>
          <h2 className="mt-2 font-display text-[1.25rem] font-semibold text-(--ink)">Bricolage Grotesque, Manrope, IBM Plex Mono</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="inset p-5">
              <p className="eyebrow">Display &middot; Bricolage Grotesque</p>
              <p className="mt-3 font-display text-3xl font-semibold text-(--ink)">Commitment Control</p>
              <p className="mt-2 text-sm text-(--muted)">
                Bricolage Grotesque gives headings and the wordmark a distinct, compact voice.
              </p>
            </div>
            <div className="inset p-5">
              <p className="eyebrow">UI &middot; Manrope</p>
              <p className="mt-3 text-3xl font-semibold text-(--ink)">Approve before it bills</p>
              <p className="mt-2 text-sm text-(--muted)">Manrope carries the interface, form labels, and running copy.</p>
            </div>
            <div className="inset p-5 md:col-span-2">
              <p className="eyebrow">Data &middot; IBM Plex Mono</p>
              <p className="font-data mt-3 text-3xl font-medium tnum text-(--ink)">
                INR 1,350
              </p>
              <p className="font-data mt-2 text-sm tnum text-(--muted)">FROZEN CAP &middot; 0 1 2 3 4 5 6 7 8 9</p>
              <p className="mt-2 text-sm text-(--muted)">Every amount is tabular, so two figures can be compared down a column.</p>
            </div>
          </div>
        </section>

        <section className="mt-6 border-b border-line py-6">
          <span className="folio" data-folio="03">Assets &amp; usage</span>
          <div className="mt-4 grid gap-5 md:grid-cols-2">
            <div>
              <h3 className="font-display text-base font-semibold text-(--ink)">Clear space &amp; size</h3>
              <ul className="mt-2 grid gap-1.5 text-sm leading-6 text-(--muted)">
                <li>- Keep clear space equal to one quarter of the mark&rsquo;s width on every side.</li>
                <li>- Minimum size: 20&nbsp;px full color; 16&nbsp;px with the one-color master.</li>
                <li>- Evidence rows inherit the surrounding text colour; the authorization V stays champagne gold.</li>
                <li>- Never rotate, stretch, outline, add shadows to, or place copy inside the mark.</li>
              </ul>
            </div>
            <div>
              <h3 className="font-display text-base font-semibold text-(--ink)">Downloads</h3>
              <div className="mt-2 grid gap-2">
                <AssetLink href="/brand/vognary-mark.svg" label="Mark — on dark (SVG)" />
                <AssetLink href="/brand/vognary-mark-ink.svg" label="Mark — on light (SVG)" />
                <AssetLink href="/brand/vognary-mark-mono.svg" label="Mark — one color (SVG)" />
                <AssetLink href="/brand/vognary-mark-1024.png" label="Mark — transparent (PNG · 1024×1024)" />
                <AssetLink href="/brand/vognary-lockup.svg" label="Lockup — on dark (SVG)" />
                <AssetLink href="/brand/vognary-lockup-ink.svg" label="Lockup — on light (SVG)" />
                <AssetLink href="/brand/vognary-x-avatar.png" label="X avatar (PNG · 800×800)" />
                <AssetLink href="/brand/vognary-x-header.png" label="X header (PNG · 1500×500)" />
                <AssetLink href="/brand/vognary-social-card.png" label="Link card (PNG · 1200×630)" />
                <AssetLink href="/brand/manifest.json" label="Standards &amp; export manifest (JSON)" />
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
        <p className="eyebrow eyebrow-xs">{label}</p>
      </div>
    </div>
  );
}

function Swatch({ name, hex, token, meaning }: { name: string; hex: string; token: string; meaning?: string }) {
  return (
    <div className="inset flex items-start gap-3 p-3">
      {/* Painted from the live token, labelled with the hex the token holds, so
          a drifted token shows as a mismatch instead of hiding behind copy. */}
      <span
        className="size-10 shrink-0 rounded-lg"
        style={{
          background: `var(${token})`,
          boxShadow: "0 0 0 1px var(--line)",
        }}
      />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-(--ink)">{name}</p>
        <p className="font-data text-xs text-(--muted)">
          {token} &middot; {hex}
        </p>
        {meaning ? <p className="mt-1 text-xs leading-5 text-(--muted)">{meaning}</p> : null}
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
