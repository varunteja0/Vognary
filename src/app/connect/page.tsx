import type { Metadata } from "next";
import ConnectClient from "./connect-client";

export const metadata: Metadata = {
  title: "Connect your accounts",
  description:
    "Connect your inbox and bank once — Vognary finds every subscription, EMI, mandate, and auto-debit. No API keys, no pasting, ever.",
};

export default function ConnectPage() {
  return <ConnectClient />;
}
