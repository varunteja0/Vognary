import {
  provisionReceiptInbox,
  revokeReceiptInbox,
} from "@/lib/server/recovery-inbound-store";
import { runReceiptInboxRoute } from "@/lib/server/recovery-inbound-route";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  return runReceiptInboxRoute(request, {
    namespace: "recovery-receipt-inbox-provision",
    mutation: true,
  }, provisionReceiptInbox);
}

export async function DELETE(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  return runReceiptInboxRoute(request, {
    namespace: "recovery-receipt-inbox-revoke",
    mutation: true,
    configurationRequired: false,
  }, revokeReceiptInbox);
}