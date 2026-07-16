import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { readCurrentSession } from "@/lib/server/session";
import ExperienceClient from "./experience-client";

export const dynamic = "force-dynamic";

type AppPageProps = {
  searchParams?: Promise<{ demo?: string; guest?: string }>;
};

export default async function AppPage({ searchParams }: AppPageProps) {
  const params = await searchParams;
  const experienceMode = params?.demo === "1" ? "demo" : params?.guest === "1" ? "guest" : "signed-in";
  const session = await readRequestSession();
  if (!session && experienceMode === "signed-in") redirect("/login?next=/app");

  return <ExperienceClient experienceMode={session ? "signed-in" : experienceMode} />;
}

async function readRequestSession() {
  const requestHeaders = await headers();
  return readCurrentSession(new Request("https://vognary.local", {
    headers: { cookie: requestHeaders.get("cookie") ?? "" },
  }));
}
