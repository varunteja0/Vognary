import type { Metadata } from "next";
import LoginClient from "./login-client";

export const metadata: Metadata = {
  title: "Private Beta Login",
  description: "Sign in to a Vognary private beta workspace to save encrypted review snapshots.",
};

export default function LoginPage() {
  return <LoginClient />;
}