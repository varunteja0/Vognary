import "server-only";

import type { PoolClient } from "pg";
import { appendLedgerEvent } from "@/lib/server/ledger-event-store";
import { getDatabasePool } from "@/lib/server/database";

export async function syncWorkspaceProofGraph(input: {
  workspaceId: string;
  actorUserId?: string | null;
  idempotencyKey: string;
}, client: PoolClient) {
  await client.query(
    `insert into merchant_entities (workspace_id, normalized_name, display_name)
     select workspace_id, normalized_merchant, min(merchant)
     from recurring_items
     where workspace_id = $1 and length(btrim(normalized_merchant)) > 0
     group by workspace_id, normalized_merchant
     on conflict (workspace_id, normalized_name)
     do update set display_name = excluded.display_name, updated_at = now()`,
    [input.workspaceId],
  );
  await client.query(
    `update recurring_items item
     set merchant_entity_id = merchant.id
     from merchant_entities merchant
     where item.workspace_id = $1
       and merchant.workspace_id = item.workspace_id
       and merchant.normalized_name = item.normalized_merchant
       and item.merchant_entity_id is distinct from merchant.id`,
    [input.workspaceId],
  );
  await client.query(
    `insert into proof_nodes (workspace_id, kind, entity_ref)
     select workspace_id, 'commitment', id::text from recurring_items where workspace_id = $1
     union all
     select workspace_id, 'source', id::text from data_sources where workspace_id = $1
     union all
     select workspace_id, 'merchant', id::text from merchant_entities where workspace_id = $1
     union all
     select distinct workspace_id, 'rail', rail_id from data_sources where workspace_id = $1 and rail_id is not null
     on conflict (workspace_id, kind, entity_ref) do update
     set status = 'active', retired_at = null`,
    [input.workspaceId],
  );
  await client.query(
    `insert into proof_nodes (workspace_id, kind, entity_ref)
     select item.workspace_id, 'evidence', 'evidence-link:' || evidence.id::text
     from evidence_links evidence
     join recurring_items item on item.id = evidence.recurring_item_id
     where item.workspace_id = $1
     union all
     select workspace_id, 'evidence', 'connector-evidence:' || id::text
     from connector_evidence
     where workspace_id = $1
     on conflict (workspace_id, kind, entity_ref) do update
     set status = 'active', retired_at = null`,
    [input.workspaceId],
  );
  await client.query(
    `update proof_nodes node
     set status = 'retired', retired_at = now()
     where node.workspace_id = $1
       and node.status = 'active'
       and (
         (node.kind = 'commitment' and not exists (
           select 1 from recurring_items item
           where item.workspace_id = node.workspace_id and item.id::text = node.entity_ref
         ))
         or (node.kind = 'source' and not exists (
           select 1 from data_sources source
           where source.workspace_id = node.workspace_id and source.id::text = node.entity_ref
         ))
         or (node.kind = 'merchant' and not exists (
           select 1 from recurring_items item
           where item.workspace_id = node.workspace_id and item.merchant_entity_id::text = node.entity_ref
         ))
         or (node.kind = 'rail' and not exists (
           select 1 from data_sources source
           where source.workspace_id = node.workspace_id and source.rail_id = node.entity_ref
         ))
         or (node.kind = 'evidence' and not exists (
           select 1
           from evidence_links evidence
           join recurring_items item on item.id = evidence.recurring_item_id
           where item.workspace_id = node.workspace_id
             and node.entity_ref = 'evidence-link:' || evidence.id::text
           union all
           select 1
           from connector_evidence evidence
           where evidence.workspace_id = node.workspace_id
             and node.entity_ref = 'connector-evidence:' || evidence.id::text
         ))
       )`,
    [input.workspaceId],
  );
  await client.query(
    `update proof_edges edge
     set valid_to = now()
     where edge.workspace_id = $1
       and edge.valid_to is null
       and (
         exists (
           select 1 from proof_nodes node
           where node.workspace_id = edge.workspace_id
             and node.id in (edge.from_node_id, edge.to_node_id)
             and node.status = 'retired'
         )
         or (edge.edge_type = 'describes' and not exists (
           select 1
           from recurring_items item
           join proof_nodes commitment on commitment.workspace_id = item.workspace_id
             and commitment.kind = 'commitment' and commitment.entity_ref = item.id::text
           join proof_nodes merchant on merchant.workspace_id = item.workspace_id
             and merchant.kind = 'merchant' and merchant.entity_ref = item.merchant_entity_id::text
           where item.workspace_id = edge.workspace_id
             and commitment.id = edge.from_node_id and merchant.id = edge.to_node_id
         ))
         or (edge.edge_type = 'proven_by' and not exists (
           select 1
           from evidence_links evidence
           join recurring_items item on item.id = evidence.recurring_item_id
           join proof_nodes commitment on commitment.workspace_id = item.workspace_id
             and commitment.kind = 'commitment' and commitment.entity_ref = item.id::text
           join proof_nodes evidence_node on evidence_node.workspace_id = item.workspace_id
             and evidence_node.kind = 'evidence' and evidence_node.entity_ref = 'evidence-link:' || evidence.id::text
           where item.workspace_id = edge.workspace_id
             and commitment.id = edge.from_node_id and evidence_node.id = edge.to_node_id
         ))
         or (edge.edge_type = 'observed_in' and not exists (
           select 1
           from evidence_links evidence
           join recurring_items item on item.id = evidence.recurring_item_id
           join proof_nodes evidence_node on evidence_node.workspace_id = item.workspace_id
             and evidence_node.kind = 'evidence' and evidence_node.entity_ref = 'evidence-link:' || evidence.id::text
           join proof_nodes source_node on source_node.workspace_id = item.workspace_id
             and source_node.kind = 'source' and source_node.entity_ref = evidence.source_id::text
           where item.workspace_id = edge.workspace_id
             and evidence_node.id = edge.from_node_id and source_node.id = edge.to_node_id
         ))
         or (edge.edge_type = 'paid_via' and not exists (
           select 1
           from data_sources source
           join proof_nodes source_node on source_node.workspace_id = source.workspace_id
             and source_node.kind = 'source' and source_node.entity_ref = source.id::text
           join proof_nodes rail_node on rail_node.workspace_id = source.workspace_id
             and rail_node.kind = 'rail' and rail_node.entity_ref = source.rail_id
           where source.workspace_id = edge.workspace_id
             and source_node.id = edge.from_node_id and rail_node.id = edge.to_node_id
         ))
       )`,
    [input.workspaceId],
  );
  await client.query(
    `insert into proof_edges (workspace_id, from_node_id, to_node_id, edge_type)
     select item.workspace_id, commitment.id, merchant_node.id, 'describes'
     from recurring_items item
     join proof_nodes commitment on commitment.workspace_id = item.workspace_id and commitment.kind = 'commitment' and commitment.entity_ref = item.id::text
     join proof_nodes merchant_node on merchant_node.workspace_id = item.workspace_id and merchant_node.kind = 'merchant' and merchant_node.entity_ref = item.merchant_entity_id::text
     where item.workspace_id = $1 and item.merchant_entity_id is not null
     union all
     select item.workspace_id, commitment.id, evidence_node.id, 'proven_by'
     from evidence_links evidence
     join recurring_items item on item.id = evidence.recurring_item_id
     join proof_nodes commitment on commitment.workspace_id = item.workspace_id and commitment.kind = 'commitment' and commitment.entity_ref = item.id::text
     join proof_nodes evidence_node on evidence_node.workspace_id = item.workspace_id and evidence_node.kind = 'evidence' and evidence_node.entity_ref = 'evidence-link:' || evidence.id::text
     where item.workspace_id = $1
     union all
     select item.workspace_id, evidence_node.id, source_node.id, 'observed_in'
     from evidence_links evidence
     join recurring_items item on item.id = evidence.recurring_item_id
     join proof_nodes evidence_node on evidence_node.workspace_id = item.workspace_id and evidence_node.kind = 'evidence' and evidence_node.entity_ref = 'evidence-link:' || evidence.id::text
     join proof_nodes source_node on source_node.workspace_id = item.workspace_id and source_node.kind = 'source' and source_node.entity_ref = evidence.source_id::text
     where item.workspace_id = $1 and evidence.source_id is not null
     union all
     select source.workspace_id, source_node.id, rail_node.id, 'paid_via'
     from data_sources source
     join proof_nodes source_node on source_node.workspace_id = source.workspace_id and source_node.kind = 'source' and source_node.entity_ref = source.id::text
     join proof_nodes rail_node on rail_node.workspace_id = source.workspace_id and rail_node.kind = 'rail' and rail_node.entity_ref = source.rail_id
     where source.workspace_id = $1 and source.rail_id is not null
     on conflict (workspace_id, from_node_id, to_node_id, edge_type) where valid_to is null do nothing`,
    [input.workspaceId],
  );
  const counts = await client.query<{ proof_node_count: number; proof_edge_count: number; commitment_count: number; source_count: number }>(
    `select
       (select count(*)::int from proof_nodes where workspace_id = $1 and status = 'active') as proof_node_count,
       (select count(*)::int from proof_edges where workspace_id = $1 and valid_to is null) as proof_edge_count,
       (select count(*)::int from recurring_items where workspace_id = $1) as commitment_count,
       (select count(*)::int from data_sources where workspace_id = $1 and status = 'active') as source_count`,
    [input.workspaceId],
  );
  const row = counts.rows[0] ?? { proof_node_count: 0, proof_edge_count: 0, commitment_count: 0, source_count: 0 };
  const event = await appendLedgerEvent({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    eventType: "graph.materialized",
    entityKind: "graph",
    entityRef: input.workspaceId,
    idempotencyKey: input.idempotencyKey,
    payload: {
      proofNodeCount: row.proof_node_count,
      proofEdgeCount: row.proof_edge_count,
      commitmentCount: row.commitment_count,
      sourceCount: row.source_count,
    },
  }, client);
  await client.query(
    `update confidence_explanations
     set graph_revision = $2
     where workspace_id = $1 and graph_revision < $2`,
    [input.workspaceId, event.workspaceSequence],
  );
  return { ...row, graphRevision: event.workspaceSequence };
}

export async function getWorkspaceProofGraph(workspaceId: string, limit = 1000) {
  const boundedLimit = Math.max(1, Math.min(limit, 2000));
  const [nodes, edges, confidence, revision] = await Promise.all([
    getDatabasePool().query<{
      id: string; kind: string; entity_ref: string; status: string; created_at: Date;
    }>(
      `select id, kind, entity_ref, status, created_at
       from proof_nodes
       where workspace_id = $1 and status = 'active'
       order by kind, created_at, id
       limit $2`,
      [workspaceId, boundedLimit],
    ),
    getDatabasePool().query<{
      id: string; from_node_id: string; to_node_id: string; edge_type: string; valid_from: Date;
    }>(
      `select id, from_node_id, to_node_id, edge_type, valid_from
       from proof_edges
       where workspace_id = $1 and valid_to is null
       order by valid_from, id
       limit $2`,
      [workspaceId, boundedLimit * 4],
    ),
    getDatabasePool().query<{
      recurring_item_id: string; score: number; proof_density: string; source_diversity: string;
      freshness: string; cadence_stability: string; model_version: string; graph_revision: string;
      explanation: Record<string, unknown>; computed_at: Date;
    }>(
      `select recurring_item_id, score, proof_density::text, source_diversity::text,
              freshness::text, cadence_stability::text, model_version,
              graph_revision::text, explanation, computed_at
       from confidence_explanations
       where workspace_id = $1
       order by score desc, recurring_item_id
       limit $2`,
      [workspaceId, boundedLimit],
    ),
    getDatabasePool().query<{ graph_revision: string | null }>(
      `select max(workspace_sequence)::text as graph_revision
       from ledger_events
       where workspace_id = $1`,
      [workspaceId],
    ),
  ]);
  return {
    graphRevision: Number(revision.rows[0]?.graph_revision ?? 0),
    nodes: nodes.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      entityRef: row.entity_ref,
      status: row.status,
      createdAt: row.created_at.toISOString(),
    })),
    edges: edges.rows.map((row) => ({
      id: row.id,
      fromNodeId: row.from_node_id,
      toNodeId: row.to_node_id,
      edgeType: row.edge_type,
      validFrom: row.valid_from.toISOString(),
    })),
    confidence: confidence.rows.map((row) => ({
      recurringItemId: row.recurring_item_id,
      score: row.score,
      proofDensity: Number(row.proof_density),
      sourceDiversity: Number(row.source_diversity),
      freshness: Number(row.freshness),
      cadenceStability: Number(row.cadence_stability),
      modelVersion: row.model_version,
      graphRevision: Number(row.graph_revision),
      explanation: row.explanation,
      computedAt: row.computed_at.toISOString(),
    })),
  };
}
