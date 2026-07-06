import type { Metadata } from "next";
import PrivateAuditClient from "./private-audit-client";

export const metadata: Metadata = {
  title: "Private Recurring Burn Audit",
  description:
    "Apply for a private Vognary recurring-money audit across SaaS, AI tools, cloud, UPI AutoPay, card mandates, app stores, domains, EMIs, SIPs, insurance, and receipts.",
};

export default function PrivateAuditPage() {
  return <PrivateAuditClient />;
}