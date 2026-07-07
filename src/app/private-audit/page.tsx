import type { Metadata } from "next";
import PrivateAuditClient from "./private-audit-client";

export const metadata: Metadata = {
  title: "Private Recurring Money Audit",
  description:
    "Apply for a proof-backed Vognary audit across SaaS, AI tools, cloud, UPI AutoPay, card mandates, app stores, domains, EMIs, SIPs, insurance, and receipts.",
};

export default function PrivateAuditPage() {
  return <PrivateAuditClient />;
}