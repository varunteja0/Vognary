import "server-only";

import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { canonicalize } from "@/lib/audit-pack";
import { normalizeLedgerEventInput } from "@/lib/ledger-events";
import { getDatabasePool } from "@/lib/server/database";

export type StoredLedgerEvent = {
  id: string;
  workspaceSequence: number;
  eventType: string;
  entityKind: string;
  entityRef: string;
  schemaVersion: number;
  payload: Record<string, unknown>;
  payloadHash: string;
  previousEventHash: string | null;
  eventHash: string;
  occurredAt: string;
};

type LedgerEventRow = {
  id: string;
  workspace_sequence: string;
  event_type: string;
  entity_kind: string;
  entity_ref: string;
  schema_version: number;
  payload: Record<string, unknown>;
  payload_hash: string;
  previous_event_hash: string | null;
  event_hash: string;
  occurred_at: Date;
};

export async function appendLedgerEvent(input: {
  workspaceId: string;
  actorUserId?: string | null;
  eventType: unknown;
  entityKind: unknown;
  entityRef: unknown;
  idempotencyKey: unknown;
  payload?: unknown;
  schemaVersion?: unknown;
}, existingClient?: PoolClient): Promise<StoredLedgerEvent> {
  const normalized = normalizeLedgerEventInput(input);
  const client = existingClient ?? await getDatabasePool().connect();
  const ownsTransaction = !existingClient;
  try {
    if (ownsTransaction) await client.query("begin");
    await client.query(
      `insert into workspace_event_counters (workspace_id, next_sequence)
       values ($1, 1)
       on conflict (workspace_id) do nothing`,
      [input.workspaceId],
    );
    const counter = await client.query<{ next_sequence: string }>(
      `select next_sequence
       from workspace_event_counters
       where workspace_id = $1
       for update`,
      [input.workspaceId],
    );
    const existing = await findEventByIdempotencyKey(client, input.workspaceId, normalized.idempotencyKey);
    if (existing) {
      if (ownsTransaction) await client.query("commit");
      return existing;
    }
    const sequence = Number(counter.rows[0]?.next_sequence);
    if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error("Workspace event sequence is unavailable.");
    const previous = await client.query<{ event_hash: string }>(
      `select event_hash
       from ledger_events
       where workspace_id = $1
       order by workspace_sequence desc
       limit 1`,
      [input.workspaceId],
    );
    const previousEventHash = previous.rows[0]?.event_hash ?? null;
    const payloadHash = sha256(canonicalize(normalized.payload));
    const eventHash = sha256(canonicalize({
      workspaceId: input.workspaceId,
      workspaceSequence: sequence,
      eventType: normalized.eventType,
      entityKind: normalized.entityKind,
      entityRef: normalized.entityRef,
      schemaVersion: normalized.schemaVersion,
      payloadHash,
      previousEventHash,
    }));
    const inserted = await client.query<LedgerEventRow>(
      `insert into ledger_events (
         workspace_id, workspace_sequence, event_type, schema_version,
         actor_user_id, entity_kind, entity_ref, idempotency_key,
         payload, payload_hash, previous_event_hash, event_hash
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       returning id, workspace_sequence::text, event_type, entity_kind, entity_ref,
                 schema_version, payload, payload_hash, previous_event_hash,
                 event_hash, occurred_at`,
      [
        input.workspaceId,
        sequence,
        normalized.eventType,
        normalized.schemaVersion,
        input.actorUserId ?? null,
        normalized.entityKind,
        normalized.entityRef,
        normalized.idempotencyKey,
        normalized.payload,
        payloadHash,
        previousEventHash,
        eventHash,
      ],
    );
    await client.query(
      `update workspace_event_counters
       set next_sequence = $2, updated_at = now()
       where workspace_id = $1`,
      [input.workspaceId, sequence + 1],
    );
    if (ownsTransaction) await client.query("commit");
    return mapEvent(inserted.rows[0]);
  } catch (error) {
    if (ownsTransaction) await client.query("rollback");
    throw error;
  } finally {
    if (ownsTransaction) client.release();
  }
}

export async function listLedgerEvents(workspaceId: string, options: { afterSequence?: number; limit?: number } = {}) {
  const afterSequence = Number.isSafeInteger(options.afterSequence) && Number(options.afterSequence) >= 0
    ? Number(options.afterSequence)
    : 0;
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
  const result = await getDatabasePool().query<LedgerEventRow>(
    `select id, workspace_sequence::text, event_type, entity_kind, entity_ref,
            schema_version, payload, payload_hash, previous_event_hash,
            event_hash, occurred_at
     from ledger_events
     where workspace_id = $1 and workspace_sequence > $2
     order by workspace_sequence asc
     limit $3`,
    [workspaceId, afterSequence, limit],
  );
  return result.rows.map(mapEvent);
}

async function findEventByIdempotencyKey(client: PoolClient, workspaceId: string, idempotencyKey: string) {
  const result = await client.query<LedgerEventRow>(
    `select id, workspace_sequence::text, event_type, entity_kind, entity_ref,
            schema_version, payload, payload_hash, previous_event_hash,
            event_hash, occurred_at
     from ledger_events
     where workspace_id = $1 and idempotency_key = $2`,
    [workspaceId, idempotencyKey],
  );
  return result.rows[0] ? mapEvent(result.rows[0]) : null;
}

function mapEvent(row: LedgerEventRow): StoredLedgerEvent {
  return {
    id: row.id,
    workspaceSequence: Number(row.workspace_sequence),
    eventType: row.event_type,
    entityKind: row.entity_kind,
    entityRef: row.entity_ref,
    schemaVersion: row.schema_version,
    payload: row.payload,
    payloadHash: row.payload_hash,
    previousEventHash: row.previous_event_hash,
    eventHash: row.event_hash,
    occurredAt: row.occurred_at.toISOString(),
  };
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
