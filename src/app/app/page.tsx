import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/server/session";
import VognaryMvpClient from "../vognary-mvp-client";

export const dynamic = "force-dynamic";

export default async function AppPage() {
  const session = await readRequestSession();
  if (!session) redirect("/login");

  return <VognaryMvpClient />;
}

async function readRequestSession() {
  const requestHeaders = await headers();
  return readSession(new Request("https://vognary.local", {
    headers: { cookie: requestHeaders.get("cookie") ?? "" },
  }));
}