import { RecoveryServiceError } from "@/lib/server/recovery-api";
import { rotateReceiptInbox } from "@/lib/server/recovery-inbound-store";
import { runReceiptInboxRoute } from "@/lib/server/recovery-inbound-route";
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

export function readReceiptInboxRotationHeaders(request: Request): {
  expectedAliasId: string;
  idempotencyKey: string;
} {
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(idempotencyKey)) {
    throw new RecoveryServiceError("INVALID_EVIDENCE", "A valid Idempotency-Key header is required.");
  }
  const match = /^"([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})"$/i.exec(request.headers.get("if-match")?.trim() ?? "");
  if (!match) {
    throw new RecoveryServiceError("INVALID_EVIDENCE", "If-Match must quote the active receipt-address id.");
  }
  return { expectedAliasId: match[1], idempotencyKey };
}