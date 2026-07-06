import type { Metadata } from "next";
import LoginClient from "./login-client";

export const metadata: Metadata = {
  title: "Private Beta Login",
  description: "Sign in to a Vognary private beta workspace with a signed session and PostgreSQL-backed workspace envelope.",
};

export default function LoginPage() {
  return <LoginClient />;
}