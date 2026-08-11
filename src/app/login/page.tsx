import type { Metadata } from "next";
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