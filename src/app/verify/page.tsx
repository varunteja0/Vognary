import type { Metadata } from "next";
import Link from "next/link";
import { VognaryMark } from "../brand";
import VerifyClient from "./verify-client";

export const metadata: Metadata = {
  title: "Verify an audit pack · Vognary",
  description: "Check an audit pack's offline checksum and, when present, its separate Vognary Ed25519 issuer signature without uploading financial content.",
};

export default function VerifyPage() {
  return (
    <main className="relative px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="inline-flex items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
            <VognaryMark size={22} />
            Vognary
          </Link>
          <Link href="/app" className="btn btn-ghost">Back to app</Link>
        </div>

        <article className="panel p-6 sm:p-8">
          <span className="folio" data-folio="Verify">Audit-pack integrity</span>
          <h1 className="mt-4 font-display text-3xl font-semibold text-(--ink) sm:text-4xl">Verify an audit pack</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-(--muted)">
            Every audit pack carries a SHA-256 self-checksum that detects report-content edits. A matching checksum does not prove who created the file: anyone can calculate a new checksum. Authenticated exports also carry a Vognary Ed25519 issuer signature when server signing is configured.
          </p>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-(--muted)">
            Verification runs in this browser tab. The pack is never uploaded; this page fetches only Vognary&apos;s public signing keys so it can validate a signature locally.
          </p>

          <VerifyClient />

          <div className="mt-6 inset p-4">
            <p className="eyebrow" style={{ fontSize: "0.6rem" }}>How the seal works</p>
            <ul className="mt-2 grid gap-1.5 text-sm leading-6 text-(--muted)">
              <li>— The pack&apos;s content is serialized canonically (keys sorted at every depth), so the same content always produces the same hash.</li>
              <li>— The SHA-256 hash is stored in the pack&apos;s <span className="font-data text-xs">integrity</span> block. Changing report content breaks that checksum.</li>
              <li>— The local chain index and previous hash help compare exports, but an unsigned chain is self-declared and does not independently prove completeness or order.</li>
              <li>— A valid Ed25519 signature binds the content hash, chain metadata, timestamp, and an opaque workspace reference to a trusted Vognary key.</li>
              <li>— The signature proves Vognary&apos;s signing service issued that hash for an authenticated workspace. It does not independently certify that every financial claim is accurate.</li>
            </ul>
          </div>
        </article>
      </div>
    </main>
  );
}
