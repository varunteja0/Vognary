import { getDatabasePool } from "@/lib/server/database";
import { decryptSecret, encryptSecret, type EncryptedSecret } from "@/lib/server/token-vault";

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
  createdAt: string;
  exportedAt: string | null;
};

type AuditReportRow = {
  id: string;
  title: string;
  summary: AuditSnapshotSummary;
  report_json: {
    encrypted?: boolean;
    payload?: EncryptedSecret;
  };
  created_at: Date;
  exported_at: Date | null;
};

export async function saveAuditSnapshot(input: {
  workspaceId: string;
  userId: string;
  title: string;
  summary: AuditSnapshotSummary;
  snapshot: unknown;
}) {
  const associatedData = getSnapshotAssociatedData(input.workspaceId);
  const encrypted = encryptSecret(JSON.stringify(input.snapshot), associatedData);
  const client = await getDatabasePool().connect();

  try {
    await client.query("begin");
    const result = await client.query<Pick<AuditReportRow, "id" | "created_at">>(
      `insert into audit_reports (workspace_id, title, summary, report_json, exported_at)
       values ($1, $2, $3::jsonb, $4::jsonb, now())
       returning id, created_at`,
      [
        input.workspaceId,
        input.title,
        JSON.stringify(input.summary),
        JSON.stringify({ encrypted: true, payload: encrypted }),
      ],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error("Audit snapshot insert did not return an id.");

    await client.query(
      `insert into audit_log (workspace_id, user_id, action, entity_type, entity_id, metadata)
       values ($1, $2, 'audit_snapshot.saved', 'audit_report', $3, $4::jsonb)`,
      [input.workspaceId, input.userId, id, JSON.stringify({ title: input.title, summary: input.summary })],
    );
    await client.query("commit");

    return { id, createdAt: result.rows[0]?.created_at?.toISOString() ?? new Date().toISOString() };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function getLatestAuditSnapshot(workspaceId: string): Promise<AuditSnapshotRecord | null> {
  const result = await getDatabasePool().query<AuditReportRow>(
    `select id, title, summary, report_json, created_at, exported_at
     from audit_reports
     where workspace_id = $1
     order by created_at desc
     limit 1`,
    [workspaceId],
  );
  const row = result.rows[0];
  if (!row) return null;

  return mapAuditSnapshotRow(workspaceId, row);
}

export async function deleteAuditSnapshots(input: { workspaceId: string; userId: string }) {
  const client = await getDatabasePool().connect();

  try {
    await client.query("begin");
    const result = await client.query<{ id: string }>(
      `delete from audit_reports
       where workspace_id = $1
       returning id`,
      [input.workspaceId],
    );

    await client.query(
      `insert into audit_log (workspace_id, user_id, action, entity_type, metadata)
       values ($1, $2, 'audit_snapshot.deleted', 'audit_report', $3::jsonb)`,
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

function mapAuditSnapshotRow(workspaceId: string, row: AuditReportRow): AuditSnapshotRecord {
  if (!row.report_json?.encrypted || !row.report_json.payload) {
    throw new Error("Audit snapshot payload is not encrypted.");
  }

  const plaintext = decryptSecret(row.report_json.payload, getSnapshotAssociatedData(workspaceId));

  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    snapshot: JSON.parse(plaintext),
    createdAt: row.created_at.toISOString(),
    exportedAt: row.exported_at?.toISOString() ?? null,
  };
}

function getSnapshotAssociatedData(workspaceId: string) {
  return `vognary-audit-snapshot:${workspaceId}`;
}