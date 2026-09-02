import "../public.css";
import "../ledger.css";
import type { Metadata } from "next";
import Link from "next/link";
import { VognaryMark } from "../brand";
import VerifyClient from "./verify-client";

export const metadata: Metadata = {
  title: "Verify an audit pack · Vognary",
  description: "Check an audit pack's offline checksum and, when present, its separate Vognary Ed25519 issuer signature without uploading financial content.",
  robots: { index: false, follow: false },
};

export default function VerifyPage() {
  return (
    <main className="relative px-4 pb-12 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-line py-3">
          <Link href="/" className="inline-flex min-h-11 items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
            <VognaryMark size={22} />
            Vognary
          </Link>
          <Link href="/app" className="btn btn-ghost">Back to app</Link>
        </div>

        <article className="public-ledger">
          <header className="public-ledger-rail">
          <span className="folio" data-folio="Verify">Audit-pack integrity</span>
          <h1 className="mt-5 font-display text-4xl font-semibold leading-tight text-(--ink) sm:text-5xl">Verify an audit pack</h1>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-(--ink-soft)">
            Every audit pack carries a SHA-256 self-checksum that detects report-content edits. A matching checksum does not prove who created the file: anyone can calculate a new checksum. Authenticated exports also carry a Vognary Ed25519 issuer signature when server signing is configured.
          </p>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-(--muted)">
            Verification runs in this browser tab. The pack is never uploaded; this page fetches only Vognary&apos;s public signing keys so it can validate a signature locally.
          </p>
          <div className="mt-6 border-l-2 border-verdict pl-4">
            <p className="font-data text-xs font-semibold text-verdict">LOCAL CONTENT CHECK</p>
            <p className="mt-2 text-sm leading-6 text-(--muted)">The file stays on this device while its checksum and optional issuer signature are checked.</p>
          </div>
          </header>

          <div className="public-ledger-body">
          <section className="public-band public-band-lead">
          <p className="truth-label truth-citation">Choose the pack</p>
          <VerifyClient />
          </section>

          <section className="public-band">
            <p className="truth-label truth-policy">Verification method</p>
            <h2 className="mt-3 font-display text-xl font-semibold text-(--ink)">How the seal works</h2>
            <ul className="reason-list mt-4">
              <li>The pack&apos;s content is serialized canonically (keys sorted at every depth), so the same content always produces the same hash.</li>
              <li>The SHA-256 hash is stored in the pack&apos;s <span className="font-data text-xs">integrity</span> block. Changing report content breaks that checksum.</li>
              <li>The local chain index and previous hash help compare exports, but an unsigned chain is self-declared and does not independently prove completeness or order.</li>
              <li>A valid Ed25519 signature binds the content hash, chain metadata, timestamp, and an opaque workspace reference to a trusted Vognary key.</li>
              <li>The signature proves Vognary&apos;s signing service issued that hash for an authenticated workspace. It does not independently certify that every financial claim is accurate.</li>
            </ul>
          </section>
          </div>
        </article>
      </div>
    </main>
  );
}
