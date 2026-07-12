import type { Metadata } from "next";
import LoginClient from "./login-client";

export const metadata: Metadata = {
  title: "Start Recurring Audit",
  description: "Start a Vognary proof-backed recurring-money audit workspace.",
};

type LoginPageProps = {
  searchParams: Promise<{
    google?: string | string[];
    next?: string | string[];
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  return (
    <LoginClient
      initialGoogleReason={firstQueryValue(params.google)}
      initialNextPath={firstQueryValue(params.next)}
    />
  );
}

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}