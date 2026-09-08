import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { billChangeKind, isZohoBooksPageCursor, providerId, zohoBooksScopes, zohoBooksSorts, type ZohoBill, type ZohoBillChange, type ZohoBooksState, type ZohoBooksDetail, type ZohoBooksView, type ZohoBooksRegisterQuery, type ZohoObservation, type ZohoConnectionStatus, type ZohoOrganization } from "@/lib/zoho-books/contracts";
import { assertProviderBillErasureAcknowledgement, controlProviderBillRetentionNotice, type ZohoBooksAdmissionStateDto } from "@/lib/commitment-control/provider-bill-contracts";
import { normalizeBillDisposition, type BillDisposition } from "@/lib/zoho-books/resolution";
import { indiaCalendarDate } from "@/lib/date-only";
import { getDatabasePool } from "@/lib/server/database";
import { RecoveryServiceError } from "@/lib/server/recovery-api";
import { decryptSecret, encryptSecret, type EncryptedSecret } from "@/lib/server/token-vault";
import { ZohoBooksError, type ZohoBooksClient, type ZohoTokens } from "@/lib/server/zoho-books-client";
import { deliverServerError, type MonitoringDeliveryResult } from "@/lib/server/monitoring";

const dayMs = 86_400_000;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const iso = (value: Date | string | null) => value === null ? null : new Date(value).toISOString();
const resumableFailures = new Set(["PROVIDER_UNAVAILABLE", "THROTTLED"]);

type Incident = {
  id: string; connection_id: string; workspace_id: string; generation: string; failure_code: string;
  assigned_operator_user_id: string | null; delivery_status: "PENDING" | "DELIVERED" | "FAILED" | "UNCONFIGURED";
  delivery_attempts: number; created_at: Date; delivered_at: Date | null; resumed_at: Date | null;
  resumed_by_user_id: string | null; recovered_at: Date | null;
};
type IncidentNotice = { id: string; workspaceId: string; connectionId: string; failureCode: string; assignedOperatorUserId: string };
type DispositionRow = { id: string; event_sequence: string; source_sequence: string; version: string; bill_id: string; actor_user_id: string; kind: BillDisposition["kind"]; note: string; follow_up_on: string | null; responsible_user_id: string | null; created_at: Date | string; request_hash: string };
type ObservationRow = { sequence: string; bill: ZohoBill; previous: ZohoBill | null; previous_change_kind: ZohoBillChange | null; change_kind: ZohoBillChange; observed_at: Date; disposition: DispositionRow | null; open_follow_ups?: string; follow_up_on?: string | null; responsible_user_id?: string | null; review_relevance: NonNullable<ZohoObservation["reviewRelevance"]>; pending_review_count: string; pending_review_sequence: string | null; pending_review_since: Date | null; last_resolved_review: DispositionRow | null };
const dispositionColumns = "id,event_sequence::text,source_sequence::text,version::text,bill_id,actor_user_id,kind,note,follow_up_on::text,responsible_user_id,created_at,request_hash";

export function reviewProjection(sourceBound = "null", eventBound = "null") {
  const unchangedIdentity = ["vendorId", "vendorName", "billNumber", "date", "currency", "totalMinor"]
    .map(field => `snapshot.bill->>'${field}'=snapshot.previous->>'${field}'`).join(" and ");
  return `with ordered_observations as (
    select source.*,lag(bill) over bill_history as previous,lag(change_kind) over bill_history as previous_change_kind
    from zoho_books_snapshots source where connection_id=$1 and (${sourceBound}::bigint is null or sequence<=${sourceBound}::bigint)
    window bill_history as (partition by bill_id order by sequence)
  ), classified_observations as (
    select snapshot.*,to_jsonb(disposition) as disposition,
      case when snapshot.change_kind='BASELINE' then 'BASELINE'
        when snapshot.change_kind='AMENDED' and snapshot.previous_change_kind<>'REMOVED' and ${unchangedIdentity}
          and (snapshot.previous->>'balanceMinor')::numeric>0
          and (snapshot.previous->>'balanceMinor')::numeric<=(snapshot.previous->>'totalMinor')::numeric
          and ((snapshot.previous->>'status'='open' and snapshot.bill->>'status'='overdue' and snapshot.bill->>'balanceMinor'=snapshot.previous->>'balanceMinor')
            or (snapshot.previous->>'status' in ('open','overdue','partially_paid')
              and (snapshot.bill->>'balanceMinor')::numeric<(snapshot.previous->>'balanceMinor')::numeric
              and ((snapshot.bill->>'status'='paid' and snapshot.bill->>'balanceMinor'='0')
                or (snapshot.bill->>'status'='partially_paid' and (snapshot.bill->>'balanceMinor')::numeric>0))))
          then 'INFORMATIONAL' else 'MATERIAL' end as review_relevance
    from ordered_observations snapshot
    left join lateral (select ${dispositionColumns} from zoho_books_dispositions where connection_id=snapshot.connection_id and source_sequence=snapshot.sequence
      and (${eventBound}::bigint is null or event_sequence<=${eventBound}::bigint) order by zoho_books_dispositions.version desc limit 1) disposition on true
  ), review_summary as (
    select bill_id,
      count(*) filter (where review_relevance='MATERIAL' and disposition is null)::text as pending_review_count,
      max(sequence) filter (where review_relevance='MATERIAL' and disposition is null)::text as pending_review_sequence,
      min(observed_at) filter (where review_relevance='MATERIAL' and disposition is null) as pending_review_since,
      count(*) filter (where disposition->>'kind'='FOLLOW_UP')::text as open_follow_ups,
      min(disposition->>'follow_up_on') filter (where disposition->>'kind'='FOLLOW_UP') as follow_up_on,
      (array_agg(disposition->>'responsible_user_id' order by disposition->>'follow_up_on',sequence) filter (where disposition->>'kind'='FOLLOW_UP'))[1] as responsible_user_id,
      (array_agg(disposition order by (disposition->>'event_sequence')::bigint desc) filter (where disposition->>'kind'='RESOLVED'))[1] as last_resolved_review
    from classified_observations group by bill_id
  ), bill_register as (
    select distinct on (snapshot.bill_id) snapshot.*,summary.pending_review_count,summary.pending_review_sequence,summary.pending_review_since,
      summary.open_follow_ups,summary.follow_up_on,summary.responsible_user_id,summary.last_resolved_review
    from classified_observations snapshot join review_summary summary on summary.bill_id=snapshot.bill_id order by snapshot.bill_id,snapshot.sequence desc
  )`;
}

function dispositionDto(row: DispositionRow): BillDisposition {
  return { id: row.id, eventSequence: row.event_sequence, sourceSequence: row.source_sequence, version: row.version,
    billId: row.bill_id, actorUserId: row.actor_user_id, kind: row.kind, note: row.note, followUpOn: row.follow_up_on,
    responsibleUserId: row.responsible_user_id, createdAt: iso(row.created_at)!, basis: "HUMAN_REVIEW_NOT_PAYMENT" };
}

function observationDto(row: ObservationRow): ZohoObservation {
  return { sequence: row.sequence, bill: row.bill, previous: row.previous, previousChangeKind: row.previous_change_kind, changeKind: row.change_kind, observedAt: row.observed_at.toISOString(),
    disposition: row.disposition ? dispositionDto(row.disposition) : null,
    reviewRelevance: row.review_relevance, pendingReviewCount: Number(row.pending_review_count), pendingReviewSequence: row.pending_review_sequence,
    pendingReviewSince: iso(row.pending_review_since), lastResolvedReview: row.last_resolved_review ? dispositionDto(row.last_resolved_review) : null,
    openFollowUpCount: Number(row.open_follow_ups ?? 0), followUpOn: row.follow_up_on ?? null, responsibleUserId: row.responsible_user_id ?? null };
}

type Connection = {
  id: string; workspace_id: string; authorized_by_user_id: string; revision: string; generation: string;
  active_grant_id: string | null;
  status: ZohoConnectionStatus; oauth_state_hash: string | null; oauth_expires_at: Date | null;
  access_secret: EncryptedSecret | null; refresh_secret: EncryptedSecret | null; access_expires_at: Date | null;
  organizations: ZohoOrganization[]; organization_id: string | null; organization_name: string | null;
  coverage_start: string; scan_id: string | null; scan_page: number; scan_phase: "FETCH" | "VERIFY";
  scan_kind: "INITIAL" | "FULL" | "INCREMENTAL"; scan_started_at: Date | null; scan_since: Date | null;
  watermark_at: Date | null;
  last_success_at: Date | null; last_full_at: Date | null; next_run_at: Date | null; failure_count: number;
  last_error_code: string | null; lease_token: string | null; reviewed_through: string;
  provider_revocation: "CONFIRMED" | "UNCONFIRMED" | null;
};

function requireRevision(connection: Connection | undefined, revision: string): asserts connection is Connection {
  if (!connection) throw new RecoveryServiceError("NOT_FOUND");
  if (connection.revision !== revision) throw new RecoveryServiceError("STALE_STATE", "The source connection changed. Reload before continuing.", { currentVersion: Number(connection.revision) });
}

function secretContext(connection: Connection, kind: "access" | "refresh") {
  return `zoho-books:${connection.workspace_id}:${connection.id}:${kind}`;
}

export function createZohoBooksService(input: {
  client: ZohoBooksClient | null; pool?: Pool; workspaceIds?: readonly string[];
  isWorkspaceEnabled?: (workspaceId: string) => boolean;
  operatorUserId?: string;
  deliverIncident?: (incident: IncidentNotice) => Promise<MonitoringDeliveryResult>;
}) {
  const pool = input.pool ?? getDatabasePool();
  const provider = () => {
    if (!input.client) throw new RecoveryServiceError("FEATURE_UNAVAILABLE", "Zoho Books has not been configured for this environment.");
    return input.client;
  };

  async function transaction<Result>(operation: (client: PoolClient) => Promise<Result>): Promise<Result> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const result = await operation(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async function member<Result>(workspaceId: string, userId: string, write: boolean, operation: (client: PoolClient, role: string) => Promise<Result>) {
    return transaction(async client => {
      if (!write) await client.query("set transaction isolation level repeatable read read only");
      if (write) await client.query("select pg_advisory_xact_lock(hashtextextended($1, 70))", [workspaceId]);
      const membership = await client.query<{ role: string }>("select role from workspace_members where workspace_id=$1 and user_id=$2", [workspaceId, userId]);
      const role = membership.rows[0]?.role;
      if (!role || (write && role !== "owner" && role !== "admin")) throw new RecoveryServiceError("FORBIDDEN");
      return operation(client, role);
    });
  }

  async function connectionFor(client: PoolClient, workspaceId: string, lock = false) {
    return (await client.query<Connection>(`select *,coverage_start::text as coverage_start from zoho_books_connections where workspace_id=$1${lock ? " for update" : ""}`, [workspaceId])).rows[0];
  }

  async function peopleFor(client: PoolClient, workspaceId: string, userIds: Array<string | null | undefined>) {
    const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
    if (!ids.length) return [];
    return (await client.query<{ userId: string; displayName: string }>('select users.id as "userId",left(trim(users.display_name),240) as "displayName" from users join workspace_members member on member.user_id=users.id where member.workspace_id=$1 and users.id=any($2::uuid[]) and nullif(trim(users.display_name),\'\') is not null and users.deleted_at is null order by users.id', [workspaceId, ids])).rows;
  }

  async function audit(client: PoolClient, workspaceId: string, userId: string, connectionId: string, action: string, metadata: Record<string, unknown> = {}) {
    await client.query("insert into audit_log (workspace_id,user_id,action,entity_type,entity_id,metadata) values ($1,$2,$3,'zoho_books_connection',$4,$5)", [workspaceId, userId, action, connectionId, metadata]);
  }

  async function storeTokens(client: PoolClient, connection: Connection, tokens: ZohoTokens, now: Date) {
    const access = encryptSecret(tokens.accessToken, secretContext(connection, "access"));
    const refresh = tokens.refreshToken ? encryptSecret(tokens.refreshToken, secretContext(connection, "refresh")) : connection.refresh_secret;
    if (!refresh) throw new ZohoBooksError("REAUTH_REQUIRED");
    const expiry = new Date(now.getTime() + tokens.expiresIn * 1_000);
    await client.query("update zoho_books_connections set access_secret=$2, refresh_secret=$3, access_expires_at=$4 where id=$1", [connection.id, access, refresh, expiry]);
    connection.access_secret = access;
    connection.refresh_secret = refresh;
    connection.access_expires_at = expiry;
    return tokens.accessToken;
  }

  async function readProvider<Result>(client: PoolClient, connection: Connection, now: Date, operation: (access: string) => Promise<Result>) {
    if (!connection.refresh_secret) throw new ZohoBooksError("REAUTH_REQUIRED");
    const refresh = () => provider().refresh(decryptSecret(connection.refresh_secret!, secretContext(connection, "refresh")));
    let refreshed = false;
    let access: string;
    if (!connection.access_secret || !connection.access_expires_at || connection.access_expires_at.getTime() <= now.getTime() + 60_000) {
      access = await storeTokens(client, connection, await refresh(), now);
      refreshed = true;
    } else access = decryptSecret(connection.access_secret, secretContext(connection, "access"));
    try {
      return await operation(access);
    } catch (error) {
      if (refreshed || !(error instanceof ZohoBooksError) || error.code !== "REAUTH_REQUIRED") throw error;
      access = await storeTokens(client, connection, await refresh(), now);
      return operation(access);
    }
  }

  async function recordBill(client: PoolClient, connection: Connection, bill: ZohoBill, now: Date, removed = false) {
    const existing = (await client.query<{ bill: ZohoBill; grant_id: string | null; latest_sequence: string; provider_modified_at: Date; deleted: boolean }>(
      "select snapshot.bill, snapshot.grant_id, record.latest_sequence, record.provider_modified_at, record.deleted from zoho_books_records record join zoho_books_snapshots snapshot on snapshot.sequence=record.latest_sequence where record.connection_id=$1 and record.bill_id=$2 for update of record",
      [connection.id, bill.billId],
    )).rows[0];
    if (existing && !removed && Date.parse(bill.modifiedAt) < existing.provider_modified_at.getTime()) {
      await client.query("update zoho_books_records set last_seen_scan_id=$3 where connection_id=$1 and bill_id=$2", [connection.id, bill.billId, connection.scan_id]);
      return;
    }
    const changeKind = removed ? "REMOVED" : existing?.deleted ? "AMENDED" : billChangeKind(existing?.bill ?? null, bill);
    const newGrantCapture = connection.active_grant_id !== null && existing?.grant_id !== connection.active_grant_id;
    let sequence = existing?.latest_sequence;
    if ((changeKind !== null || newGrantCapture) && !(removed && existing?.deleted)) {
      const kind = !connection.last_success_at && !existing && !removed ? "BASELINE" : changeKind ?? "BASELINE";
      const fingerprint = digest(JSON.stringify({ bill, removed, previousSequence: existing?.latest_sequence ?? null, grantId: connection.active_grant_id }));
      const inserted = await client.query<{ sequence: string }>(
        "insert into zoho_books_snapshots (connection_id,workspace_id,bill_id,fingerprint,bill,change_kind,observed_at,grant_id,organization_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (connection_id,bill_id,fingerprint) do nothing returning sequence",
        [connection.id, connection.workspace_id, bill.billId, fingerprint, bill, kind, now, connection.active_grant_id, connection.active_grant_id ? connection.organization_id : null],
      );
      sequence = inserted.rows[0]?.sequence ?? (await client.query<{ sequence: string }>("select sequence from zoho_books_snapshots where connection_id=$1 and bill_id=$2 and fingerprint=$3", [connection.id, bill.billId, fingerprint])).rows[0]?.sequence;
    }
    if (!sequence) throw new Error("Provider observation did not produce a durable source reference.");
    await client.query(
      "insert into zoho_books_records (connection_id,workspace_id,bill_id,latest_sequence,provider_modified_at,last_seen_scan_id,deleted) values ($1,$2,$3,$4,$5,$6,$7) on conflict (connection_id,bill_id) do update set latest_sequence=excluded.latest_sequence, provider_modified_at=excluded.provider_modified_at, last_seen_scan_id=excluded.last_seen_scan_id, deleted=excluded.deleted",
      [connection.id, connection.workspace_id, bill.billId, sequence, bill.modifiedAt, connection.scan_id, removed],
    );
  }

  async function finishScan(client: PoolClient, connection: Connection, now: Date) {
    await client.query(
      "update zoho_books_connections set status='READY', last_success_at=$2, watermark_at=scan_started_at, last_full_at=case when scan_kind in ('INITIAL','FULL') then $2 else last_full_at end, next_run_at=$3, scan_started_at=null, scan_page=1, scan_phase='FETCH', scan_kind='INCREMENTAL', lease_token=null, lease_until=null, failure_count=0, last_error_code=null, updated_at=$2 where id=$1",
      [connection.id, now, new Date(now.getTime() + dayMs)],
    );
    await client.query("update zoho_books_incidents set recovered_at=$2 where connection_id=$1 and resumed_at is not null and recovered_at is null", [connection.id, now]);
  }

  async function openIncident(client: PoolClient, connection: Connection, code: string, now: Date) {
    const operator = input.operatorUserId && /^[0-9a-f-]{36}$/i.test(input.operatorUserId)
      ? (await client.query("select user_id from workspace_members where workspace_id=$1 and user_id=$2 and role in ('owner','admin')", [connection.workspace_id, input.operatorUserId])).rows[0]?.user_id ?? null : null;
    const incidentId = randomUUID();
    const inserted = await client.query("insert into zoho_books_incidents (id,connection_id,workspace_id,generation,failure_code,assigned_operator_user_id,next_delivery_at,created_at) values ($1,$2,$3,$4,$5,$6,$7,$7) on conflict (connection_id,generation) where resumed_at is null do nothing returning id", [incidentId, connection.id, connection.workspace_id, connection.generation, code, operator, now]);
    if (inserted.rowCount) await audit(client, connection.workspace_id, connection.authorized_by_user_id, connection.id, "zoho-books.recovery.escalated", { incidentId, failureCode: code, operatorUserId: operator });
  }

  async function deliverIncidents(now: Date) {
    return transaction(async client => {
      const incidents = await client.query<Incident>("select incident.* from zoho_books_incidents incident join zoho_books_connections connection on connection.id=incident.connection_id and connection.generation=incident.generation where connection.status in ('FAILED','REAUTH_REQUIRED') and incident.resumed_at is null and incident.delivery_status <> 'DELIVERED' and incident.delivery_attempts < 5 and incident.next_delivery_at <= $1 and ($2::uuid[] is null or incident.workspace_id=any($2)) order by incident.created_at for update of incident skip locked limit 3", [now, input.workspaceIds ?? null]);
      for (const incident of incidents.rows) {
        const notice = incident.assigned_operator_user_id ? { id: incident.id, workspaceId: incident.workspace_id, connectionId: incident.connection_id, failureCode: incident.failure_code, assignedOperatorUserId: incident.assigned_operator_user_id } : null;
        let result: MonitoringDeliveryResult = { status: "not-configured", backend: "not-configured" };
        if (notice) {
          try {
            result = input.deliverIncident ? await input.deliverIncident(notice) : await deliverServerError(
              new Error("Zoho Books source requires operator recovery."),
              { path: "/api/internal/zoho-books/due/run", method: "POST", headers: {} },
              { boundary: "zoho-books-incident", incidentId: notice.id, workspaceId: notice.workspaceId, connectionId: notice.connectionId, reason: notice.failureCode, assignedOperatorUserId: notice.assignedOperatorUserId },
              notice.id.replaceAll("-", ""),
            );
          } catch {
            result = { status: "failed", backend: "not-configured" };
          }
        }
        const delivered = result.status === "delivered" && typeof result.eventId === "string" && result.eventId.length > 0;
        await client.query("update zoho_books_incidents set delivery_status=$2,delivery_attempts=delivery_attempts+1,delivery_receipt=$3,delivered_at=$4,next_delivery_at=$5 where id=$1", [incident.id, delivered ? "DELIVERED" : result.status === "not-configured" ? "UNCONFIGURED" : "FAILED", delivered ? `${result.backend}:${result.eventId}` : null, delivered ? now : null, new Date(now.getTime() + 60_000 * 2 ** incident.delivery_attempts)]);
      }
      return incidents.rowCount ?? 0;
    });
  }

  async function workStep(id: string, lease: string, now: Date): Promise<boolean> {
    return transaction(async client => {
      const connection = (await client.query<Connection>("select *,coverage_start::text as coverage_start from zoho_books_connections where id=$1 and lease_token=$2 and status='SYNCING' for update", [id, lease])).rows[0];
      if (!connection || !connection.organization_id) return false;
      const authorizer = await client.query<{ role: string }>("select role from workspace_members where workspace_id=$1 and user_id=$2 for share", [connection.workspace_id, connection.authorized_by_user_id]);
      const enabled = input.isWorkspaceEnabled?.(connection.workspace_id) !== false;
      if (!enabled || !["owner", "admin"].includes(authorizer.rows[0]?.role ?? "")) {
        await client.query("update zoho_books_connections set status='REAUTH_REQUIRED', last_error_code=$2, next_run_at=null, lease_token=null, lease_until=null, generation=generation+1 where id=$1", [id, enabled ? "AUTHORITY_CHANGED" : "SOURCE_DISABLED"]);
        return false;
      }
      if (connection.scan_phase === "FETCH") {
        const page = await readProvider(client, connection, now, access => provider().listBills(access, connection.organization_id!, {
          page: connection.scan_page, coverageStart: connection.coverage_start, modifiedSince: iso(connection.scan_since),
        }));
        for (const bill of page.bills) await recordBill(client, connection, bill, now);
        if (page.hasMore) {
          await client.query("update zoho_books_connections set scan_page=scan_page+1, updated_at=$2 where id=$1", [id, now]);
          return true;
        }
        if (connection.scan_kind === "INCREMENTAL" || connection.scan_kind === "INITIAL") {
          await finishScan(client, connection, now);
          return false;
        }
        await client.query("update zoho_books_connections set scan_phase='VERIFY' where id=$1", [id]);
      }
      const missing = (await client.query<{ bill: ZohoBill }>(
        "select snapshot.bill from zoho_books_records record join zoho_books_snapshots snapshot on snapshot.sequence=record.latest_sequence where record.connection_id=$1 and record.last_seen_scan_id is distinct from $2 and not record.deleted order by record.bill_id limit 1",
        [id, connection.scan_id],
      )).rows[0];
      if (!missing) {
        await finishScan(client, connection, now);
        return false;
      }
      const observed = await readProvider(client, connection, now, access => provider().bill(access, connection.organization_id!, missing.bill.billId));
      await recordBill(client, connection, observed ?? missing.bill, now, observed === null);
      return true;
    });
  }

  return {
    async begin(workspaceId: string, userId: string, now = new Date()) {
      const state = randomBytes(32).toString("base64url");
      const authorizationUrl = provider().authorizationUrl(state);
      await member(workspaceId, userId, true, async client => {
        await client.query(
          "insert into zoho_books_connections (id,workspace_id,authorized_by_user_id,status,oauth_state_hash,oauth_expires_at,coverage_start) values ($1,$2,$3,'AUTHORIZING',$4,$5,$6) on conflict (workspace_id) do update set authorized_by_user_id=excluded.authorized_by_user_id, status='AUTHORIZING', active_grant_id=null, oauth_state_hash=excluded.oauth_state_hash, oauth_expires_at=excluded.oauth_expires_at, generation=zoho_books_connections.generation+1, revision=zoho_books_connections.revision+1, lease_token=null, lease_until=null, next_run_at=null, organizations='[]'::jsonb, last_error_code=null, updated_at=$7",
          [randomUUID(), workspaceId, userId, digest(state), new Date(now.getTime() + 600_000), new Date(now.getTime() - 90 * dayMs).toISOString().slice(0, 10), now],
        );
        const connection = await connectionFor(client, workspaceId);
        await audit(client, workspaceId, userId, connection!.id, "zoho-books.consent.started", { noticeVersion: "zoho-books-read-v1", scopes: zohoBooksScopes, region: "IN", at: now.toISOString() });
      });
      return { authorizationUrl };
    },

    async complete(workspaceId: string, userId: string, state: string, code: string, now = new Date()) {
      const original = await member(workspaceId, userId, true, async client => {
        const connection = await connectionFor(client, workspaceId, true);
        if (!connection || connection.status !== "AUTHORIZING" || connection.authorized_by_user_id !== userId
          || connection.oauth_state_hash !== digest(state) || !connection.oauth_expires_at || connection.oauth_expires_at <= now) {
          throw new RecoveryServiceError("FORBIDDEN", "The source authorization expired or was already used.");
        }
        await client.query("update zoho_books_connections set oauth_state_hash=null, oauth_expires_at=null where id=$1", [connection.id]);
        return connection;
      });
      let tokens: ZohoTokens | undefined;
      try {
        tokens = await provider().exchangeCode(code);
        if (!tokens.refreshToken) throw new ZohoBooksError("REAUTH_REQUIRED");
        const organizations = await provider().organizations(tokens.accessToken);
        await member(workspaceId, userId, true, async client => {
          const connection = await connectionFor(client, workspaceId, true);
          if (!connection || connection.generation !== original.generation || connection.status !== "AUTHORIZING") throw new RecoveryServiceError("FORBIDDEN");
          await storeTokens(client, connection, tokens!, now);
          const grantId = randomUUID();
          await client.query("insert into zoho_books_grants(id,workspace_id,connection_id,consent_generation,authorized_by_user_id,authorized_at,notice_version,scopes,region,authorized_organization_ids) values ($1,$2,$3,$4,$5,$6,'zoho-books-read-v1',$7,'IN',$8)", [grantId, workspaceId, connection.id, connection.generation, userId, now, [...zohoBooksScopes], organizations.filter(organization => organization.active).map(organization => organization.id)]);
          await client.query("update zoho_books_connections set status='AWAITING_ORGANIZATION', organizations=$2, revision=revision+1, updated_at=$3, active_grant_id=$4 where id=$1", [connection.id, JSON.stringify(organizations), now, grantId]);
          await audit(client, workspaceId, userId, connection.id, "zoho-books.consent.authorized", { noticeVersion: "zoho-books-read-v1", scopes: zohoBooksScopes, at: now.toISOString() });
        });
      } catch (error) {
        await pool.query("update zoho_books_connections set status='REAUTH_REQUIRED', last_error_code=$3 where id=$1 and generation=$2 and status='AUTHORIZING'", [original.id, original.generation, error instanceof ZohoBooksError ? error.code : "AUTHORIZATION_FAILED"]);
        if (tokens?.refreshToken) await provider().revoke(tokens.refreshToken).catch(() => undefined);
        throw error;
      }
    },

    async select(workspaceId: string, userId: string, organizationId: string, revision: string, now = new Date()) {
      providerId(organizationId, "organization_id");
      await member(workspaceId, userId, true, async client => {
        const connection = await connectionFor(client, workspaceId, true);
        requireRevision(connection, revision);
        const organization = connection.organizations.find(item => item.id === organizationId && item.active);
        if (connection.status !== "AWAITING_ORGANIZATION" || !organization) throw new RecoveryServiceError("FORBIDDEN", "Choose an active organization from the authorized account.");
        if (connection.organization_id && connection.organization_id !== organizationId) throw new RecoveryServiceError("FORBIDDEN", "A different organization requires disconnecting and deleting this source first, or a separate workspace.");
        await client.query(
          "update zoho_books_connections set organization_id=$2, organization_name=$3, organization_currency=$4, status='QUEUED', revision=revision+1, generation=generation+1, next_run_at=$5, scan_page=1, scan_started_at=null, scan_since=null, scan_phase='FETCH', scan_kind=case when last_success_at is null then 'INITIAL' else 'FULL' end, provider_revocation=null, last_error_code=null, failure_count=0, organizations='[]'::jsonb, updated_at=$5 where id=$1",
          [connection.id, organization.id, organization.name, organization.currency, now],
        );
        await audit(client, workspaceId, userId, connection.id, "zoho-books.organization.selected", { organizationId: organization.id, coverageStart: connection.coverage_start, at: now.toISOString() });
      });
    },

    async read(workspaceId: string, userId: string, options: { cursor?: string; changesOnly?: boolean; view?: ZohoBooksView } & ZohoBooksRegisterQuery = {}): Promise<ZohoBooksAdmissionStateDto> {
      if (options.cursor && !isZohoBooksPageCursor(options.cursor)) throw new RecoveryServiceError("INVALID_EVIDENCE", "The source page cursor is invalid.");
      const register = options.sort !== undefined || options.search !== undefined || options.currency !== undefined || options.cursor?.startsWith("r1.");
      const sort = options.sort ?? "UPDATED";
      const search = options.search?.trim() ?? "";
      const currency = options.currency || null;
      if (!(zohoBooksSorts as readonly string[]).includes(sort) || search.length > 160 || (currency && !Intl.supportedValuesOf("currency").includes(currency))) throw new RecoveryServiceError("INVALID_EVIDENCE", "Choose a supported register search, sort and currency.");
      return member(workspaceId, userId, false, async (client, role) => {
        const connection = await connectionFor(client, workspaceId);
        const retainedAdmissionCount = Number((await client.query("select count(*)::text as count from recovery_provider_bill_links where workspace_id=$1 and ($2::uuid is null or connection_id=$2)", [workspaceId, connection?.id ?? null])).rows[0].count);
        const base = { configured: Boolean(input.client) && input.isWorkspaceEnabled?.(workspaceId) !== false, canManage: role === "owner" || role === "admin", organizations: connection?.organizations ?? [], retainedAdmissionCount, retentionNotice: controlProviderBillRetentionNotice };
        if (!connection) return { ...base, connection: null, items: [], total: 0, nextCursor: null, throughSequence: "0", overview: { billCount: 0, changedBillCount: 0, needsReviewCount: 0, followUpCount: 0, closedCount: 0, oldestPendingObservedAt: null, earliestFollowUpOn: null } };
        const filter = (options.changesOnly ? " and snapshot.change_kind <> 'BASELINE' and not exists (select 1 from zoho_books_reviews review where review.connection_id=snapshot.connection_id and review.sequence=snapshot.sequence)" : "")
          + (options.view === "ATTENTION" ? " and (snapshot.pending_review_count::bigint>0 or snapshot.open_follow_ups::bigint>0)" : options.view === "FOLLOW_UP" ? " and snapshot.open_follow_ups::bigint>0" : options.view === "RESOLVED" ? " and snapshot.last_resolved_review is not null and snapshot.pending_review_count::bigint=0 and snapshot.open_follow_ups::bigint=0" : "");
        const fingerprint = digest(JSON.stringify([connection.id, options.view ?? "ALL", Boolean(options.changesOnly), sort, search, currency]));
        const cursor = options.cursor?.startsWith("r1.") ? options.cursor.split(".") : null;
        if (register && options.cursor && (!cursor || cursor[4] !== fingerprint)) throw new RecoveryServiceError("INVALID_EVIDENCE", "The register changed. Start again from the first page.");
        const bounds = register ? (await client.query<{ source: string; event: string }>("select coalesce((select max(sequence) from zoho_books_snapshots where connection_id=$1),0)::text as source,coalesce((select max(event_sequence) from zoho_books_dispositions where connection_id=$1),0)::text as event", [connection.id])).rows[0] : null;
        const through = cursor?.[1] ?? bounds?.source ?? "0";
        const eventThrough = cursor?.[2] ?? bounds?.event ?? "0";
        const after = cursor?.[3] ?? options.cursor ?? null;
        const anchor = register && after ? (await client.query<{ bill: ZohoBill }>("select bill from zoho_books_snapshots where connection_id=$1 and sequence=$2 and sequence<=$3", [connection.id, after, through])).rows[0] : null;
        if (register && after && !anchor) throw new RecoveryServiceError("INVALID_EVIDENCE", "The register page is no longer available. Reload the list.");
        const projection = reviewProjection(register ? "$4" : "null", register ? "$5" : "null");
        const from = `from bill_register snapshot where ${register ? "($2::text='' or snapshot.bill->>'vendorName' ilike $2 or snapshot.bill->>'billNumber' ilike $2) and ($3::text is null or snapshot.bill->>'currency'=$3)" : "true"}${filter}`;
        const amountDirection = sort === "AMOUNT_ASC" ? "asc" : "desc";
        const amountComparison = sort === "AMOUNT_ASC" ? ">" : "<";
        const order = sort === "SUPPLIER" ? `lower(snapshot.bill->>'vendorName') collate "C" asc,snapshot.sequence asc`
          : sort === "DATE" ? "snapshot.bill->>'date' desc,snapshot.sequence desc"
          : sort.startsWith("AMOUNT_") ? `snapshot.bill->>'currency' collate "C" asc,(snapshot.bill->>'totalMinor')::numeric ${amountDirection},snapshot.sequence ${amountDirection}` : "snapshot.sequence desc";
        const seek = sort === "SUPPLIER" ? `(lower(snapshot.bill->>'vendorName') collate "C",snapshot.sequence)>($7::text collate "C",$6::bigint)`
          : sort === "DATE" ? "(snapshot.bill->>'date',snapshot.sequence)<($7::text,$6::bigint)"
          : sort.startsWith("AMOUNT_") ? `(snapshot.bill->>'currency' collate "C">$8::text collate "C" or (snapshot.bill->>'currency'=$8 and ((snapshot.bill->>'totalMinor')::numeric,snapshot.sequence)${amountComparison}($7::numeric,$6::bigint)))` : "snapshot.sequence<$6::bigint";
        const values: unknown[] = register ? [connection.id, search ? `%${search.replace(/[\\%_]/g, "\\$&")}%` : "", currency, through, eventThrough] : [connection.id];
        const pageValues = [...values, after];
        if (register && sort !== "UPDATED") pageValues.push(sort === "SUPPLIER" ? anchor?.bill.vendorName.toLowerCase() ?? "" : sort === "DATE" ? anchor?.bill.date ?? "" : anchor?.bill.totalMinor ?? "0");
        if (register && sort.startsWith("AMOUNT_")) pageValues.push(anchor?.bill.currency ?? "");
        const page = await client.query<ObservationRow>(
          `${projection} select snapshot.* ${from} and (${register ? `$6::bigint is null or ${seek}` : "$2::bigint is null or snapshot.sequence < $2::bigint"}) order by ${register ? order : "snapshot.sequence desc"} limit 51`,
          pageValues,
        );
        const count = await client.query<{ count: string }>(`${projection} select count(*) ${from}`, values);
        const registerCurrencies = register ? (await client.query<{ currency: string }>("select distinct bill->>'currency' as currency from zoho_books_snapshots where connection_id=$1 and sequence<=$2 order by currency", [connection.id, through])).rows.map(row => row.currency) : [];
        const rows = page.rows.slice(0, 50);
        const overview = (await client.query<Omit<NonNullable<ZohoBooksState["overview"]>, "oldestPendingObservedAt"> & { oldestPendingObservedAt: Date | null }>(`${reviewProjection(register ? "$2" : "null", register ? "$3" : "null")}
          select count(*)::integer as "billCount",count(*) filter (where change_kind<>'BASELINE')::integer as "changedBillCount",
            count(*) filter (where pending_review_count::bigint>0 or open_follow_ups::bigint>0)::integer as "needsReviewCount",
            count(*) filter (where open_follow_ups::bigint>0)::integer as "followUpCount",
            count(*) filter (where last_resolved_review is not null and pending_review_count::bigint=0 and open_follow_ups::bigint=0)::integer as "closedCount",
            min(pending_review_since) as "oldestPendingObservedAt",min(follow_up_on) as "earliestFollowUpOn" from bill_register`, register ? [connection.id, through, eventThrough] : [connection.id])).rows[0];
        const incident = (await client.query<Incident>("select * from zoho_books_incidents where connection_id=$1 order by created_at desc,id desc limit 1", [connection.id])).rows[0];
        return {
          ...base,
          overview: { ...overview, oldestPendingObservedAt: iso(overview.oldestPendingObservedAt) },
          viewerUserId: userId,
          people: await peopleFor(client, workspaceId, rows.flatMap(row => [row.disposition?.actor_user_id, row.responsible_user_id, row.last_resolved_review?.actor_user_id])),
          connection: {
            id: connection.id, revision: connection.revision, status: connection.status,
            organizationId: connection.organization_id, organizationName: connection.organization_name,
            coverageStart: connection.coverage_start, lastSuccessfulSyncAt: iso(connection.last_success_at),
            nextScheduledAt: iso(connection.next_run_at), failureCode: connection.last_error_code,
            providerRevocation: connection.provider_revocation,
            incident: incident ? {
              id: incident.id, failureCode: incident.failure_code, assignedOperatorUserId: incident.assigned_operator_user_id,
              deliveryStatus: incident.delivery_status, createdAt: incident.created_at.toISOString(),
              deliveredAt: iso(incident.delivered_at), resumedAt: iso(incident.resumed_at), recoveredAt: iso(incident.recovered_at),
              canEscalate: ["FAILED", "REAUTH_REQUIRED"].includes(connection.status) && incident.generation === connection.generation
                && !incident.resumed_at && incident.delivery_status !== "DELIVERED" && input.operatorUserId === userId && (role === "owner" || role === "admin"),
              canResume: connection.status === "FAILED" && resumableFailures.has(connection.last_error_code ?? "")
                && !incident.resumed_at && incident.assigned_operator_user_id === userId && input.operatorUserId === userId
                && incident.delivery_status === "DELIVERED" && (role === "owner" || role === "admin"),
            } : null,
          },
          items: rows.map(observationDto),
          total: Number(count.rows[0].count), nextCursor: page.rows.length > 50 ? register ? `r1.${through}.${eventThrough}.${rows.at(-1)!.sequence}.${fingerprint}` : rows.at(-1)!.sequence : null,
          throughSequence: register ? through : rows[0]?.sequence ?? "0",
          ...(register ? { register: { search, sort, currency, currencies: registerCurrencies } } : {}),
        };
      });
    },

    async detail(workspaceId: string, userId: string, billId: string, options: { cursor?: string; eventCursor?: string; followUpCursor?: string; sequence?: string } = {}): Promise<ZohoBooksDetail> {
      if (!/^\d{1,64}$/.test(billId) || Object.values(options).some(cursor => cursor !== undefined && !/^[1-9]\d{0,18}$/.test(cursor))) throw new RecoveryServiceError("INVALID_EVIDENCE");
      return member(workspaceId, userId, false, async (client, role) => {
        const connection = await connectionFor(client, workspaceId);
        if (!connection?.organization_id) throw new RecoveryServiceError("NOT_FOUND");
        const select = `${reviewProjection()} select snapshot.*,summary.pending_review_count,summary.pending_review_sequence,summary.pending_review_since,summary.open_follow_ups,summary.follow_up_on,summary.responsible_user_id,summary.last_resolved_review from classified_observations snapshot join review_summary summary on summary.bill_id=snapshot.bill_id`;
        const current = (await client.query<ObservationRow>(`${select} join zoho_books_records record on record.latest_sequence=snapshot.sequence where record.connection_id=$1 and record.bill_id=$2`, [connection.id, billId])).rows[0];
        if (!current) throw new RecoveryServiceError("NOT_FOUND");
        const selected = options.sequence ? (await client.query<ObservationRow>(`${select} where snapshot.connection_id=$1 and snapshot.bill_id=$2 and snapshot.sequence=$3`, [connection.id, billId, options.sequence])).rows[0] : current;
        if (!selected) throw new RecoveryServiceError("NOT_FOUND");
        const history = await client.query<ObservationRow>(`${select} where snapshot.connection_id=$1 and snapshot.bill_id=$2 and ($3::bigint is null or snapshot.sequence<$3::bigint) order by snapshot.sequence desc limit 51`, [connection.id, billId, options.cursor ?? null]);
        const events = await client.query<DispositionRow>(`select ${dispositionColumns} from zoho_books_dispositions where connection_id=$1 and bill_id=$2 and ($3::bigint is null or event_sequence<$3::bigint) order by event_sequence::bigint desc limit 51`, [connection.id, billId, options.eventCursor ?? null]);
        const followUps = await client.query<DispositionRow>(`select * from (select distinct on (source_sequence) ${dispositionColumns} from zoho_books_dispositions where connection_id=$1 and bill_id=$2 order by source_sequence,version::bigint desc) latest where kind='FOLLOW_UP' and ($3::bigint is null or source_sequence::bigint<$3::bigint) order by source_sequence::bigint desc limit 51`, [connection.id, billId, options.followUpCursor ?? null]);
        return { connectionId: connection.id, connectionRevision: connection.revision, organizationId: connection.organization_id, organizationName: connection.organization_name ?? connection.organization_id,
          viewerUserId: userId, people: await peopleFor(client, workspaceId, [current.disposition?.actor_user_id, selected.disposition?.actor_user_id, current.last_resolved_review?.actor_user_id, ...history.rows.slice(0, 50).map(row => row.disposition?.actor_user_id), ...events.rows.slice(0, 50).map(row => row.actor_user_id), ...followUps.rows.slice(0, 50).map(row => row.actor_user_id)]),
          canManage: role === "owner" || role === "admin", current: observationDto(current), selected: observationDto(selected), observations: history.rows.slice(0, 50).map(observationDto),
          events: events.rows.slice(0, 50).map(dispositionDto), openFollowUps: followUps.rows.slice(0, 50).map(dispositionDto),
          nextCursor: history.rows.length > 50 ? history.rows[49].sequence : null,
          nextEventCursor: events.rows.length > 50 ? events.rows[49].event_sequence : null,
          nextFollowUpCursor: followUps.rows.length > 50 ? followUps.rows[49].source_sequence : null };
      });
    },

    async disposition(workspaceId: string, userId: string, value: unknown, now = new Date()): Promise<BillDisposition> {
      let request;
      try { request = normalizeBillDisposition(value); } catch { throw new RecoveryServiceError("INVALID_EVIDENCE", "The bill disposition needs an exact revision and a human explanation."); }
      const requestHash = digest(JSON.stringify({ userId, ...request }));
      return member(workspaceId, userId, true, async client => {
        const connection = await connectionFor(client, workspaceId, true);
        if (!connection) throw new RecoveryServiceError("NOT_FOUND");
        const replay = (await client.query<DispositionRow>(`select ${dispositionColumns} from zoho_books_dispositions where workspace_id=$1 and request_key=$2`, [workspaceId, request.idempotencyKey])).rows[0];
        if (replay) {
          if (replay.request_hash !== requestHash) throw new RecoveryServiceError("CONFLICT");
          return dispositionDto(replay);
        }
        const record = (await client.query<{ latest_sequence: string }>("select latest_sequence from zoho_books_records where connection_id=$1 and bill_id=$2", [connection.id, request.billId])).rows[0];
        if (!record) throw new RecoveryServiceError("NOT_FOUND");
        if (record.latest_sequence !== request.expectedLatestSequence) throw new RecoveryServiceError("STALE_STATE", "A newer source observation is available. Inspect it before recording another disposition.");
        const snapshot = await client.query("select sequence from zoho_books_snapshots where connection_id=$1 and workspace_id=$2 and bill_id=$3 and sequence=$4", [connection.id, workspaceId, request.billId, request.sourceSequence]);
        if (!snapshot.rowCount) throw new RecoveryServiceError("NOT_FOUND");
        const version = (await client.query<{ version: string }>("select coalesce(max(version),0)::text as version from zoho_books_dispositions where connection_id=$1 and source_sequence=$2", [connection.id, request.sourceSequence])).rows[0].version;
        if (version !== request.expectedVersion) throw new RecoveryServiceError("STALE_STATE", "Another person recorded a disposition. Reload its history before continuing.");
        if (request.followUpOn && request.followUpOn < indiaCalendarDate(now)) throw new RecoveryServiceError("INVALID_EVIDENCE", "Choose today or a later date for a new follow-up.");
        const inserted = await client.query<DispositionRow>(`insert into zoho_books_dispositions (id,connection_id,workspace_id,bill_id,source_sequence,version,actor_user_id,kind,note,follow_up_on,responsible_user_id,request_key,request_hash,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning ${dispositionColumns}`, [randomUUID(), connection.id, workspaceId, request.billId, request.sourceSequence, (BigInt(version) + BigInt(1)).toString(), userId, request.kind, request.note, request.followUpOn, request.kind === "FOLLOW_UP" ? userId : null, request.idempotencyKey, requestHash, now]);
        const result = dispositionDto(inserted.rows[0]);
        await audit(client, workspaceId, userId, connection.id, "zoho-books.bill.disposition", { dispositionId: result.id, billId: request.billId, sourceSequence: request.sourceSequence, kind: request.kind, version: result.version });
        return result;
      });
    },

    async review(workspaceId: string, userId: string, sequences: readonly string[], revision: string) {
      if (!Array.isArray(sequences) || sequences.length < 1 || sequences.length > 50
        || sequences.some(sequence => typeof sequence !== "string" || !/^[1-9]\d{0,18}$/.test(sequence) || BigInt(sequence) > BigInt("9223372036854775807"))
        || new Set(sequences).size !== sequences.length) throw new RecoveryServiceError("INVALID_EVIDENCE", "Acknowledge between one and fifty distinct displayed observations.");
      await member(workspaceId, userId, true, async client => {
        const connection = await connectionFor(client, workspaceId, true);
        requireRevision(connection, revision);
        const visible = await client.query("select sequence from zoho_books_snapshots where connection_id=$1 and workspace_id=$2 and sequence=any($3::bigint[])", [connection.id, workspaceId, sequences]);
        if (visible.rowCount !== sequences.length) throw new RecoveryServiceError("NOT_FOUND");
        await client.query("insert into zoho_books_reviews (connection_id,workspace_id,bill_id,sequence,reviewed_by_user_id) select connection_id,workspace_id,bill_id,sequence,$4 from zoho_books_snapshots where connection_id=$1 and workspace_id=$2 and sequence=any($3::bigint[]) on conflict do nothing", [connection.id, workspaceId, sequences, userId]);
        await client.query("update zoho_books_connections set revision=revision+1 where id=$1", [connection.id]);
        await audit(client, workspaceId, userId, connection.id, "zoho-books.observations.reviewed", { sequences, scope: "WORKSPACE" });
      });
    },

    async escalate(workspaceId: string, userId: string, incidentId: string, revision: string, now = new Date()) {
      await member(workspaceId, userId, true, async client => {
        const connection = await connectionFor(client, workspaceId, true);
        requireRevision(connection, revision);
        const incident = (await client.query<Incident>("select * from zoho_books_incidents where id=$1 and connection_id=$2 and workspace_id=$3 for update", [incidentId, connection.id, workspaceId])).rows[0];
        if (!incident || input.operatorUserId !== userId || incident.generation !== connection.generation || incident.resumed_at
          || incident.delivery_status === "DELIVERED" || !["FAILED", "REAUTH_REQUIRED"].includes(connection.status)) throw new RecoveryServiceError("FORBIDDEN");
        await client.query("update zoho_books_incidents set assigned_operator_user_id=$2,delivery_attempts=0,delivery_status='PENDING',next_delivery_at=$3 where id=$1", [incident.id, userId, now]);
        await client.query("update zoho_books_connections set revision=revision+1 where id=$1", [connection.id]);
        await audit(client, workspaceId, userId, connection.id, "zoho-books.recovery.operator-assigned", { incidentId, previousOperatorUserId: incident.assigned_operator_user_id });
      });
      await deliverIncidents(now);
    },

    async resume(workspaceId: string, userId: string, incidentId: string, revision: string, now = new Date()) {
      await member(workspaceId, userId, true, async client => {
        const connection = await connectionFor(client, workspaceId, true);
        requireRevision(connection, revision);
        const incident = (await client.query<Incident>("select * from zoho_books_incidents where id=$1 and connection_id=$2 and workspace_id=$3 for update", [incidentId, connection.id, workspaceId])).rows[0];
        if (!incident || incident.generation !== connection.generation || incident.assigned_operator_user_id !== userId || input.operatorUserId !== userId
          || incident.delivery_status !== "DELIVERED" || incident.resumed_at || connection.status !== "FAILED"
          || !resumableFailures.has(connection.last_error_code ?? "") || !connection.refresh_secret
          || input.isWorkspaceEnabled?.(workspaceId) === false) throw new RecoveryServiceError("FORBIDDEN", "Only the assigned operator may resume a delivered transient-failure incident with valid consent.");
        const authorizer = await client.query("select role from workspace_members where workspace_id=$1 and user_id=$2 for share", [workspaceId, connection.authorized_by_user_id]);
        if (!["owner", "admin"].includes(authorizer.rows[0]?.role ?? "")) throw new RecoveryServiceError("FORBIDDEN");
        await client.query("update zoho_books_connections set status='QUEUED',revision=revision+1,generation=generation+1,failure_count=0,next_run_at=$2,lease_token=null,lease_until=null,updated_at=$2 where id=$1", [connection.id, now]);
        await client.query("update zoho_books_incidents set resumed_by_user_id=$2,resumed_at=$3 where id=$1", [incident.id, userId, now]);
        await audit(client, workspaceId, userId, connection.id, "zoho-books.recovery.resumed", { incidentId, failureCode: incident.failure_code, at: now.toISOString() });
      });
    },

    async disconnect(workspaceId: string, userId: string, revision: string) {
      const previous = await member(workspaceId, userId, true, async client => {
        const connection = await connectionFor(client, workspaceId, true);
        requireRevision(connection, revision);
        await client.query("update zoho_books_connections set status='REVOKED', revision=revision+1, generation=generation+1, active_grant_id=null, access_secret=null, refresh_secret=null, access_expires_at=null, oauth_state_hash=null, oauth_expires_at=null, organizations='[]'::jsonb, next_run_at=null, lease_token=null, lease_until=null, provider_revocation='UNCONFIRMED', updated_at=now() where id=$1", [connection.id]);
        await audit(client, workspaceId, userId, connection.id, "zoho-books.disconnected");
        return connection;
      });
      let confirmed = !previous.refresh_secret;
      if (previous.refresh_secret && input.client) {
        try {
          await input.client.revoke(decryptSecret(previous.refresh_secret, secretContext(previous, "refresh")));
          confirmed = true;
        } catch {
          confirmed = false;
        }
      }
      await pool.query("update zoho_books_connections set provider_revocation=$2 where id=$1 and status='REVOKED' and generation=$3::bigint+1", [previous.id, confirmed ? "CONFIRMED" : "UNCONFIRMED", previous.generation]);
      return { providerRevocation: confirmed ? "CONFIRMED" as const : "UNCONFIRMED" as const };
    },

    async erase(workspaceId: string, userId: string, revision: string, retentionAcknowledgement?: unknown) {
      await member(workspaceId, userId, true, async client => {
        const connection = await connectionFor(client, workspaceId, true);
        requireRevision(connection, revision);
        if (connection.status !== "REVOKED") throw new RecoveryServiceError("FORBIDDEN", "Disconnect this source before deleting its observations.");
        await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`recovery:${workspaceId}`]);
        const retainedAdmissionCount = Number((await client.query("select count(*)::text as count from recovery_provider_bill_links where workspace_id=$1 and connection_id=$2", [workspaceId, connection.id])).rows[0].count);
        try { assertProviderBillErasureAcknowledgement(retentionAcknowledgement, retainedAdmissionCount); }
        catch (error) { throw new RecoveryServiceError("INVALID_EVIDENCE", error instanceof Error ? error.message : "Acknowledge retained admissions before source erasure."); }
        await client.query("delete from zoho_books_connections where id=$1", [connection.id]);
        await audit(client, workspaceId, userId, connection.id, "zoho-books.observations.erased", { retainedAdmissionCount, retentionNotice: retainedAdmissionCount ? controlProviderBillRetentionNotice : null });
      });
    },

    async runDue(now = new Date(), options: { maxSteps?: number; limit?: number; workspaceId?: string } = {}) {
      provider();
      const maxSteps = Math.max(1, Math.min(2, options.maxSteps ?? 2));
      const limit = Math.max(1, Math.min(3, options.limit ?? 3));
      let processed = 0;
      const failures: Array<{ connectionId: string; code: string }> = [];
      const startedAt = Date.now();
      for (let index = 0; index < limit && Date.now() - startedAt < 15_000; index += 1) {
        const lease = randomUUID();
        const claimed = await transaction(async client => {
          const connection = (await client.query<Connection>(
            "select *,coverage_start::text as coverage_start from zoho_books_connections where organization_id is not null and ($2::uuid is null or workspace_id=$2) and ($3::uuid[] is null or workspace_id=any($3)) and ((status in ('QUEUED','READY','RETRY_WAIT') and next_run_at <= $1) or (status='SYNCING' and lease_until <= $1)) order by next_run_at,id for update skip locked limit 1", [now, options.workspaceId ?? null, input.workspaceIds ?? null],
          )).rows[0];
          if (!connection) return null;
          const fresh = !connection.scan_started_at;
          const full = !connection.watermark_at || !connection.last_full_at || now.getTime() - connection.last_full_at.getTime() >= 7 * dayMs || connection.scan_kind === "FULL";
          const kind = !connection.last_success_at ? "INITIAL" : full ? "FULL" : "INCREMENTAL";
          await client.query(
            "update zoho_books_connections set status='SYNCING', lease_token=$2, lease_until=$3, scan_id=case when $4 then $5::uuid else scan_id end, scan_started_at=case when $4 then $6 else scan_started_at end, scan_kind=case when $4 then $7 else scan_kind end, scan_since=case when $4 then $8 else scan_since end where id=$1",
            [connection.id, lease, new Date(now.getTime() + 120_000), fresh, randomUUID(), now, kind, kind === "INCREMENTAL" && connection.watermark_at ? new Date(connection.watermark_at.getTime() - dayMs) : null],
          );
          return connection;
        });
        if (!claimed) break;
        processed += 1;
        try {
          let more = true;
          for (let step = 0; step < maxSteps && more; step += 1) more = await workStep(claimed.id, lease, now);
          if (more) await pool.query("update zoho_books_connections set status='QUEUED', next_run_at=$3, lease_token=null, lease_until=null where id=$1 and lease_token=$2", [claimed.id, lease, new Date(now.getTime() + 60_000)]);
        } catch (error) {
          const code = error instanceof ZohoBooksError ? error.code : "INTERNAL_FAILURE";
          const attempts = claimed.failure_count + 1;
          const terminal = ["SCHEMA_CHANGED", "REGION_UNSUPPORTED", "ABSENCE_UNCONFIRMED", "INTERNAL_FAILURE"].includes(code) || attempts >= 5;
          const status = code === "REAUTH_REQUIRED" ? "REAUTH_REQUIRED" : terminal ? "FAILED" : "RETRY_WAIT";
          const retrySeconds = Math.max(error instanceof ZohoBooksError ? error.retryAfterSeconds : 60, Math.min(3_600, 60 * 2 ** Math.min(attempts, 6)));
          await transaction(async client => {
            const updated = await client.query("update zoho_books_connections set status=$3, failure_count=failure_count+1, last_error_code=$4, next_run_at=$5, lease_token=null, lease_until=null, revision=revision+case when $3='RETRY_WAIT' then 0 else 1 end where id=$1 and lease_token=$2 returning id", [claimed.id, lease, status, code, status === "RETRY_WAIT" ? new Date(now.getTime() + retrySeconds * 1_000) : null]);
            if (updated.rowCount && status !== "RETRY_WAIT") await openIncident(client, claimed, code, now);
          });
          failures.push({ connectionId: claimed.id, code });
        }
      }
      await deliverIncidents(now);
      return { processed, failures };
    },
  };
}
