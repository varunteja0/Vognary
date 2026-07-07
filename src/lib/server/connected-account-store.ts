import { getDatabasePool } from "@/lib/server/database";

export type WorkspaceConnectedAccountSummary = {
  id: string;
  connectorId: string;
  providerAccountId: string | null;
  displayName: string;
  scopes: string[];
  status: string;
  createdAt: string;
  updatedAt: string;
  latestRunStatus: string | null;
  latestRunAt: string | null;
  evidenceCount: number;
};

export type WorkspaceConnectorEvidence = {
  id: string;
  connectorId: string;
  connectedAccountId: string | null;
  provider: string;
  evidenceType: string;
  observedAt: string;
  merchantRaw: string | null;
  amount: number | null;
  currency: string | null;
  cadenceHint: string | null;
  nextDebitHint: string | null;
  confidenceScore: number;
};

type ConnectedAccountRow = {
  id: string;
  connector_id: string;
  provider_account_id: string | null;
  display_name: string;
  scopes: string[];
  status: string;
  created_at: Date;
  updated_at: Date;
  latest_run_status: string | null;
  latest_run_at: Date | null;
  evidence_count: string;
};

type EvidenceRow = {
  id: string;
  connector_id: string;
  connected_account_id: string | null;
  provider: string;
  evidence_type: string;
  observed_at: Date;
  merchant_raw: string | null;
  amount: string | null;
  currency: string | null;
  cadence_hint: string | null;
  next_debit_hint: Date | null;
  confidence_score: number;
};

export async function listWorkspaceConnectedAccounts(workspaceId: string): Promise<WorkspaceConnectedAccountSummary[]> {
  const result = await getDatabasePool().query<ConnectedAccountRow>(
    `select
       ca.id,
       ca.connector_id,
       ca.provider_account_id,
       ca.display_name,
       ca.scopes,
       ca.status,
       ca.created_at,
       ca.updated_at,
       latest_run.status as latest_run_status,
       latest_run.started_at as latest_run_at,
       (select count(*) from connector_evidence ce where ce.connected_account_id = ca.id) as evidence_count
     from connected_accounts ca
     left join lateral (
       select status, started_at
       from connector_sync_runs csr
       where csr.connected_account_id = ca.id
       order by started_at desc
       limit 1
     ) latest_run on true
     where ca.workspace_id = $1
     order by ca.updated_at desc`,
    [workspaceId],
  );

  return result.rows.map(mapConnectedAccount);
}

export async function getWorkspaceConnectedAccount(workspaceId: string, connectedAccountId: string) {
  const result = await getDatabasePool().query<ConnectedAccountRow>(
    `select
       ca.id,
       ca.connector_id,
       ca.provider_account_id,
       ca.display_name,
       ca.scopes,
       ca.status,
       ca.created_at,
       ca.updated_at,
       latest_run.status as latest_run_status,
       latest_run.started_at as latest_run_at,
       (select count(*) from connector_evidence ce where ce.connected_account_id = ca.id) as evidence_count
     from connected_accounts ca
     left join lateral (
       select status, started_at
       from connector_sync_runs csr
       where csr.connected_account_id = ca.id
       order by started_at desc
       limit 1
     ) latest_run on true
     where ca.workspace_id = $1
       and ca.id = $2
     limit 1`,
    [workspaceId, connectedAccountId],
  );

  const row = result.rows[0];
  return row ? mapConnectedAccount(row) : null;
}

export async function listWorkspaceConnectorEvidence(workspaceId: string, limit = 100): Promise<WorkspaceConnectorEvidence[]> {
  const result = await getDatabasePool().query<EvidenceRow>(
    `select id,
            connector_id,
            connected_account_id,
            provider,
            evidence_type,
            observed_at,
            merchant_raw,
            amount,
            currency,
            cadence_hint,
            next_debit_hint,
            confidence_score
     from connector_evidence
     where workspace_id = $1
     order by observed_at desc, created_at desc
     limit $2`,
    [workspaceId, Math.max(1, Math.min(limit, 250))],
  );

  return result.rows.map(mapEvidence);
}

export async function revokeWorkspaceConnectedAccount(workspaceId: string, connectedAccountId: string) {
  const client = await getDatabasePool().connect();

  try {
    await client.query("begin");
    const account = await client.query<{ id: string }>(
      `update connected_accounts
       set status = 'revoked', updated_at = now()
       where workspace_id = $1
         and id = $2
       returning id`,
      [workspaceId, connectedAccountId],
    );

    if (!account.rowCount) {
      await client.query("rollback");
      return { revoked: false, tokenRefsRevoked: 0 };
    }

    const tokenRefs = await client.query(
      `update connector_token_refs
       set status = 'revoked', updated_at = now()
       where connected_account_id = $1
         and status = 'active'`,
      [connectedAccountId],
    );

    await client.query("commit");
    return { revoked: true, tokenRefsRevoked: tokenRefs.rowCount ?? 0 };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function mapConnectedAccount(row: ConnectedAccountRow): WorkspaceConnectedAccountSummary {
  return {
    id: row.id,
    connectorId: row.connector_id,
    providerAccountId: row.provider_account_id,
    displayName: row.display_name,
    scopes: row.scopes,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    latestRunStatus: row.latest_run_status,
    latestRunAt: row.latest_run_at?.toISOString() ?? null,
    evidenceCount: Number(row.evidence_count),
  };
}

function mapEvidence(row: EvidenceRow): WorkspaceConnectorEvidence {
  return {
    id: row.id,
    connectorId: row.connector_id,
    connectedAccountId: row.connected_account_id,
    provider: row.provider,
    evidenceType: row.evidence_type,
    observedAt: row.observed_at.toISOString(),
    merchantRaw: row.merchant_raw,
    amount: row.amount === null ? null : Number(row.amount),
    currency: row.currency,
    cadenceHint: row.cadence_hint,
    nextDebitHint: row.next_debit_hint?.toISOString().slice(0, 10) ?? null,
    confidenceScore: row.confidence_score,
  };
}