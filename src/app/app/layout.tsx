import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Your software stack",
  description: "Cited recurring software, AI, and cloud bills from evidence you choose — what changed, what comes next, and why.",
  robots: { index: false, follow: false },
};

export default function AuditLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
