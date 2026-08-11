import type { Metadata } from "next";
import { headers } from "next/headers";
import { checkSessionConfiguration, readCurrentSession } from "@/lib/server/session";
import LoginClient from "./login-client";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your saved Vognary workspace with Google.",
  robots: { index: false, follow: false },
};

type LoginPageProps = {
  searchParams: Promise<{
    google?: string | string[];
    next?: string | string[];
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const initialSession = await readInitialSession();
  return (
    <LoginClient
      initialGoogleReason={firstQueryValue(params.google)}
      initialNextPath={firstQueryValue(params.next)}
      initialSession={initialSession}
    />
  );
}

async function readInitialSession() {
  const requestHeaders = await headers();
  const configuration = checkSessionConfiguration();
  const session = await readCurrentSession(new Request("https://vognary.local", {
    headers: { cookie: requestHeaders.get("cookie") ?? "" },
  })).catch(() => null);
  return {
    authenticated: Boolean(session?.workspaceId),
    configuration,
    session: session?.workspaceId ? {
      userId: session.userId,
      email: session.email,
      workspaceId: session.workspaceId,
      expiresAt: new Date(session.expiresAt).toISOString(),
    } : null,
  };
}

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
