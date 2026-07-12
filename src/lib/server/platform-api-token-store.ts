import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { normalizePlatformApiScopes, type PlatformApiScope } from "@/lib/platform-api";
import { getDatabasePool } from "@/lib/server/database";

export type PlatformApiTokenSummary = {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: PlatformApiScope[];
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

type PlatformTokenRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  name: string;
  token_prefix: string;
  scopes: PlatformApiScope[];
  expires_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
};

export async function createPlatformApiToken(input: {
  workspaceId: string;
  userId: string;
  name: string;
  scopes: unknown;
  expiresInDays?: number;
}) {
  const name = normalizeTokenName(input.name);
  const scopes = normalizePlatformApiScopes(input.scopes);
  const expiresInDays = Math.max(1, Math.min(365, Math.round(input.expiresInDays ?? 90)));
  const plaintext = `vgy_live_${randomBytes(32).toString("base64url")}`;
  const prefix = plaintext.slice(0, 17);
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1_000);

  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    const result = await client.query<PlatformTokenRow>(
      `insert into platform_api_tokens (
         workspace_id, user_id, name, token_prefix, token_hash, scopes, expires_at
       ) values ($1, $2, $3, $4, $5, $6, $7)
       returning id, workspace_id, user_id, name, token_prefix, scopes, expires_at, last_used_at, revoked_at, created_at`,
      [input.workspaceId, input.userId, name, prefix, hashPlatformToken(plaintext), scopes, expiresAt],
    );
    const row = result.rows[0];
    if (!row) throw new Error("API token insert did not return a row.");
    await client.query(
      `insert into audit_log (workspace_id, user_id, action, entity_type, entity_id, metadata)
       values ($1, $2, 'platform_api_token.created', 'platform_api_token', $3,
               jsonb_build_object('scopes', $4::text[], 'expiresAt', $5::timestamptz))`,
      [input.workspaceId, input.userId, row.id, scopes, expiresAt],
    );
    await client.query("commit");
    return { token: plaintext, summary: mapToken(row) };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function listPlatformApiTokens(workspaceId: string) {
  const result = await getDatabasePool().query<PlatformTokenRow>(
    `select id, workspace_id, user_id, name, token_prefix, scopes, expires_at, last_used_at, revoked_at, created_at
     from platform_api_tokens
     where workspace_id = $1
     order by created_at desc
     limit 100`,
    [workspaceId],
  );
  return result.rows.map(mapToken);
}

export async function revokePlatformApiToken(input: { workspaceId: string; tokenId: string; userId: string }) {
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    const result = await client.query<{ id: string }>(
      `update platform_api_tokens
       set revoked_at = coalesce(revoked_at, now())
       where id = $1 and workspace_id = $2
       returning id`,
      [input.tokenId, input.workspaceId],
    );
    if (!result.rows[0]) {
      await client.query("rollback");
      return false;
    }
    await client.query(
      `insert into audit_log (workspace_id, user_id, action, entity_type, entity_id)
       values ($1, $2, 'platform_api_token.revoked', 'platform_api_token', $3)`,
      [input.workspaceId, input.userId, input.tokenId],
    );
    await client.query("commit");
    return true;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function authenticatePlatformApiToken(request: Request, requiredScope: PlatformApiScope) {
  const plaintext = readBearerToken(request);
  if (!plaintext) return null;
  const result = await getDatabasePool().query<PlatformTokenRow>(
    `update platform_api_tokens
     set last_used_at = now()
     where token_hash = $1
       and revoked_at is null
       and expires_at > now()
       and $2 = any(scopes)
     returning id, workspace_id, user_id, name, token_prefix, scopes, expires_at, last_used_at, revoked_at, created_at`,
    [hashPlatformToken(plaintext), requiredScope],
  );
  const row = result.rows[0];
  return row ? {
    tokenId: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    scopes: row.scopes,
  } : null;
}

function readBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer (vgy_live_[A-Za-z0-9_-]{40,60})$/);
  return match?.[1] ?? null;
}

function hashPlatformToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeTokenName(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 80) throw new Error("API token name must be 1 to 80 characters.");
  return normalized;
}

function mapToken(row: PlatformTokenRow): PlatformApiTokenSummary {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    scopes: row.scopes,
    expiresAt: row.expires_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}
