import { getReceiptInboxStatus } from "@/lib/server/recovery-inbound-store";
import { runReceiptInboxRoute } from "@/lib/server/recovery-inbound-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return runReceiptInboxRoute(request, {
    namespace: "recovery-sources-read",
    configurationRequired: false,
  }, getReceiptInboxStatus);
}
