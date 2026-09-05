import {
  publicArtifactRegistry,
  publicArtifacts,
} from "@/lib/public-artifacts";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return publicArtifacts.map((artifact) => ({
    slug: artifact.slug,
    digest: artifact.revisionDigest,
  }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; digest: string }> },
) {
  const { slug, digest } = await params;
  const artifact = publicArtifactRegistry.getBySlug(slug);
  if (!artifact || artifact.revisionDigest !== digest) return notFoundResponse();

  return new Response(artifact.revisionManifest, {
    headers: {
      "cache-control": "public, max-age=31536000, immutable",
      "content-type": "application/json; charset=utf-8",
      etag: `"sha256-${artifact.revisionDigest}"`,
      link: `<${new URL(artifact.url).pathname}>; rel="describes"; type="text/html"`,
      "x-content-type-options": "nosniff",
    },
  });
}

function notFoundResponse() {
  return new Response("Public artifact revision not found.\n", {
    status: 404,
    headers: {
      "cache-control": "private, no-store",
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}