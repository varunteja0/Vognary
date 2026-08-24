import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { readCurrentSession } from "@/lib/server/session";
import StartClient from "./start-client";

export const metadata: Metadata = {
  title: "Review a bill",
  description: "See what a software bill means before the next charge. Nothing is saved until you sign in.",
  robots: { index: false, follow: false },
};

export default async function StartPage() {
  const requestHeaders = await headers();
  const session = await readCurrentSession(new Request("https://vognary.local", {
    headers: { cookie: requestHeaders.get("cookie") ?? "" },
  })).catch(() => null);
  if (session?.workspaceId) redirect("/app");
  return <StartClient />;
}
