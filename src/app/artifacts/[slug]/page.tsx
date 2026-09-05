import "../../public.css";
import "../../ledger.css";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import {
  buildPublicArtifactJsonLd,
  buildPublicArtifactMetadata,
  publicArtifactRegistry,
  publicArtifacts,
} from "@/lib/public-artifacts";
import { VognaryMark } from "../../brand";

export const dynamicParams = false;

type ArtifactPageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return publicArtifacts.map((artifact) => ({ slug: artifact.slug }));
}

export async function generateMetadata({ params }: ArtifactPageProps): Promise<Metadata> {
  const { slug } = await params;
  const artifact = publicArtifactRegistry.getBySlug(slug);
  if (!artifact) notFound();
  return buildPublicArtifactMetadata(artifact);
}

export default async function PublicArtifactPage({ params }: ArtifactPageProps) {
  const { slug } = await params;
  const artifact = publicArtifactRegistry.getBySlug(slug);
  if (!artifact) notFound();

  const routePath = `/artifacts/${artifact.slug}`;
  const canonicalPath = new URL(artifact.url).pathname;
  if (canonicalPath !== routePath) redirect(canonicalPath);

  const markdownPath = new URL(artifact.markdownUrl).pathname;
  const revisionPath = new URL(artifact.revisionUrl).pathname;
  const jsonLd = buildPublicArtifactJsonLd(artifact);

  return (
    <main id="ledger-main" className="relative px-4 pb-12 text-foreground sm:px-6 lg:px-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <div className="mx-auto w-full max-w-6xl">
        <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-line py-3">
          <Link href="/" className="inline-flex min-h-11 items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
            <VognaryMark size={22} />
            Vognary
          </Link>
          <div className="flex flex-wrap gap-2">
            <Link href={markdownPath} className="btn btn-sm btn-ghost">Markdown</Link>
            <Link href={revisionPath} className="btn btn-sm btn-ghost">Revision JSON</Link>
          </div>
        </div>

        <article className="public-ledger">
          <header className="public-ledger-rail">
            <span className="folio" data-folio="Public artifact">Public artifact</span>
            <h1 className="mt-5 font-display text-4xl font-semibold leading-tight text-(--ink) sm:text-5xl">
              {artifact.title}
            </h1>
            <p className="mt-5 text-sm leading-7 text-(--ink-soft)">{artifact.summary}</p>
            <p className="mt-6 break-all font-mono text-xs leading-6 text-(--muted)">{artifact.id}</p>
          </header>

          <div className="public-ledger-body">
            <section className="public-band public-band-lead">
              <p className="truth-label truth-citation">Decision sequence</p>
              <ol className="mt-4 grid gap-4 text-sm leading-7 text-(--ink-soft)">
                {artifact.steps.map((step) => <li key={step}>{step}</li>)}
              </ol>
            </section>

            <section className="public-band">
              <p className="truth-label truth-authority">Human decision branches</p>
              <div className="mt-4 grid gap-6">
                {artifact.branches.map((branch) => (
                  <div key={branch.id}>
                    <h2 className="font-display text-xl font-semibold text-(--ink)">{branch.label}</h2>
                    <p className="mt-2 text-sm leading-7 text-(--muted)">{branch.outcome}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="public-band">
              <p className="truth-label truth-frozen">Verifiable revision</p>
              <p className="mt-3 text-sm leading-7 text-(--muted)">
                The linked JSON is the exact canonical manifest hashed by the revision identifier.
              </p>
              <p className="mt-3 break-all font-mono text-xs leading-6 text-(--ink-soft)">
                sha256:{artifact.revisionDigest}
              </p>
              <Link href={revisionPath} className="btn btn-ghost mt-5">Open revision manifest</Link>
            </section>
          </div>
        </article>
      </div>
    </main>
  );
}