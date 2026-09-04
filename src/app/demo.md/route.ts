import {
  buildPublicArtifactMarkdown,
  publicArtifacts,
} from "@/lib/public-artifacts";

export const dynamic = "force-static";

export function GET() {
  return new Response(buildPublicArtifactMarkdown(publicArtifacts[0]), {
    headers: {
      "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
      "content-type": "text/markdown; charset=utf-8",
      link: '</demo>; rel="canonical"; type="text/html"',
      "x-content-type-options": "nosniff",
    },
  });
}