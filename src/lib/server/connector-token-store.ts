import { getDatabasePool } from "@/lib/server/database";
import { decryptSecret, encryptSecret, type EncryptedSecret } from "@/lib/server/token-vault";
import type { ConnectorAuthType } from "@/lib/connectors";

export type TokenKind = "access" | "refresh" | "api_key" | "iam_role" | "partner_secret";

export type ConnectedAccountRecord = {
  id: string;
  workspaceId: string;
  sourceId: string | null;
  connectorId: string;
  authType: ConnectorAuthType;
  providerAccountId: string | null;
  displayName: string;
  scopes: string[];
  status: string;
};

export type UpsertConnectedAccountInput = {
  workspaceId: string;
  sourceId?: string | null;
  connectorId: string;
  authType: ConnectorAuthType;
  providerAccountId?: string | null;
  displayName: string;
  scopes?: string[];
  metadata?: Record<string, unknown>;
};

export type StoreConnectorSecretInput = {
  connectedAccountId: string;
  tokenKind: TokenKind;
  secret: string;
  scopes?: string[];
  expiresAt?: string | null;
  metadata?: Record<string, unknown>;
};

export async function upsertConnectedAccount(input: UpsertConnectedAccountInput): Promise<ConnectedAccountRecord> {
  const result = await getDatabasePool().query<ConnectedAccountRow>(
    `insert into connected_accounts (
      workspace_id,
      source_id,
      connector_id,
      auth_type,
      provider_account_id,
      display_name,
      scopes,
      metadata
    ) values ($1, $2, $3, $4, $5, $6, $7, $8)
    on conflict (workspace_id, connector_id, provider_account_id)
    do update set
      source_id = excluded.source_id,
      auth_type = excluded.auth_type,
      display_name = excluded.display_name,
      scopes = excluded.scopes,
      metadata = connected_accounts.metadata || excluded.metadata,
      status = 'active',
      updated_at = now()
    returning id, workspace_id, source_id, connector_id, auth_type, provider_account_id, display_name, scopes, status`,
    [
      input.workspaceId,
      input.sourceId ?? null,
      input.connectorId,
      input.authType,
      input.providerAccountId ?? null,
      input.displayName,
      input.scopes ?? [],
      input.metadata ?? {},
    ],
  );

  const row = result.rows[0];
  if (!row) throw new Error("Connected account upsert did not return a row.");
  return mapConnectedAccount(row);
}

export async function storeConnectorSecret(input: StoreConnectorSecretInput) {
  const encrypted = encryptSecret(input.secret, associatedData(input.connectedAccountId, input.tokenKind));

  await getDatabasePool().query(
    `insert into connector_token_refs (
      connected_account_id,
      token_kind,
      secret_ref,
      encrypted_payload,
      key_fingerprint,
      scopes,
      expires_at,
      status,
      last_rotated_at,
      metadata
    ) values ($1, $2, 'internal:v1', $3, $4, $5, $6, 'active', now(), $7)
    on conflict (connected_account_id, token_kind)
    do update set
      secret_ref = excluded.secret_ref,
      encrypted_payload = excluded.encrypted_payload,
      key_fingerprint = excluded.key_fingerprint,
      scopes = excluded.scopes,
      expires_at = excluded.expires_at,
      status = 'active',
      last_rotated_at = now(),
      metadata = connector_token_refs.metadata || excluded.metadata,
      updated_at = now()`,
    [
      input.connectedAccountId,
      input.tokenKind,
      encrypted,
      encrypted.keyFingerprint,
      input.scopes ?? [],
      input.expiresAt ?? null,
      input.metadata ?? {},
    ],
  );

  return {
    status: "stored" as const,
    keyFingerprint: encrypted.keyFingerprint,
  };
}

export async function loadConnectorSecret(connectedAccountId: string, tokenKind: TokenKind) {
  const result = await getDatabasePool().query<{ encrypted_payload: EncryptedSecret | null }>(
    `select encrypted_payload
     from connector_token_refs
     where connected_account_id = $1
       and token_kind = $2
       and status = 'active'`,
    [connectedAccountId, tokenKind],
  );

  const encrypted = result.rows[0]?.encrypted_payload;
  if (!encrypted) return null;

  return decryptSecret(encrypted, associatedData(connectedAccountId, tokenKind));
}

function associatedData(connectedAccountId: string, tokenKind: TokenKind) {
  return `connected-account:${connectedAccountId}:token-kind:${tokenKind}`;
}

type ConnectedAccountRow = {
  id: string;
  workspace_id: string;
  source_id: string | null;
  connector_id: string;
  auth_type: ConnectorAuthType;
  provider_account_id: string | null;
  display_name: string;
  scopes: string[];
  status: string;
};

function mapConnectedAccount(row: ConnectedAccountRow): ConnectedAccountRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sourceId: row.source_id,
    connectorId: row.connector_id,
    authType: row.auth_type,
    providerAccountId: row.provider_account_id,
    displayName: row.display_name,
    scopes: row.scopes,
    status: row.status,
  };
}
