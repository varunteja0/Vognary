import { getDatabasePool } from "@/lib/server/database";
import { decryptSecret, encryptSecret, type EncryptedSecret } from "@/lib/server/token-vault";
import { materializeWorkspaceState } from "@/lib/server/workspace-state-materializer";
import { syncWorkspaceProofGraph } from "@/lib/server/proof-graph-store";

export type AuditSnapshotSummary = {
  recurringCount: number;
  monthlyRecurringSpend: number;
  annualRecurringSpend: number;
  reviewableMonthlySpend: number;
  sourceCount: number;
  manualCount: number;
};

export type AuditSnapshotRecord = {
  id: string;
  title: string;
  summary: AuditSnapshotSummary;
  snapshot: unknown;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

type WorkspaceStateRow = {
  workspace_id: string;
  summary: AuditSnapshotSummary;
  encrypted_snapshot: {
    encrypted?: boolean;
    payload?: EncryptedSecret;
  };
  revision: string;
  created_at: Date;
  updated_at: Date;
};

export async function saveAuditSnapshot(input: {
  workspaceId: string;
  userId: string;
  title: string;
  summary: AuditSnapshotSummary;
  snapshot: unknown;
  expectedRevision?: number | null;
}) {
  const associatedData = getSnapshotAssociatedData(input.workspaceId);
  const encrypted = encryptSecret(JSON.stringify(input.snapshot), associatedData);
  const client = await getDatabasePool().connect();

  try {
    await client.query("begin");
    await client.query(
      `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`workspace-state:${input.workspaceId}`],
    );
    const current = await client.query<{ revision: string }>(
      `select revision::text
       from workspace_states
       where workspace_id = $1
       for update`,
      [input.workspaceId],
    );
    const currentRevision = current.rows[0] ? Number(current.rows[0].revision) : null;
    const expectedRevision = input.expectedRevision ?? null;
    if (currentRevision !== expectedRevision) {
      await client.query("rollback");
      return { status: "conflict" as const, currentRevision };
    }

    const nextRevision = (currentRevision ?? 0) + 1;
    const result = await client.query<{ revision: string; created_at: Date; updated_at: Date }>(
      `insert into workspace_states (
         workspace_id, encrypted_snapshot, summary, revision, updated_by_user_id
       ) values ($1, $2::jsonb, $3::jsonb, $4, $5)
       on conflict (workspace_id)
       do update set encrypted_snapshot = excluded.encrypted_snapshot,
                     summary = excluded.summary,
                     revision = excluded.revision,
                     updated_by_user_id = excluded.updated_by_user_id,
                     updated_at = now()
       returning revision::text, created_at, updated_at`,
      [input.workspaceId, JSON.stringify({ encrypted: true, payload: encrypted }), JSON.stringify(input.summary), nextRevision, input.userId],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Workspace state upsert did not return a row.");
    const materialized = await materializeWorkspaceState(client, input.workspaceId, input.snapshot);
    const graph = await syncWorkspaceProofGraph({
      workspaceId: input.workspaceId,
      actorUserId: input.userId,
      idempotencyKey: `graph:workspace-state:${input.workspaceId}:${nextRevision}`,
    }, client);

    await client.query(
      `insert into audit_log (workspace_id, user_id, action, entity_type, entity_id, metadata)
       values ($1, $2, 'workspace_state.saved', 'workspace_state', $1, $3::jsonb)`,
      [input.workspaceId, input.userId, JSON.stringify({ revision: nextRevision, materialized, graph })],
    );
    await client.query("commit");

    return {
      status: "saved" as const,
      id: input.workspaceId,
      revision: Number(row.revision),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      materialized: { ...materialized, graph },
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function getLatestAuditSnapshot(workspaceId: string): Promise<AuditSnapshotRecord | null> {
  const result = await getDatabasePool().query<WorkspaceStateRow>(
    `select workspace_id, summary, encrypted_snapshot, revision::text, created_at, updated_at
     from workspace_states
     where workspace_id = $1`,
    [workspaceId],
  );
  const row = result.rows[0];
  if (!row) return null;

  return mapWorkspaceStateRow(workspaceId, row);
}

export async function deleteAuditSnapshots(input: { workspaceId: string; userId: string }) {
  const client = await getDatabasePool().connect();

  try {
    await client.query("begin");
    const result = await client.query<{ workspace_id: string }>(
      `delete from workspace_states
       where workspace_id = $1
       returning workspace_id`,
      [input.workspaceId],
    );
    await client.query(
      `delete from recurring_items
       where workspace_id = $1
         and external_reference like 'workspace-state:%'`,
      [input.workspaceId],
    );
    await client.query(
      `delete from transactions
       where workspace_id = $1
         and external_reference like 'workspace-state:%'`,
      [input.workspaceId],
    );
    await client.query(
      `delete from data_sources
       where workspace_id = $1
         and external_reference like 'workspace-state:%'`,
      [input.workspaceId],
    );

    await client.query(
      `insert into audit_log (workspace_id, user_id, action, entity_type, metadata)
      values ($1, $2, 'workspace_state.deleted', 'workspace_state', $3::jsonb)`,
      [input.workspaceId, input.userId, JSON.stringify({ deletedCount: result.rowCount ?? 0 })],
    );
    await client.query("commit");
    return result.rowCount ?? 0;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function mapWorkspaceStateRow(workspaceId: string, row: WorkspaceStateRow): AuditSnapshotRecord {
  if (!row.encrypted_snapshot?.encrypted || !row.encrypted_snapshot.payload) {
    throw new Error("Workspace state payload is not encrypted.");
  }

  const plaintext = decryptSecret(row.encrypted_snapshot.payload, getSnapshotAssociatedData(workspaceId));

  return {
    id: row.workspace_id,
    title: "Vognary workspace state",
    summary: row.summary,
    snapshot: JSON.parse(plaintext),
    revision: Number(row.revision),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function getSnapshotAssociatedData(workspaceId: string) {
  return `vognary-audit-snapshot:${workspaceId}`;
}
