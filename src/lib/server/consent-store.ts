import "server-only";

import type { PoolClient } from "pg";
import { normalizeConsentGrant, type ConsentGrantInput } from "@/lib/consent";
import { getDatabasePool } from "@/lib/server/database";

export async function recordConsentGrant(input: ConsentGrantInput, client?: PoolClient) {
  const consent = normalizeConsentGrant(input);
  if (client) return recordConsentGrantWithClient(consent, client);

  const ownedClient = await getDatabasePool().connect();
  try {
    await ownedClient.query("begin");
    const recorded = await recordConsentGrantWithClient(consent, ownedClient);
    await ownedClient.query("commit");
    return recorded;
  } catch (error) {
    await ownedClient.query("rollback");
    throw error;
  } finally {
    ownedClient.release();
  }
}

async function recordConsentGrantWithClient(
  consent: ReturnType<typeof normalizeConsentGrant>,
  client: PoolClient,
) {
  if (consent.workspaceId && consent.userId) {
    await client.query(
      `update consent_grants
       set withdrawn_at = coalesce(withdrawn_at, now())
       where workspace_id = $1
         and user_id = $2
         and purpose = $3
        and resource_key is not distinct from $4
         and withdrawn_at is null`,
      [consent.workspaceId, consent.userId, consent.purpose, consent.resourceKey],
    );
  }

  const result = await client.query<{ id: string; granted_at: Date }>(
    `insert into consent_grants (
       workspace_id, user_id, subject_email, resource_key, purpose, notice_version, source, scopes, granted_at, expires_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
     returning id, granted_at`,
    [consent.workspaceId, consent.userId, consent.subjectEmail, consent.resourceKey, consent.purpose, consent.noticeVersion, consent.source,
      JSON.stringify(consent.scopes), consent.grantedAt, consent.expiresAt],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Consent insert did not return a record.");
  return { id: row.id, grantedAt: row.granted_at.toISOString() };
}

export async function listConsentGrants(input: { userId: string; email: string }) {
  const result = await getDatabasePool().query<{
    id: string;
    purpose: string;
    notice_version: string;
    source: string;
    scopes: unknown;
    granted_at: Date;
    withdrawn_at: Date | null;
    expires_at: Date | null;
  }>(
    `select id, purpose, notice_version, source, scopes, granted_at, withdrawn_at, expires_at
     from consent_grants
     where user_id = $1
        or lower(subject_email) = lower($2)
     order by granted_at desc
     limit 200`,
    [input.userId, input.email],
  );
  return result.rows.map((row) => ({
    id: row.id,
    purpose: row.purpose,
    noticeVersion: row.notice_version,
    source: row.source,
    scopes: row.scopes,
    grantedAt: row.granted_at.toISOString(),
    withdrawnAt: row.withdrawn_at?.toISOString() ?? null,
    expiresAt: row.expires_at?.toISOString() ?? null,
  }));
}

export async function withdrawConsentGrant(input: { id: string; userId: string; email: string; workspaceId?: string | null }) {
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    const owned = await client.query<{
      id: string;
      purpose: string;
      workspace_id: string | null;
      resource_key: string | null;
      withdrawn_at: Date | null;
    }>(
      `select id, purpose, workspace_id, resource_key, withdrawn_at
       from consent_grants
       where id = $1
         and (
           user_id = $2
           or lower(subject_email) = lower($3)
         )`,
      [input.id, input.userId, input.email],
    );
    if (!owned.rows[0]) {
      await client.query("rollback");
      return false;
    }
    const grant = owned.rows[0];
    if (grant.purpose === "standing-mandate-autopilot" && grant.withdrawn_at === null) {
      const workspaceId = grant.workspace_id ?? input.workspaceId ?? null;
      if (workspaceId) {
        const { revokeActiveStandingMandateForConsentWithdrawal } = await import("@/lib/server/recovery-autopilot-store");
        await revokeActiveStandingMandateForConsentWithdrawal(client, {
          workspaceId,
          actorUserId: input.userId,
          consentId: grant.id,
          resourceKey: grant.resource_key,
        });
      }
    }
    if (grant.purpose === "receipt-inbox-ingest" && grant.withdrawn_at === null) {
      const workspaceId = grant.workspace_id ?? input.workspaceId ?? null;
      if (workspaceId) {
        await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`receipt-inbox:${workspaceId}`]);
        const { applyReceiptInboxRevocation } = await import("@/lib/server/recovery-inbound-store");
        await applyReceiptInboxRevocation(client, {
          workspaceId,
          actorUserId: input.userId,
          consentId: grant.id,
        });
      }
    }
    const result = await client.query<{ id: string; purpose: string }>(
      `update consent_grants
       set withdrawn_at = coalesce(withdrawn_at, now())
       where id = $1
         and (
           user_id = $2
           or lower(subject_email) = lower($3)
         )
       returning id, purpose`,
      [input.id, input.userId, input.email],
    );
    if (!result.rows[0]) {
      await client.query("rollback");
      return false;
    }
    if (result.rows[0].purpose === "renewal-alerts") {
      await client.query(
        `update renewal_alert_preferences
         set enabled = false,
             disabled_at = coalesce(disabled_at, now()),
             updated_at = now()
         where consent_grant_id = $1
           and user_id = $2`,
        [input.id, input.userId],
      );
      await client.query(
        `update renewal_alert_deliveries
         set status = 'cancelled',
             next_attempt_at = null,
             locked_at = null,
             locked_by = null,
             updated_at = now()
         where consent_grant_id = $1
           and user_id = $2
           and status in ('scheduled', 'failed', 'sending')`,
        [input.id, input.userId],
      );
    }
    if (input.workspaceId) {
      await client.query(
        `insert into audit_log (workspace_id, user_id, action, entity_type, entity_id)
         values ($1, $2, 'consent.withdrawn', 'consent_grant', $3)`,
        [input.workspaceId, input.userId, input.id],
      );
    }
    await client.query("commit");
    return true;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function hasActiveConsentGrant(input: { userId: string; email: string; workspaceId: string; purpose: string }) {
  const result = await getDatabasePool().query<{ active: boolean }>(
    `select exists (
       select 1
       from consent_grants
       where purpose = $1
         and (user_id = $2 or lower(subject_email) = lower($3))
         and workspace_id = $4
         and resource_key is null
         and withdrawn_at is null
         and (expires_at is null or expires_at > now())
     ) as active`,
    [input.purpose, input.userId, input.email, input.workspaceId],
  );
  return Boolean(result.rows[0]?.active);
}
