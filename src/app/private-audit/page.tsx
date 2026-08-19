import type { Metadata } from "next";
import PrivateAuditClient from "./private-audit-client";

export const metadata: Metadata = {
  title: "Private software commitment audit",
  description:
    "Apply for a proof-backed Vognary audit of software, AI, and cloud commitments from invoices and billing emails you choose.",
};

export default function PrivateAuditPage() {
  return <PrivateAuditClient />;
}