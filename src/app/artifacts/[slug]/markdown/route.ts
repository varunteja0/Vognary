import {
  buildPublicArtifactMarkdown,
  publicArtifactRegistry,
  publicArtifacts,
} from "@/lib/public-artifacts";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return publicArtifacts.map((artifact) => ({ slug: artifact.slug }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const artifact = publicArtifactRegistry.getBySlug(slug);
  if (!artifact) return notFoundResponse();

  return new Response(buildPublicArtifactMarkdown(artifact), {
    headers: {
      "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
      "content-type": "text/markdown; charset=utf-8",
      link: `<${new URL(artifact.url).pathname}>; rel="canonical"; type="text/html", <${new URL(artifact.revisionUrl).pathname}>; rel="related"; type="application/json"`,
      "x-content-type-options": "nosniff",
    },
  });
}

function notFoundResponse() {
  return new Response("Public artifact not found.\n", {
    status: 404,
    headers: {
      "cache-control": "private, no-store",
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}