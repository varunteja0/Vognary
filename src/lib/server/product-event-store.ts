import "server-only";

import type { PoolClient } from "pg";
import { normalizeProductEvent, type ProductEventInput } from "@/lib/product-events";
import { getDatabasePool } from "@/lib/server/database";

export async function recordProductEvent(input: ProductEventInput, client?: PoolClient) {
  const event = normalizeProductEvent(input);
  const queryable = client ?? getDatabasePool();
  const result = await queryable.query<{ id: string }>(
    `insert into product_events (
       workspace_id,
       user_id,
       event_name,
       occurred_at,
       source,
       status,
       duration_ms,
       metrics
     ) values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id`,
    [
      event.workspaceId,
      event.userId,
      event.eventName,
      event.occurredAt,
      event.source,
      event.status,
      event.durationMs,
      event.metrics,
    ],
  );

  const id = result.rows[0]?.id;
  if (!id) throw new Error("Product event insert did not return an id.");
  return { id };
}

export const workspaceActivationSemanticVersion = 1;

export async function recordWorkspaceActivationOnce(input: {
  workspaceId: string;
  userId: string;
  commitmentsTouched: number;
  evidenceWritten: number;
}, client?: PoolClient) {
  const event = normalizeProductEvent({
    workspaceId: input.workspaceId,
    userId: input.userId,
    eventName: "workspace.activated",
    source: "workspace-api",
    status: "succeeded",
    metrics: {
      commitmentsTouched: input.commitmentsTouched,
      evidenceWritten: input.evidenceWritten,
    },
  });
  const queryable = client ?? getDatabasePool();
  const result = await queryable.query<{ id: string }>(
    `insert into product_events (
       workspace_id,
       user_id,
       event_name,
       occurred_at,
       source,
       status,
       duration_ms,
       metrics,
       activation_semantic_version
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (workspace_id) where event_name = 'workspace.activated' and workspace_id is not null
     do nothing
     returning id`,
    [
      event.workspaceId,
      event.userId,
      event.eventName,
      event.occurredAt,
      event.source,
      event.status,
      event.durationMs,
      event.metrics,
      workspaceActivationSemanticVersion,
    ],
  );
  const id = result.rows[0]?.id ?? null;
  return { id, recorded: Boolean(id) };
}
