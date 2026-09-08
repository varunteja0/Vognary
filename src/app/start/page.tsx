import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { readCurrentSession } from "@/lib/server/session";
import BillReviewDemo from "./bill-review-demo";

export const metadata: Metadata = {
  title: "Supplier bill review",
  description: "A fixed synthetic bill amendment, human disposition and follow-up. No customer financial input or provider connection in the demonstration.",
  robots: { index: false, follow: false },
};

export default async function StartPage() {
  const requestHeaders = await headers();
  const session = await readCurrentSession(new Request("https://vognary.local", {
    headers: { cookie: requestHeaders.get("cookie") ?? "" },
  })).catch(() => null);
  if (session?.workspaceId) redirect("/app?view=BILL_REVIEW");
  return <BillReviewDemo />;
}
