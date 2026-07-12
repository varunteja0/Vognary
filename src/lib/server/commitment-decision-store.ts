import "server-only";

import { isCommitmentDecisionAllowed, normalizeCommitmentDecisionAction } from "@/lib/commitment-decisions";
import { getDatabasePool } from "@/lib/server/database";
import type { RecommendationType } from "@/lib/recurring-audit";

export type WorkspaceCommitmentDecision = {
  id: string;
  recurringItemId: string;
  action: RecommendationType;
  decidedAt: string;
  updatedAt: string;
  merchant: string;
  normalizedMerchant: string;
  currency: string;
};

type DecisionRow = {
  id: string;
  recurring_item_id: string;
  action: RecommendationType;
  decided_at: Date;
  updated_at: Date;
  merchant: string;
  normalized_merchant: string;
  currency: string;
};

export async function listWorkspaceCommitmentDecisions(
  workspaceId: string,
  limit = 500,
  afterId: string | null = null,
  orderById = false,
): Promise<WorkspaceCommitmentDecision[]> {
  const result = await getDatabasePool().query<DecisionRow>(
    `select d.id, d.recurring_item_id, d.action, d.decided_at, d.updated_at,
            ri.merchant, ri.normalized_merchant, ri.currency
     from commitment_decisions d
     join recurring_items ri on ri.id = d.recurring_item_id and ri.workspace_id = d.workspace_id
     where d.workspace_id = $1
       and ($3::uuid is null or d.id > $3::uuid)
     order by
       case when $4::boolean then d.id end asc,
       case when not $4::boolean then d.updated_at end desc
     limit $2`,
    [workspaceId, Math.max(1, Math.min(limit, 501)), afterId, orderById],
  );
  return result.rows.map(mapDecision);
}

export async function upsertWorkspaceCommitmentDecision(input: {
  workspaceId: string;
  recurringItemId: string;
  userId: string;
  action: unknown;
}) {
  const action = normalizeCommitmentDecisionAction(input.action);
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    const item = await client.query<{ category: string }>(
      `select category from recurring_items where id = $1 and workspace_id = $2 for update`,
      [input.recurringItemId, input.workspaceId],
    );
    const category = item.rows[0]?.category;
    if (!category) {
      await client.query("rollback");
      return { status: "not-found" as const };
    }
    if (!isCommitmentDecisionAllowed(category, action)) {
      await client.query("rollback");
      return { status: "unsafe" as const };
    }

    const result = await client.query<DecisionRow>(
      `with saved as (
         insert into commitment_decisions (workspace_id, recurring_item_id, decided_by_user_id, action)
         values ($1, $2, $3, $4)
         on conflict (workspace_id, recurring_item_id)
         do update set action = excluded.action,
                       decided_by_user_id = excluded.decided_by_user_id,
                       decided_at = now(),
                       updated_at = now()
         returning id, recurring_item_id, action, decided_at, updated_at
       )
       select saved.id, saved.recurring_item_id, saved.action, saved.decided_at, saved.updated_at,
              ri.merchant, ri.normalized_merchant, ri.currency
       from saved
       join recurring_items ri on ri.id = saved.recurring_item_id`,
      [input.workspaceId, input.recurringItemId, input.userId, action],
    );
    await client.query(
      `insert into audit_log (workspace_id, user_id, action, entity_type, entity_id, metadata)
       values ($1, $2, 'commitment.decision.updated', 'recurring_item', $3, jsonb_build_object('action', $4::text))`,
      [input.workspaceId, input.userId, input.recurringItemId, action],
    );
    await client.query("commit");
    return { status: "saved" as const, decision: mapDecision(result.rows[0]) };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function mapDecision(row: DecisionRow): WorkspaceCommitmentDecision {
  return {
    id: row.id,
    recurringItemId: row.recurring_item_id,
    action: row.action,
    decidedAt: row.decided_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    merchant: row.merchant,
    normalizedMerchant: row.normalized_merchant,
    currency: row.currency,
  };
}
