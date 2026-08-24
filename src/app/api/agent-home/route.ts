import { agentHomepageMarkdown, agentLinkHeader } from "@/lib/agent-content";

export const dynamic = "force-static";

export async function GET() {
  return new Response(agentHomepageMarkdown, {
    headers: {
      "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
      "content-type": "text/markdown; charset=utf-8",
      link: agentLinkHeader,
    },
  });
}