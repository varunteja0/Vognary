import { rotateReceiptInbox } from "@/lib/server/recovery-inbound-store";
import { runReceiptInboxRoute } from "@/lib/server/recovery-inbound-route";
import { readReceiptInboxRotationHeaders } from "@/lib/server/receipt-inbox-rotation";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  return runReceiptInboxRoute(request, {
    namespace: "recovery-receipt-inbox-rotate",
    mutation: true,
  }, (context) => {
    const mutation = readReceiptInboxRotationHeaders(request);
    return rotateReceiptInbox({ ...context, ...mutation });
  });
}