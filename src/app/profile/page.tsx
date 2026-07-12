import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { readCurrentSession } from "@/lib/server/session";
import ProfileClient from "./profile-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Profile And Data",
  description: "Review your Vognary profile, workspace, integrations, saved data, pending sources, and deletion controls.",
};

export default async function ProfilePage() {
  const session = await readRequestSession();
  if (!session) redirect("/login");

  return <ProfileClient />;
}

async function readRequestSession() {
  const requestHeaders = await headers();
  return readCurrentSession(new Request("https://vognary.local", {
    headers: { cookie: requestHeaders.get("cookie") ?? "" },
  }));
}
