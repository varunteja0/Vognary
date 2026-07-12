import type { Metadata } from "next";
import ConnectClient from "./connect-client";

export const metadata: Metadata = {
  title: "Connect your accounts",
  description:
    "Connect supported evidence sources, track their freshness, and see which recurring commitments or financial rails still need coverage.",
};

export default function ConnectPage() {
  return <ConnectClient />;
}
