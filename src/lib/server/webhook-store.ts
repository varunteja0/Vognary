import { createHash } from "node:crypto";
import { getDatabasePool, isDatabaseConfigured } from "@/lib/server/database";

export type ConnectorWebhookEventInput = {
  connectorId: string;
  providerEventId?: string | null;
  eventType: string;
  signatureValid: boolean;
  rawBody: string;
  payload: Record<string, unknown>;
};

export async function persistConnectorWebhookEvent(input: ConnectorWebhookEventInput) {
  if (!isDatabaseConfigured()) {
    return {
      status: "not-persisted" as const,
      reason: "database-not-configured",
      payloadHash: hashPayload(input.rawBody),
    };
  }

  const payloadHash = hashPayload(input.rawBody);
  const result = await getDatabasePool().query<{ id: string }>(
    `insert into connector_webhook_events (
      connector_id,
      provider_event_id,
      event_type,
      signature_valid,
      status,
      payload_hash,
      payload
    ) values ($1, $2, $3, $4, 'verified', $5, $6)
    on conflict (connector_id, provider_event_id) where provider_event_id is not null
    do update set
      event_type = excluded.event_type,
      signature_valid = excluded.signature_valid,
      payload_hash = excluded.payload_hash,
      payload = case
        when connector_webhook_events.payload_minimized_at is null then excluded.payload
        else connector_webhook_events.payload
      end,
      status = case
        when connector_webhook_events.payload_minimized_at is null then 'verified'::webhook_event_status
        else 'ignored'::webhook_event_status
      end,
      received_at = case
        when connector_webhook_events.payload_minimized_at is null then now()
        else connector_webhook_events.received_at
      end,
      error_message = null,
      error_at = null
    returning id`,
    [
      input.connectorId,
      input.providerEventId ?? null,
      input.eventType,
      input.signatureValid,
      payloadHash,
      input.payload,
    ],
  );

  return {
    status: "persisted" as const,
    eventId: result.rows[0]?.id,
    payloadHash,
  };
}

function hashPayload(rawBody: string) {
  return createHash("sha256").update(rawBody).digest("base64url");
}
