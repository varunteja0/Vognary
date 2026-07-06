import type { Metadata } from "next";
import PrivateAuditClient from "./private-audit-client";

export const metadata: Metadata = {
  title: "Private Recurring Payment Review",
  description:
    "Apply for a private Vognary review across SaaS, AI tools, cloud, UPI AutoPay, card mandates, app stores, domains, EMIs, SIPs, insurance, and receipts.",
};

export default function PrivateAuditPage() {
  return <PrivateAuditClient />;
}