import { llmsTxt } from "@/lib/agent-content";

export const dynamic = "force-static";

export async function GET() {
  return new Response(llmsTxt, {
    headers: {
      "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}