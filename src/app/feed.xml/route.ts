import { buildPublicArtifactsAtom } from "@/lib/public-artifacts";

export const dynamic = "force-static";

export function GET() {
  return new Response(buildPublicArtifactsAtom(), {
    headers: {
      "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
      "content-type": "application/atom+xml; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}