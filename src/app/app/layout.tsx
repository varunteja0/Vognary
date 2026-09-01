import type { Metadata } from "next";

// Scoped to this route segment so public pages do not inline the desk's CSS.
import "./workspace.css";

export const metadata: Metadata = {
  title: "Your software stack",
  description: "Cited recurring software, AI, and cloud bills from evidence you choose — what changed, what comes next, and why.",
  robots: { index: false, follow: false },
};

export default function AuditLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
