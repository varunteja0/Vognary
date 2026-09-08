import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { isCommitmentControlWorkspaceEnrolled } from "@/lib/commitment-control/enrollment";
import {
  controlProviderBillSourceMaxAgeMs,
  type ControlProviderBillProvenanceDto,
  type ReconcileControlProviderBillRequest,
} from "@/lib/commitment-control/provider-bill-contracts";
import type { ZohoBill, ZohoBillChange } from "@/lib/zoho-books/contracts";
import { RecoveryServiceError } from "@/lib/server/recovery-api";
import { encryptSecret } from "@/lib/server/token-vault";
import { zohoBooksWorkspaceEnabled } from "@/lib/server/zoho-books-configuration";

export type ControlProviderBillSourceRow = {
  sequence: string; connection_id: string; workspace_id: string; organization_id: string | null;
  bill_id: string; fingerprint: string; observed_at: Date; bill: ZohoBill; change_kind: ZohoBillChange;
  grant_id: string | null; consent_generation: string | null; authorized_by_user_id: string | null;
  authorized_at: Date | null; scopes: string[] | null; notice_version: string | null; region: string | null;
  revision: string; active_grant_id: string | null; status: string; last_success_at: Date | null;
  next_run_at: Date | null; last_error_code: string | null; has_refresh: boolean;
  latest_sequence: string; deleted: boolean; authorizer_valid: boolean;
};

export function controlProviderBillWorkspaceEnabled(workspaceId: string) {
  const entries = (process.env.CONTROL_PROVIDER_BILL_WORKSPACE_IDS ?? "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
  const local = process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development";
  const allowed = local && entries.length === 1 && entries[0] === "*"
    || entries.length > 0 && entries.every(value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) && entries.includes(workspaceId.toLowerCase());
  return allowed && isCommitmentControlWorkspaceEnrolled(workspaceId) && zohoBooksWorkspaceEnabled(workspaceId);
}

export async function lockControlProviderBillSource(client: PoolClient, workspaceId: string, actorUserId: string) {
  const actor = await client.query("select id from users where id=$1 and deleted_at is null for share", [actorUserId]);
  if (actor.rowCount !== 1) throw new RecoveryServiceError("FORBIDDEN");
  const workspace = await client.query("select id from workspaces where id=$1 for key share", [workspaceId]);
  if (workspace.rowCount !== 1) throw new RecoveryServiceError("FORBIDDEN");
  await client.query("select pg_advisory_xact_lock(hashtextextended($1,70))", [workspaceId]);
  await client.query("select id from zoho_books_connections where workspace_id=$1 for update", [workspaceId]);
}

export async function loadControlProviderBillSource(client: PoolClient, workspaceId: string, request: Pick<ReconcileControlProviderBillRequest, "connectionId" | "organizationId" | "billId" | "sourceSequence">) {
  const result = await client.query<ControlProviderBillSourceRow>(`
    select snapshot.*, grant_record.consent_generation::text,grant_record.authorized_by_user_id,grant_record.authorized_at,
      grant_record.scopes,grant_record.notice_version,grant_record.region,
      connection.revision::text,connection.active_grant_id,connection.status,connection.last_success_at,
      connection.next_run_at,connection.last_error_code,connection.refresh_secret is not null as has_refresh,
      record.latest_sequence::text,record.deleted,
      exists(select 1 from workspace_members member join users authorizer on authorizer.id=member.user_id and authorizer.deleted_at is null
        where member.workspace_id=connection.workspace_id and member.user_id=grant_record.authorized_by_user_id and member.role in ('owner','admin')) as authorizer_valid
    from zoho_books_snapshots snapshot
    join zoho_books_connections connection on connection.id=snapshot.connection_id and connection.workspace_id=snapshot.workspace_id
    join zoho_books_records record on record.connection_id=snapshot.connection_id and record.workspace_id=snapshot.workspace_id and record.bill_id=snapshot.bill_id
    left join zoho_books_grants grant_record on grant_record.id=snapshot.grant_id and grant_record.connection_id=snapshot.connection_id and grant_record.workspace_id=snapshot.workspace_id
    where snapshot.workspace_id=$1 and snapshot.connection_id=$2 and connection.organization_id=$3
      and snapshot.bill_id=$4 and snapshot.sequence=$5`, [workspaceId, request.connectionId, request.organizationId, request.billId, request.sourceSequence]);
  return result.rows[0] ?? null;
}

export function providerBillSourceBlocker(row: ControlProviderBillSourceRow, now: Date): string | null {
  if (!row.grant_id || !row.authorized_at || !row.organization_id || row.region !== "IN"
    || row.notice_version !== "zoho-books-read-v1" || row.scopes?.join("|") !== "ZohoBooks.settings.READ|ZohoBooks.bills.READ") return "ORIGINAL_GRANT_MISSING";
  if (!row.authorizer_valid || !row.has_refresh || row.active_grant_id !== row.grant_id) return "CONSENT_NOT_CURRENT";
  if (row.status !== "READY" || row.last_error_code !== null || row.deleted) return row.last_error_code === "ABSENCE_UNCONFIRMED" ? "ABSENCE_UNCONFIRMED" : "SOURCE_NOT_READY";
  if (row.latest_sequence !== row.sequence) return "SNAPSHOT_SUPERSEDED";
  const syncTime = row.last_success_at?.getTime();
  const nextTime = row.next_run_at?.getTime();
  if (syncTime === undefined || nextTime === undefined || syncTime > now.getTime()
    || row.observed_at.getTime() > syncTime
    || now.getTime() - syncTime > controlProviderBillSourceMaxAgeMs
    || nextTime < now.getTime() || nextTime > syncTime + controlProviderBillSourceMaxAgeMs) return "SOURCE_STALE";
  if (row.authorized_at > row.observed_at || row.observed_at > now || Date.parse(row.bill.modifiedAt) > now.getTime()) return "SOURCE_TIME_INVALID";
  if (row.bill.version !== 1 || row.bill.basis !== "PROVIDER_BILL_TOTAL") return "SOURCE_BASIS_INVALID";
  return null;
}

export async function materializeProviderBillEvidenceOnly(client: PoolClient, input: {
  workspaceId: string; actorUserId: string; request: ReconcileControlProviderBillRequest; source: ControlProviderBillSourceRow; now: Date;
}) {
  const { workspaceId, actorUserId, request, source, now } = input;
  if (!controlProviderBillWorkspaceEnabled(workspaceId)) throw new RecoveryServiceError("FEATURE_UNAVAILABLE", "Provider bill admission is not enabled for this eligible workspace.");
  const blocker = providerBillSourceBlocker(source, now);
  if (blocker) throw new RecoveryServiceError("INVALID_EVIDENCE", `Provider bill cannot be admitted: ${blocker}.`);
  const authorizer = await client.query(`select member.user_id from users original_authorizer
    join workspace_members member on member.user_id=original_authorizer.id and member.workspace_id=$1
    where original_authorizer.id=$2 and original_authorizer.deleted_at is null and member.role in ('owner','admin')
    for share of original_authorizer,member`, [workspaceId, source.authorized_by_user_id]);
  if (authorizer.rowCount !== 1) throw new RecoveryServiceError("INVALID_EVIDENCE", "Provider bill cannot be admitted: CONSENT_NOT_CURRENT.");
  const existing = await client.query("select evidence_id from recovery_provider_bill_links where workspace_id=$1 and connection_id=$2 and source_sequence=$3", [workspaceId, request.connectionId, request.sourceSequence]);
  if (existing.rows[0]) return { evidenceId: existing.rows[0].evidence_id as string, providerBill: (await loadAdmittedProviderBills(client, workspaceId, [existing.rows[0].evidence_id])).get(existing.rows[0].evidence_id)! };
  const evidenceId = randomUUID();
  const sourceId = randomUUID();
  const submissionId = randomUUID();
  const bill = source.bill;
  const identity = JSON.stringify({ source: "ZOHO_BOOKS", workspaceId, connectionId: source.connection_id, organizationId: source.organization_id, billId: source.bill_id, sequence: source.sequence, fingerprint: source.fingerprint });
  const fingerprint = createHash("sha256").update(identity).digest("hex");
  const minimized = { billId: bill.billId, vendorName: bill.vendorName, billNumber: bill.billNumber, date: bill.date, status: bill.status, totalMinor: bill.totalMinor, sourceTotal: bill.sourceTotal, currency: bill.currency, modifiedAt: bill.modifiedAt, basis: bill.basis, version: bill.version };
  await client.query("insert into recovery_submissions(id,workspace_id,submitted_by_user_id,source_type,accepted_evidence_count,ingested_at) values ($1,$2,$3,'ZOHO_BOOKS',1,$4)", [submissionId, workspaceId, actorUserId, now]);
  await client.query(`insert into recovery_sources(id,workspace_id,submission_id,source_type,client_ref,label,content_hash,raw_evidence,ingested_at)
    values ($1,$2,$3,'ZOHO_BOOKS',$4,$5,$6,$7,$8)`, [sourceId, workspaceId, submissionId, `${source.connection_id}:${source.sequence}`, bill.billNumber, fingerprint, encryptSecret(JSON.stringify(minimized), `vognary-recovery-evidence:${workspaceId}:${sourceId}`), now]);
  await client.query(`insert into recovery_evidence(id,workspace_id,source_id,fingerprint,evidence_kind,evidence_basis,row_number,observed_at,excerpt,
    merchant,normalized_merchant,category,amount_minor,currency,evidence_date,direction,provenance_kind,provenance_reference,confidence_state,created_at)
    values ($1,$2,$3,$4,'PROVIDER_BILL','PROVIDER_BILL_TOTAL',1,null,null,$5,$5,'UNCLASSIFIED',$6,$7,$8,'unknown','PROVIDER_RECEIVED',$9,'UNKNOWN',$10)`,
    [evidenceId, workspaceId, sourceId, fingerprint, bill.vendorName, bill.totalMinor, bill.currency, bill.date, `zoho-books:${workspaceId}:${source.connection_id}:${source.organization_id}:${bill.billId}:${source.sequence}`, now]);
  await client.query(`insert into recovery_provider_bill_links(workspace_id,evidence_id,connection_id,organization_id,bill_id,source_sequence,source_version,
    source_fingerprint,source_observed_at,provider_modified_at,bill_date,bill_status,change_kind,total_minor,currency,source_total,vendor_name,bill_number,
    consent_reference,consent_generation,consent_notice_version,consent_scopes,consent_authorized_by_user_id,consent_authorized_at,region,
    connection_revision,last_successful_sync_at,selected_by_user_id,selected_at,relation_basis,retention_notice)
    values ($1,$2,$3,$4,$5,$6,1,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,'IN',$24,$25,$26,$27,$28,$29)`,
    [workspaceId, evidenceId, source.connection_id, source.organization_id, source.bill_id, source.sequence, source.fingerprint, source.observed_at,
      bill.modifiedAt, bill.date, bill.status, source.change_kind, bill.totalMinor, bill.currency, bill.sourceTotal, bill.vendorName, bill.billNumber,
      source.grant_id, source.consent_generation, source.notice_version, source.scopes, source.authorized_by_user_id, source.authorized_at,
      source.revision, source.last_success_at, actorUserId, now, request.wholeCharge, request.retentionNotice]);
  return { evidenceId, providerBill: (await loadAdmittedProviderBills(client, workspaceId, [evidenceId])).get(evidenceId)! };
}

export async function loadAdmittedProviderBills(client: PoolClient, workspaceId: string, evidenceIds: readonly string[]) {
  const result = await client.query(`select jsonb_build_object(
    'source','ZOHO_BOOKS','workspaceId',workspace_id,'evidenceId',evidence_id,'connectionId',connection_id,'organizationId',organization_id,
    'billId',bill_id,'sourceSequence',source_sequence::text,'sourceVersion',source_version,'sourceFingerprint',source_fingerprint,
    'sourceObservedAt',source_observed_at,'providerModifiedAt',provider_modified_at,'billDate',bill_date::text,'billStatus',bill_status,'changeKind',change_kind,
    'totalMinor',total_minor::text,'currency',currency,'sourceTotal',source_total,'vendorName',vendor_name,'billNumber',bill_number,
    'consentReference',consent_reference,'consentGeneration',consent_generation::text,'consentNoticeVersion',consent_notice_version,'consentScopes',consent_scopes,
    'consentAuthorizedByUserId',consent_authorized_by_user_id,'consentAuthorizedAt',consent_authorized_at,'region',region,
    'connectionRevision',connection_revision::text,'lastSuccessfulSyncAt',last_successful_sync_at,'selectedByUserId',selected_by_user_id,
    'selectedAt',selected_at,'relationBasis',relation_basis,'retentionNotice',retention_notice) as provenance
    from recovery_provider_bill_links where workspace_id=$1 and evidence_id=any($2::uuid[])`, [workspaceId, evidenceIds]);
  return new Map<string, ControlProviderBillProvenanceDto>(result.rows.map(row => {
    const provenance = row.provenance as ControlProviderBillProvenanceDto;
    for (const key of ["sourceObservedAt", "providerModifiedAt", "consentAuthorizedAt", "lastSuccessfulSyncAt", "selectedAt"] as const) provenance[key] = new Date(provenance[key]).toISOString();
    return [provenance.evidenceId, provenance];
  }));
}
