import type { PoolClient } from "pg";
import { getDatabasePool } from "@/lib/server/database";
import { decryptSecret, encryptSecret, type EncryptedSecret } from "@/lib/server/token-vault";
import type { ConnectorAuthType } from "@/lib/connectors";
import type { ConnectorConnection } from "@/lib/connector-runtime";

export type TokenKind = "access" | "refresh" | "api_key" | "iam_role" | "partner_secret";

export type ConnectedAccountRecord = {
  id: string;
  workspaceId: string;
  sourceId: string | null;
  consentGrantId: string | null;
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
  consentGrantId?: string | null;
  connectorId: string;
  authType: ConnectorAuthType;
  providerAccountId?: string | null;
  displayName: string;
  scopes?: string[];
  metadata?: Record<string, unknown>;
  status?: "pending" | "active";
};

export type StoreConnectorSecretInput = {
  connectedAccountId: string;
  tokenKind: TokenKind;
  secret: string;
  scopes?: string[];
  expiresAt?: string | null;
  metadata?: Record<string, unknown>;
};

export type ConnectorSecretRecord = {
  secret: string;
  scopes: string[];
  expiresAt: string | null;
  metadata: Record<string, unknown>;
};

export async function upsertConnectedAccount(input: UpsertConnectedAccountInput, client?: PoolClient): Promise<ConnectedAccountRecord> {
  const queryable = client ?? getDatabasePool();
  const result = await queryable.query<ConnectedAccountRow>(
    `insert into connected_accounts (
      workspace_id,
      source_id,
      consent_grant_id,
      connector_id,
      auth_type,
      provider_account_id,
      display_name,
      scopes,
      metadata,
      status
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    on conflict (workspace_id, connector_id, provider_account_id)
    do update set
      source_id = excluded.source_id,
      consent_grant_id = excluded.consent_grant_id,
      auth_type = excluded.auth_type,
      display_name = excluded.display_name,
      scopes = excluded.scopes,
      metadata = connected_accounts.metadata || excluded.metadata,
      status = excluded.status,
      last_error = null,
      last_error_at = null,
      updated_at = now()
    returning id, workspace_id, source_id, consent_grant_id, connector_id, auth_type, provider_account_id, display_name, scopes, status`,
    [
      input.workspaceId,
      input.sourceId ?? null,
      input.consentGrantId ?? null,
      input.connectorId,
      input.authType,
      input.providerAccountId ?? null,
      input.displayName,
      input.scopes ?? [],
      input.metadata ?? {},
      input.status ?? "active",
    ],
  );

  const row = result.rows[0];
  if (!row) throw new Error("Connected account upsert did not return a row.");
  return mapConnectedAccount(row);
}

export async function storeConnectorSecret(input: StoreConnectorSecretInput, client?: PoolClient) {
  const encrypted = encryptSecret(input.secret, associatedData(input.connectedAccountId, input.tokenKind));

  const queryable = client ?? getDatabasePool();
  await queryable.query(
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

export async function buildStoredConnectorConnection(input: {
  connectorId: string;
  workspaceId: string;
  connectedAccountId: string;
}): Promise<ConnectorConnection | null> {
  const account = await getConnectedAccount(input);
  if (!account) return null;

  const [access, refresh, apiKey] = await Promise.all([
    loadConnectorSecretRecord(account.id, "access"),
    loadConnectorSecretRecord(account.id, "refresh"),
    loadConnectorSecretRecord(account.id, "api_key"),
  ]);
  const scopes = uniqueStrings([
    ...account.scopes,
    ...(access?.scopes ?? []),
    ...(refresh?.scopes ?? []),
    ...(apiKey?.scopes ?? []),
  ]);

  return {
    connectorId: account.connectorId,
    workspaceId: account.workspaceId,
    connectedAccountId: account.id,
    providerAccountId: account.providerAccountId ?? undefined,
    accessRef: access ? `vault:${account.id}:access` : undefined,
    refreshRef: refresh ? `vault:${account.id}:refresh` : undefined,
    accessToken: access?.secret,
    refreshToken: refresh?.secret,
    apiKey: apiKey?.secret,
    expiresAt: access?.expiresAt ?? apiKey?.expiresAt ?? undefined,
    scopes,
  };
}

export async function getConnectedAccount(input: {
  connectorId: string;
  workspaceId: string;
  connectedAccountId: string;
}): Promise<ConnectedAccountRecord | null> {
  const result = await getDatabasePool().query<ConnectedAccountRow>(
    `select account.id, account.workspace_id, account.source_id, account.consent_grant_id,
            account.connector_id, account.auth_type, account.provider_account_id,
            account.display_name, account.scopes, account.status
     from connected_accounts account
     join consent_grants consent
       on consent.id = account.consent_grant_id
      and consent.workspace_id = account.workspace_id
      and consent.withdrawn_at is null
      and (consent.expires_at is null or consent.expires_at > now())
     where account.id = $1
       and account.workspace_id = $2
       and account.connector_id = $3
       and account.status in ('pending', 'active')`,
    [input.connectedAccountId, input.workspaceId, input.connectorId],
  );

  const row = result.rows[0];
  return row ? mapConnectedAccount(row) : null;
}

export async function activateConnectedAccount(input: {
  connectedAccountId: string;
  connectorId: string;
  workspaceId: string;
}) {
  const result = await getDatabasePool().query(
    `update connected_accounts
     set status = 'active', last_error = null, last_error_at = null, updated_at = now()
     where id = $1
       and workspace_id = $2
       and connector_id = $3
       and status in ('pending', 'active')`,
    [input.connectedAccountId, input.workspaceId, input.connectorId],
  );
  if (!result.rowCount) throw new Error("Pending connected account could not be activated.");
}

export async function loadConnectorSecret(connectedAccountId: string, tokenKind: TokenKind) {
  const record = await loadConnectorSecretRecord(connectedAccountId, tokenKind);
  return record?.secret ?? null;
}

export async function loadConnectorSecretRecord(connectedAccountId: string, tokenKind: TokenKind): Promise<ConnectorSecretRecord | null> {
  const result = await getDatabasePool().query<{
    encrypted_payload: EncryptedSecret | null;
    scopes: string[];
    expires_at: Date | null;
    metadata: Record<string, unknown>;
  }>(
    `select encrypted_payload
            , scopes
            , expires_at
            , metadata
     from connector_token_refs
     where connected_account_id = $1
       and token_kind = $2
       and status = 'active'`,
    [connectedAccountId, tokenKind],
  );

  const encrypted = result.rows[0]?.encrypted_payload;
  if (!encrypted) return null;

  const row = result.rows[0];
  return {
    secret: decryptSecret(encrypted, associatedData(connectedAccountId, tokenKind)),
    scopes: row.scopes ?? [],
    expiresAt: row.expires_at?.toISOString() ?? null,
    metadata: row.metadata ?? {},
  };
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function associatedData(connectedAccountId: string, tokenKind: TokenKind) {
  return `connected-account:${connectedAccountId}:token-kind:${tokenKind}`;
}

type ConnectedAccountRow = {
  id: string;
  workspace_id: string;
  source_id: string | null;
  consent_grant_id: string | null;
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
    consentGrantId: row.consent_grant_id,
    connectorId: row.connector_id,
    authType: row.auth_type,
    providerAccountId: row.provider_account_id,
    displayName: row.display_name,
    scopes: row.scopes,
    status: row.status,
  };
}
