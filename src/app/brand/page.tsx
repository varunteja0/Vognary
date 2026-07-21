import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { VognaryMark } from "../brand";
import { Nakul, NakulBadge, type NakulPose } from "../character";

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
                The Ledger-to-Verdict mark turns scattered evidence rows into one clear action. Platinum carries the proof; champagne gold carries the verdict.
              </p>
              <p className="mt-3 text-sm leading-7 text-(--muted)">
                Use this page for the mark, colors, type, spacing rules, and downloadable assets.
              </p>
            </div>
          </div>
        </article>

        <section className="panel mt-6 p-5 sm:p-6">
          <span className="folio" data-folio="Use">The mark in use</span>
          <h2 className="mt-2 font-display text-[1.25rem] font-semibold text-(--ink)">One mark for every surface</h2>
          <p className="mt-1 text-sm leading-6 text-(--muted)">Two evidence tiers resolve into the gold V. The silhouette stays recognizable on dark, gold, light, and one-color production.</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MarkTile label="On graphite" bg="var(--card-2)" markClass="text-(--ink)" />
            <MarkTile label="On gold" bg="var(--gold)" markClass="text-[#14161b]" mono />
            <MarkTile label="On paper" bg="#f4f1ea" markClass="text-[#17181c]" />
            <MarkTile label="Single ink" bg="#0b0c0f" markClass="text-(--gold)" mono />
          </div>
        </section>

        <section className="panel mt-6 p-5 sm:p-6">
          <span className="folio" data-folio="Nakul">The keeper</span>
          <h2 className="mt-2 font-display text-[1.25rem] font-semibold text-(--ink)">Nakul, the ledger mongoose</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-(--muted)">
            In Indian iconography, Kubera&rsquo;s mongoose guards treasure — and the mongoose is the one animal a snake fears.
            Recurring charges are the snakes in the grass. Nakul watches the ledger and guards the gold verdict token between
            his paws. His eye and the token stay gold on every surface, forever.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {(
              [
                ["sentinel", "Sentinel — watching the ledger"],
                ["guide", "Guide — onboarding and help"],
                ["found", "Found — a charge spotted"],
                ["celebrate", "Celebrate — a verified saving"],
                ["rest", "Rest — empty states"],
              ] as Array<[NakulPose, string]>
            ).map(([pose, label]) => (
              <div key={pose} className="overflow-hidden rounded-xl border border-line">
                <div className="flex h-36 items-center justify-center bg-(--card-2)">
                  <Nakul pose={pose} size={104} className="text-(--ink)" title={label} />
                </div>
                <div className="border-t border-line bg-(--card-2) px-3 py-2">
                  <p className="font-data text-[0.58rem] uppercase tracking-[0.16em] text-(--muted)">{label}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-4 rounded-xl border border-line bg-(--card-2) px-4 py-3">
            <NakulBadge size={30} className="text-(--ink)" title="Nakul badge" />
            <p className="text-xs leading-5 text-(--muted)">The badge is the tight-space version: loading states, list markers, and avatars from 20&nbsp;px up.</p>
          </div>
        </section>

        <section className="panel mt-6 p-5 sm:p-6">
          <span className="folio" data-folio="Social">Platform-fit exports</span>
          <h2 className="mt-2 font-display text-[1.25rem] font-semibold text-(--ink)">One system, three correct aspect ratios</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-(--muted)">
            The X profile header is a 3:1 composition with critical copy outside the avatar-overlap zone. The square avatar is circle-crop safe. The 1200×630 card is only for shared links — never stretch it into a profile header.
          </p>
          <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_15rem]">
            <div className="overflow-hidden rounded-xl border border-line bg-(--card-2)">
              <Image src="/brand/vognary-x-header.png" alt="Vognary X profile header" width={1500} height={500} className="h-auto w-full" priority />
              <p className="border-t border-line px-3 py-2 font-data text-[0.58rem] uppercase tracking-[0.16em] text-(--muted)">X header · 1500×500 · crop safe</p>
            </div>
            <div className="overflow-hidden rounded-xl border border-line bg-(--card-2)">
              <Image src="/brand/vognary-x-avatar.png" alt="Vognary X profile avatar" width={800} height={800} className="h-auto w-full" />
              <p className="border-t border-line px-3 py-2 font-data text-[0.58rem] uppercase tracking-[0.16em] text-(--muted)">X avatar · 800×800 · circle safe</p>
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
            />
            <p className="border-t border-line px-3 py-2 font-data text-[0.58rem] uppercase tracking-[0.16em] text-(--muted)">Open Graph / X link card · 1200×630</p>
          </div>
        </section>

        <section className="panel mt-6 p-5 sm:p-6">
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

        <section className="panel mt-6 p-5 sm:p-6">
          <span className="folio" data-folio="02">Typography</span>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="inset p-5">
              <p className="eyebrow">Display &middot; Fraunces / UI &middot; Geist</p>
              <p className="mt-3 font-display text-3xl font-semibold text-(--ink)">Recurring payments, reviewed</p>
              <p className="mt-2 text-sm text-(--muted)">Fraunces carries headlines and the wordmark; Geist carries the interface.</p>
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

        <section className="panel mt-6 p-5 sm:p-6">
          <span className="folio" data-folio="03">Assets &amp; usage</span>
          <div className="mt-4 grid gap-5 md:grid-cols-2">
            <div>
              <h3 className="font-display text-base font-semibold text-(--ink)">Clear space &amp; size</h3>
              <ul className="mt-2 grid gap-1.5 text-sm leading-6 text-(--muted)">
                <li>- Keep clear space equal to one quarter of the mark&rsquo;s width on every side.</li>
                <li>- Minimum size: 20&nbsp;px full color; 16&nbsp;px with the one-color master.</li>
                <li>- Evidence rows stay platinum or ink; the verdict V stays champagne gold.</li>
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
