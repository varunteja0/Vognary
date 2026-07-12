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
