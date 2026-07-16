import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Recurring Spend Audit",
  description: "Audit recurring spend from receipts and invoices, review the next renewal, and verify the evidence behind the first action.",
  robots: { index: false, follow: false },
};

export default function AuditLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
