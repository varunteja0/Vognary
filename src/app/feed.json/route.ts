import { buildPublicArtifactsJsonFeed } from "@/lib/public-artifacts";

export const dynamic = "force-static";

export function GET() {
  return new Response(buildPublicArtifactsJsonFeed(), {
    headers: {
      "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
      "content-type": "application/feed+json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}