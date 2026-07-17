import { headers } from "next/headers";
import { permanentRedirect } from "next/navigation";
import { readCurrentSession } from "@/lib/server/session";
import ExperienceClient from "./experience-client";

export const dynamic = "force-dynamic";

type AppPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AppPage({ searchParams }: AppPageProps) {
  const params = await searchParams;
  if (params && (Object.hasOwn(params, "demo") || Object.hasOwn(params, "guest"))) {
    permanentRedirect(buildCanonicalAppUrl(params));
  }

  const session = await readRequestSession();
  return <ExperienceClient signedIn={Boolean(session)} />;
}

function buildCanonicalAppUrl(params: Record<string, string | string[] | undefined>) {
  const canonical = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "demo" || key === "guest" || value === undefined) continue;
    if (Array.isArray(value)) value.forEach((entry) => canonical.append(key, entry));
    else canonical.append(key, value);
  }
  const query = canonical.toString();
  return query ? `/app?${query}` : "/app";
}

async function readRequestSession() {
  const requestHeaders = await headers();
  return readCurrentSession(new Request("https://vognary.local", {
    headers: { cookie: requestHeaders.get("cookie") ?? "" },
  }));
}
