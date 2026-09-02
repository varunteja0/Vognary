import type { Metadata } from "next";
import { DemoClient } from "./demo-client";

export const metadata: Metadata = {
  title: "Synthetic demonstration — Commitment Control | Vognary",
  description:
    "Walk one placeholder request from proposed obligation to cited exposure, policy context, a named human decision, a frozen cap and the receipt that arrives later. No account, no customer data.",
  alternates: { canonical: "/demo" },
};

export default function DemoPage() {
  return <DemoClient />;
}
