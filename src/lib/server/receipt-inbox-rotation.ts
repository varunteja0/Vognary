import { RecoveryServiceError } from "@/lib/server/recovery-api";

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
