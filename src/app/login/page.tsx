import type { Metadata } from "next";
import LoginClient from "./login-client";

export const metadata: Metadata = {
  title: "Start Recurring Audit",
  description: "Start a Vognary proof-backed recurring-money audit workspace.",
};

export default function LoginPage() {
  return <LoginClient />;
}