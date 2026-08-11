import "server-only";

import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { ReceiptInboxStatusDto } from "@/lib/recovery/contracts";
import { currentPrivacyNoticeVersion } from "@/lib/privacy-notice";
import { recordConsentGrant } from "@/lib/server/consent-store";
import { upsertConnectedAccount } from "@/lib/server/connector-token-store";
import { getDatabasePool, isDatabaseConfigured } from "@/lib/server/database";
import { checkFeatureReadiness } from "@/lib/server/feature-readiness";
import { checkGoogleAuthConfiguration } from "@/lib/server/google-auth";
import { RecoveryServiceError } from "@/lib/server/recovery-api";
import { checkTokenVaultConfiguration, decryptSecret, encryptSecret, type EncryptedSecret } from "@/lib/server/token-vault";

const connectorId = "receipt-inbox";
const consentPurpose = "receipt-inbox-ingest" as const;
const aliasPrefix = "rcpt_";
const roleRank = { viewer: 1, member: 2, admin: 3, owner: 4 } as const;

type ReceiptInboxConfiguration = {
  receivingDomain: string;
  receivingApiKey: string;
  webhookSecret: string;
  hmacSecret: Buffer;
  hmacKeyId: string;
};

type ActiveAliasRow = {
  id: string;
  workspace_id: string;
  connected_account_id: string;
  encrypted_display: EncryptedSecret;
  status: "ACTIVE";
  created_at: Date;
  rotated_at: null;
  revoked_at: null;
};

type MembershipRow = {
  email: string;
  role: keyof typeof roleRank;
};

export function getReceiptInboxConfiguration():
  | { status: "ready"; configuration: ReceiptInboxConfiguration }
  | { status: "not-configured" | "invalid"; missing: string[]; message: string } {
  const missing = [
    process.env.ENABLE_RECEIPT_INBOX === "true" ? null : "ENABLE_RECEIPT_INBOX=true",
    process.env.RESEND_RECEIVING_API_KEY?.trim() ? null : "RESEND_RECEIVING_API_KEY",
    process.env.RESEND_INBOUND_WEBHOOK_SECRET?.trim() ? null : "RESEND_INBOUND_WEBHOOK_SECRET",
    process.env.RESEND_RECEIVING_DOMAIN?.trim() ? null : "RESEND_RECEIVING_DOMAIN",
    process.env.RECEIPT_INBOX_ALIAS_HMAC_SECRET?.trim() ? null : "RECEIPT_INBOX_ALIAS_HMAC_SECRET",
    process.env.RECEIPT_INBOX_ALIAS_HMAC_KEY_ID?.trim() ? null : "RECEIPT_INBOX_ALIAS_HMAC_KEY_ID",
    checkTokenVaultConfiguration().status === "ready" ? null : "TOKEN_ENCRYPTION_KEY",
  ].filter((value): value is string => Boolean(value));
  if (missing.length) {
    return { status: "not-configured", missing, message: "Receipt inbox is not configured for this deployment." };
  }

  try {
    const receivingDomain = normalizeReceivingDomain(process.env.RESEND_RECEIVING_DOMAIN!);
    const receivingApiKey = process.env.RESEND_RECEIVING_API_KEY!.trim();
    const webhookSecret = process.env.RESEND_INBOUND_WEBHOOK_SECRET!.trim();
    const hmacSecret = parseHmacSecret(process.env.RECEIPT_INBOX_ALIAS_HMAC_SECRET!);
    const hmacKeyId = normalizeKeyId(process.env.RECEIPT_INBOX_ALIAS_HMAC_KEY_ID!);
    return { status: "ready", configuration: { receivingDomain, receivingApiKey, webhookSecret, hmacSecret, hmacKeyId } };
  } catch (error) {
    return {
      status: "invalid",
      missing: [],
      message: error instanceof Error ? error.message : "Receipt inbox configuration is invalid.",
    };
  }
}

export function getReceiptInboxLaunchReadiness(): {
  status: "ready" | "activation-pending";
  missing: string[];
} {
  const configuration = getReceiptInboxConfiguration();
  const identity = checkGoogleAuthConfiguration();
  const requiredValues = {
    RECEIPT_INBOX_PROVIDER_STATUS: "production-live",
    RECEIPT_INBOX_WEBHOOK_PROOF_STATUS: "passed",
    RECEIPT_INBOX_REPLAY_PROOF_STATUS: "passed",
    RECEIPT_INBOX_RETENTION_REVIEW_STATUS: "approved",
  } as const;
  const missing = [
    ...(configuration.status === "ready"
      ? []
      : configuration.status === "invalid"
        ? [configuration.message]
        : configuration.missing),
      ...(identity.status === "ready" ? [] : identity.missing),
    isDatabaseConfigured() ? null : "DATABASE_URL",
    ...Object.entries(requiredValues).map(([name, expected]) => (
      process.env[name]?.trim() === expected ? null : `${name}=${expected}`
    )),
  ].filter((value): value is string => Boolean(value));
  return missing.length
    ? { status: "activation-pending" as const, missing: [...new Set(missing)] }
    : { status: "ready" as const, missing: [] };
}

export async function isReceiptInboxPubliclyAvailable(input: {
  hasRequiredMigrations?: () => Promise<boolean>;
  hasCleanRecoveryCutover?: () => Promise<boolean>;
} = {}) {
  if (getReceiptInboxLaunchReadiness().status !== "ready") return false;
  const hasRequiredMigrations = input.hasRequiredMigrations ?? queryRequiredReceiptInboxMigrations;
  const hasCleanRecoveryCutover = input.hasCleanRecoveryCutover ?? queryCleanRecoveryCutover;
  try {
    const [migrationsReady, cutoverReady] = await boundedReadinessProbe(
      Promise.all([hasRequiredMigrations(), hasCleanRecoveryCutover()]),
      3_000,
    );
    return migrationsReady && cutoverReady;
  } catch {
    return false;
  }
}

async function queryCleanRecoveryCutover() {
  const readiness = await checkFeatureReadiness();
  return readiness.recoveryV1.status === "schema-ready-clean-cutover";
}

async function queryRequiredReceiptInboxMigrations() {
  const required = [
    "0024_recovery_inbound_receipts",
    "0025_recovery_renewal_alerts",
    "0026_recovery_inbound_retention",
  ];
  const result = await getDatabasePool().query<{ applied: number }>(
    `select count(*)::int as applied
     from schema_migrations
     where id = any($1::text[])`,
    [required],
  );
  return result.rows[0]?.applied === required.length;
}

function boundedReadinessProbe<T>(operation: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Receipt-inbox migration probe timed out.")), timeoutMs);
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function provisionReceiptInbox(input: { workspaceId: string; actorUserId: string }): Promise<ReceiptInboxStatusDto> {
  const configuration = requireReceiptInboxConfiguration();
  return mutateReceiptInbox(input, async (client, actor) => {
    const existing = await readActiveAlias(client, input.workspaceId);
    if (existing) return statusFromActiveAlias(existing);

    const consent = await recordConsentGrant({
      workspaceId: input.workspaceId,
      userId: input.actorUserId,
      subjectEmail: actor.email,
      resourceKey: "receipt-inbox",
      purpose: consentPurpose,
      noticeVersion: currentPrivacyNoticeVersion,
      source: "receipt-inbox-provision",
      scopes: ["receive-explicitly-forwarded-billing-email"],
    }, client);
    const account = await upsertConnectedAccount({
      workspaceId: input.workspaceId,
      consentGrantId: consent.id,
      connectorId,
      authType: "manual",
      displayName: "Receipt inbox",
      scopes: ["forwarded-billing-email"],
      metadata: { provider: "resend", ledgerAuthority: "RECOVERY_V1" },
      status: "active",
    }, client);
    const alias = await insertAlias(client, {
      workspaceId: input.workspaceId,
      connectedAccountId: account.id,
      actorUserId: input.actorUserId,
      configuration,
    });
    await writeAudit(client, input.workspaceId, input.actorUserId, "recovery.receipt-inbox.provisioned", alias.id);
    return statusFromActiveAlias(alias);
  });
}

export async function rotateReceiptInbox(input: {
  workspaceId: string;
  actorUserId: string;
  expectedAliasId: string;
  idempotencyKey: string;
}): Promise<ReceiptInboxStatusDto> {
  const configuration = requireReceiptInboxConfiguration();
  return mutateReceiptInbox(input, async (client) => {
    const operation = "recovery.rotate-receipt-inbox";
    const requestHash = createHash("sha256").update(`${operation}\0${input.expectedAliasId}`).digest("hex");
    const replay = await client.query<{
      operation: string;
      request_hash: string;
      response_payload: { aliasId?: unknown };
    }>(
      `select operation, request_hash, response_payload
       from recovery_idempotency_keys
       where workspace_id = $1 and idempotency_key = $2
       for update`,
      [input.workspaceId, input.idempotencyKey],
    );
    const replayRow = replay.rows[0];
    if (replayRow) {
      if (replayRow.operation !== operation || replayRow.request_hash !== requestHash) {
        throw new RecoveryServiceError("CONFLICT", "Idempotency-Key is already bound to another receipt-address request.");
      }
      const aliasId = typeof replayRow.response_payload.aliasId === "string" ? replayRow.response_payload.aliasId : "";
      const alias = await readAliasById(client, input.workspaceId, aliasId);
      if (!alias) throw new RecoveryServiceError("CONFLICT", "The replayed receipt address is no longer active.");
      return statusFromActiveAlias(alias);
    }

    const active = await readActiveAlias(client, input.workspaceId);
    if (!active) throw new Error("Receipt inbox must be provisioned before it can be rotated.");
    if (active.id !== input.expectedAliasId) {
      throw new RecoveryServiceError("STALE_STATE", "The receipt address changed before this rotation was applied.");
    }
    const nextAliasId = randomUUID();
    await client.query(
      `update recovery_inbound_aliases
       set status = 'ROTATED', encrypted_display = null, encryption_key_fingerprint = null,
           rotated_at = now()
       where workspace_id = $1 and id = $2 and status = 'ACTIVE'`,
      [input.workspaceId, active.id],
    );
    const next = await insertAlias(client, {
      aliasId: nextAliasId,
      workspaceId: input.workspaceId,
      connectedAccountId: active.connected_account_id,
      actorUserId: input.actorUserId,
      configuration,
    });
    await client.query(
      `update recovery_inbound_aliases
       set replaced_by_id = $3
       where workspace_id = $1 and id = $2 and status = 'ROTATED'`,
      [input.workspaceId, active.id, next.id],
    );
    await client.query(
      `insert into recovery_idempotency_keys (
         workspace_id, idempotency_key, operation, request_hash,
         response_payload, workspace_version
       ) values (
         $1, $2, $3, $4, jsonb_build_object('aliasId', $5::text),
         coalesce((select version from recovery_workspace_states where workspace_id = $1), 0)
       )`,
      [input.workspaceId, input.idempotencyKey, operation, requestHash, next.id],
    );
    await writeAudit(client, input.workspaceId, input.actorUserId, "recovery.receipt-inbox.rotated", next.id);
    return statusFromActiveAlias(next);
  });
}

export async function revokeReceiptInbox(input: { workspaceId: string; actorUserId: string }): Promise<ReceiptInboxStatusDto> {
  return mutateReceiptInbox(input, async (client) => {
    const active = await readActiveAlias(client, input.workspaceId);
    if (!active) return readReceiptInboxStatusWithClient(client, input.workspaceId);

    await client.query(
      `update recovery_inbound_aliases
       set status = 'REVOKED', encrypted_display = null, encryption_key_fingerprint = null,
           revoked_at = now()
       where workspace_id = $1 and id = $2 and status = 'ACTIVE'`,
      [input.workspaceId, active.id],
    );
    await client.query(
      `update connected_accounts
       set status = 'revoked', updated_at = now()
       where workspace_id = $1 and id = $2`,
      [input.workspaceId, active.connected_account_id],
    );
    await client.query(
      `update consent_grants
       set withdrawn_at = coalesce(withdrawn_at, now())
       where workspace_id = $1
         and id = (select consent_grant_id from connected_accounts where id = $2)
         and withdrawn_at is null`,
      [input.workspaceId, active.connected_account_id],
    );
    await writeAudit(client, input.workspaceId, input.actorUserId, "recovery.receipt-inbox.revoked", active.id);
    return { state: "REVOKED", alias: null, lastReceivedAt: null, lastProcessedAt: null, lastFailureCode: null };
  });
}

export async function getReceiptInboxStatus(input: { workspaceId: string; actorUserId: string }): Promise<ReceiptInboxStatusDto> {
  requireReceiptInboxConfiguration();
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin isolation level repeatable read read only");
    await assertAdminRole(client, input.actorUserId, input.workspaceId, false);
    const status = await readReceiptInboxStatusWithClient(client, input.workspaceId);
    await client.query("commit");
    return status;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function resolveReceiptInboxAlias(address: string): Promise<{ workspaceId: string; aliasId: string } | null> {
  const configuration = requireReceiptInboxConfiguration();
  let canonical: string;
  try {
    canonical = normalizeInboundAddress(address, configuration.receivingDomain);
  } catch {
    return null;
  }
  const aliasHmac = hmacAddress(canonical, configuration);
  const result = await getDatabasePool().query<{ workspace_id: string; id: string }>(
    `select workspace_id, id
     from recovery_inbound_aliases
     where hmac_key_id = $1 and alias_hmac = $2 and status = 'ACTIVE'
     limit 1`,
    [configuration.hmacKeyId, aliasHmac],
  );
  const row = result.rows[0];
  return row ? { workspaceId: row.workspace_id, aliasId: row.id } : null;
}

export async function getReceiptInboxWorkspaceVersion(workspaceId: string) {
  const result = await getDatabasePool().query<{ version: string }>(
    `select coalesce((
       select version from recovery_workspace_states where workspace_id = $1
     ), 0)::text as version`,
    [workspaceId],
  );
  return Number(result.rows[0]?.version ?? 0);
}

async function mutateReceiptInbox(
  input: { workspaceId: string; actorUserId: string },
  mutation: (client: PoolClient, actor: MembershipRow) => Promise<ReceiptInboxStatusDto>,
) {
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`receipt-inbox:${input.workspaceId}`]);
    const actor = await assertAdminRole(client, input.actorUserId, input.workspaceId, true);
    const result = await mutation(client, actor);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function assertAdminRole(client: PoolClient, actorUserId: string, workspaceId: string, lock: boolean) {
  const result = await client.query<MembershipRow>(
    `select actor.email, member.role
     from workspace_members member
     join users actor on actor.id = member.user_id and actor.deleted_at is null
     where member.workspace_id = $1 and member.user_id = $2
     ${lock ? "for share of member, actor" : ""}`,
    [workspaceId, actorUserId],
  );
  const row = result.rows[0];
  if (!row || roleRank[row.role] < roleRank.admin) throw new RecoveryServiceError("FORBIDDEN");
  return row;
}

async function insertAlias(client: PoolClient, input: {
  aliasId?: string;
  workspaceId: string;
  connectedAccountId: string;
  actorUserId: string;
  configuration: ReceiptInboxConfiguration;
}) {
  const id = input.aliasId ?? randomUUID();
  const address = `${aliasPrefix}${randomBytes(20).toString("hex")}@${input.configuration.receivingDomain}`;
  const encrypted = encryptSecret(address, aliasAssociatedData(input.workspaceId, id));
  const result = await client.query<ActiveAliasRow>(
    `insert into recovery_inbound_aliases (
       id, workspace_id, connected_account_id, receiving_domain, alias_hmac,
       hmac_key_id, encrypted_display, encryption_key_fingerprint,
       status, created_by_user_id
     ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, 'ACTIVE', $9)
     returning id, workspace_id, connected_account_id, encrypted_display,
               status, created_at, rotated_at, revoked_at`,
    [
      id,
      input.workspaceId,
      input.connectedAccountId,
      input.configuration.receivingDomain,
      hmacAddress(address, input.configuration),
      input.configuration.hmacKeyId,
      JSON.stringify(encrypted),
      encrypted.keyFingerprint,
      input.actorUserId,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Receipt inbox alias insert did not return a row.");
  return row;
}

async function readActiveAlias(client: PoolClient, workspaceId: string) {
  const result = await client.query<ActiveAliasRow>(
    `select id, workspace_id, connected_account_id, encrypted_display,
            status, created_at, rotated_at, revoked_at
     from recovery_inbound_aliases
     where workspace_id = $1 and status = 'ACTIVE'
     limit 1`,
    [workspaceId],
  );
  return result.rows[0] ?? null;
}

async function readAliasById(client: PoolClient, workspaceId: string, aliasId: string) {
  if (!aliasId) return null;
  const result = await client.query<ActiveAliasRow>(
    `select id, workspace_id, connected_account_id, encrypted_display,
            status, created_at, rotated_at, revoked_at
     from recovery_inbound_aliases
     where workspace_id = $1 and id = $2 and status = 'ACTIVE'
     limit 1`,
    [workspaceId, aliasId],
  );
  return result.rows[0] ?? null;
}

async function readReceiptInboxStatusWithClient(client: PoolClient, workspaceId: string): Promise<ReceiptInboxStatusDto> {
  const active = await readActiveAlias(client, workspaceId);
  const event = await client.query<{
    status: string;
    error_code: string | null;
    received_at: Date;
    processed_at: Date | null;
  }>(
    `select status, error_code, received_at, processed_at
     from recovery_inbound_events
     where workspace_id = $1
       and ($2::uuid is null or alias_id = $2)
     order by received_at desc, id desc
     limit 1`,
    [workspaceId, active?.id ?? null],
  );
  const latest = event.rows[0];
  if (active) {
    const state = !latest
      ? "WAITING"
      : latest.status === "RECEIVED"
        ? "RECEIVED"
        : latest.status === "PROCESSING"
          ? "PROCESSING"
          : latest.status === "PROCESSED"
            ? "READY"
            : "FAILED";
    return {
      state,
      alias: aliasDto(active),
      lastReceivedAt: latest?.received_at.toISOString() ?? null,
      lastProcessedAt: latest?.processed_at?.toISOString() ?? null,
      lastFailureCode: latest?.error_code ?? null,
    };
  }

  const revoked = await client.query<{ revoked: boolean }>(
    `select exists (
       select 1 from recovery_inbound_aliases
       where workspace_id = $1 and status = 'REVOKED'
     ) as revoked`,
    [workspaceId],
  );
  return {
    state: revoked.rows[0]?.revoked ? "REVOKED" : "NOT_PROVISIONED",
    alias: null,
    lastReceivedAt: latest?.received_at.toISOString() ?? null,
    lastProcessedAt: latest?.processed_at?.toISOString() ?? null,
    lastFailureCode: latest?.error_code ?? null,
  };
}

function statusFromActiveAlias(alias: ActiveAliasRow): ReceiptInboxStatusDto {
  return { state: "WAITING", alias: aliasDto(alias), lastReceivedAt: null, lastProcessedAt: null, lastFailureCode: null };
}

function aliasDto(alias: ActiveAliasRow) {
  return {
    id: alias.id,
    status: alias.status,
    address: decryptSecret(alias.encrypted_display, aliasAssociatedData(alias.workspace_id, alias.id)),
    createdAt: alias.created_at.toISOString(),
    rotatedAt: alias.rotated_at,
    revokedAt: alias.revoked_at,
  } as const;
}

function writeAudit(client: PoolClient, workspaceId: string, actorUserId: string, action: string, entityId: string) {
  return client.query(
    `insert into audit_log (workspace_id, user_id, action, entity_type, entity_id, metadata)
     values ($1, $2, $3, 'recovery_receipt_inbox', $4, '{"ledgerAuthority":"RECOVERY_V1"}'::jsonb)`,
    [workspaceId, actorUserId, action, entityId],
  );
}

function hmacAddress(address: string, configuration: ReceiptInboxConfiguration) {
  return createHmac("sha256", configuration.hmacSecret)
    .update(`v1\0${address}`)
    .digest("hex");
}

function aliasAssociatedData(workspaceId: string, aliasId: string) {
  return `recovery-receipt-inbox:${workspaceId}:${aliasId}`;
}

function normalizeInboundAddress(address: string, receivingDomain: string) {
  const normalized = address.trim().toLowerCase();
  if (!new RegExp(`^${aliasPrefix}[0-9a-f]{40}@${escapeRegExp(receivingDomain)}$`).test(normalized)) {
    throw new Error("Receipt inbox address is invalid.");
  }
  return normalized;
}

function normalizeReceivingDomain(value: string) {
  const normalized = value.trim().toLowerCase().replace(/^@/, "");
  if (!/^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(normalized)) {
    throw new Error("RESEND_RECEIVING_DOMAIN is invalid.");
  }
  return normalized;
}

function normalizeKeyId(value: string) {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(normalized)) throw new Error("RECEIPT_INBOX_ALIAS_HMAC_KEY_ID is invalid.");
  return normalized;
}

function parseHmacSecret(value: string) {
  const normalized = value.trim();
  const secret = /^[a-f0-9]{64}$/i.test(normalized)
    ? Buffer.from(normalized, "hex")
    : Buffer.from(normalized, "base64url");
  if (secret.length !== 32) throw new Error("RECEIPT_INBOX_ALIAS_HMAC_SECRET must decode to 32 bytes.");
  return secret;
}

function requireReceiptInboxConfiguration() {
  const result = getReceiptInboxConfiguration();
  if (result.status !== "ready") throw new Error(result.message);
  return result.configuration;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}