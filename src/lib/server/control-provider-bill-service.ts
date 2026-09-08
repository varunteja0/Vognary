import "server-only";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { ControlDecisionDto } from "@/lib/commitment-control/contracts";
import { compareAuthorizedProviderBill } from "@/lib/commitment-control/billed-comparison";
import { calendarDateInTimeZone } from "@/lib/commitment-control/project";
import { normalizeCurrency } from "@/lib/commitment-control/money";
import {
  controlProviderBillRetentionNotice, controlProviderBillSourceMaxAgeMs,
  type ControlProviderBillCandidateQuery, type ControlProviderBillCandidateDto, type ControlProviderBillCandidatesDto,
  type ControlProviderBillFreshnessDto, type ControlProviderBillProvenanceDto, type ControlProviderBillSourceStateDto,
} from "@/lib/commitment-control/provider-bill-contracts";
import { zohoBooksSorts, type ZohoBill } from "@/lib/zoho-books/contracts";
import { RecoveryServiceError } from "@/lib/server/recovery-api";
import { reviewProjection } from "@/lib/server/zoho-books-store";
import { controlProviderBillWorkspaceEnabled, loadControlProviderBillSource, providerBillSourceBlocker } from "@/lib/server/recovery-provider-bill-store";

type Connection = {
  id: string; revision: string; organization_id: string | null; status: string;
  active_grant_id: string | null; last_error_code: string | null; last_success_at: Date | null; next_run_at: Date | null;
};

function freshness(connection: Connection | null, now: Date): ControlProviderBillFreshnessDto {
  const success = connection?.last_success_at?.getTime();
  const next = connection?.next_run_at?.getTime();
  const valid = success !== undefined && next !== undefined && success <= now.getTime()
    && now.getTime() - success <= controlProviderBillSourceMaxAgeMs && next >= now.getTime()
    && next <= success + controlProviderBillSourceMaxAgeMs;
  return { status: connection?.status === "READY" && connection.last_error_code === null ? valid ? "FRESH" : "STALE" : "UNAVAILABLE",
    maximumAgeSeconds: 86400, lastCompletedSyncAt: connection?.last_success_at?.toISOString() ?? null,
    nextScheduledAt: connection?.next_run_at?.toISOString() ?? null, checkedAt: now.toISOString() };
}

export async function listControlProviderBillCandidates(client: PoolClient, input: {
  workspaceId: string; proposalId: string; decision: ControlDecisionDto; canManage: boolean;
  now: Date; query: ControlProviderBillCandidateQuery;
}): Promise<ControlProviderBillCandidatesDto> {
  const { workspaceId, proposalId, decision, canManage, now } = input;
  const search = input.query.search?.trim() ?? "";
  const sort = input.query.sort ?? "UPDATED";
  const currency = input.query.currency ? normalizeCurrency(input.query.currency) : null;
  if (search.length > 160 || !(zohoBooksSorts as readonly string[]).includes(sort)) throw new RecoveryServiceError("INVALID_EVIDENCE", "Choose a supported bounded bill query.");
  const connection = (await client.query<Connection>("select id,revision::text,organization_id,status,active_grant_id,last_error_code,last_success_at,next_run_at from zoho_books_connections where workspace_id=$1", [workspaceId])).rows[0] ?? null;
  const capabilityReasons = [
    ...(!canManage ? ["OWNER_OR_ADMIN_REQUIRED"] : []),
    ...(!controlProviderBillWorkspaceEnabled(workspaceId) ? ["PROVIDER_BILL_ADMISSION_DISABLED"] : []),
    ...(decision.amountBasis !== "GROSS_BILLED_TOTAL_PER_CHARGE" ? ["EXPLICIT_GROSS_AUTHORIZATION_REQUIRED"] : []),
    ...(decision.action === "DECLINE" ? ["PROPOSAL_DECLINED"] : []),
  ];
  const base: ControlProviderBillCandidatesDto = { source: "ZOHO_BOOKS", proposalId, matchingPerformed: false,
    connectionId: connection?.id ?? null, organizationId: connection?.organization_id ?? null,
    expectedSourceVersion: connection?.revision ?? null, canManage, canConfirm: capabilityReasons.length === 0,
    capabilityReasons, freshness: freshness(connection, now), retentionNotice: controlProviderBillRetentionNotice,
    retainedAdmissionCount: 0, candidates: [], total: 0, nextCursor: null, throughSequence: "0", throughEventSequence: "0", query: { search, sort, currency } };
  if (!connection?.organization_id) {
    if (input.query.cursor) throw new RecoveryServiceError("INVALID_EVIDENCE", "The bill page source is no longer available.");
    return base;
  }
  base.retainedAdmissionCount = Number((await client.query("select count(*)::text as count from recovery_provider_bill_links where workspace_id=$1 and connection_id=$2", [workspaceId, connection.id])).rows[0].count);
  const fingerprint = createHash("sha256").update(JSON.stringify([workspaceId, proposalId, connection.id, search, sort, currency])).digest("hex");
  const cursor = input.query.cursor?.split(".");
  if (cursor && (cursor.length !== 5 || cursor[0] !== "a2" || cursor[4] !== fingerprint
    || cursor.slice(1, 4).some(value => !/^(0|[1-9]\d{0,18})$/.test(value) || BigInt(value) > BigInt("9223372036854775807")) || cursor[3] === "0")) {
    throw new RecoveryServiceError("INVALID_EVIDENCE", "The bill cursor does not match this proposal and query.");
  }
  const bounds = (await client.query<{ source: string; event: string }>("select coalesce((select max(sequence) from zoho_books_snapshots where connection_id=$1),0)::text as source,coalesce((select max(event_sequence) from zoho_books_dispositions where connection_id=$1),0)::text as event", [connection.id])).rows[0];
  const through = cursor?.[1] ?? bounds.source;
  const eventThrough = cursor?.[2] ?? bounds.event;
  if (BigInt(through) > BigInt(bounds.source) || BigInt(eventThrough) > BigInt(bounds.event)) throw new RecoveryServiceError("INVALID_EVIDENCE", "The bill page bounds are invalid.");
  const after = cursor?.[3] ?? null;
  const anchor = after ? (await client.query<{ bill: ZohoBill }>("select bill from zoho_books_snapshots where connection_id=$1 and sequence=$2 and sequence<=$3", [connection.id, after, through])).rows[0] : null;
  if (after && !anchor) throw new RecoveryServiceError("INVALID_EVIDENCE", "The bill page anchor is no longer available.");
  const filter = "from bill_register snapshot where ($2::text='' or snapshot.bill->>'vendorName' ilike $2 or snapshot.bill->>'billNumber' ilike $2) and ($3::text is null or snapshot.bill->>'currency'=$3)";
  const direction = sort === "AMOUNT_ASC" ? "asc" : "desc";
  const comparison = sort === "AMOUNT_ASC" ? ">" : "<";
  const order = sort === "SUPPLIER" ? `lower(snapshot.bill->>'vendorName') collate "C" asc,snapshot.sequence asc`
    : sort === "DATE" ? "snapshot.bill->>'date' desc,snapshot.sequence desc"
      : sort.startsWith("AMOUNT_") ? `snapshot.bill->>'currency' collate "C" asc,(snapshot.bill->>'totalMinor')::numeric ${direction},snapshot.sequence ${direction}` : "snapshot.sequence desc";
  const seek = sort === "SUPPLIER" ? `(lower(snapshot.bill->>'vendorName') collate "C",snapshot.sequence)>($7::text collate "C",$6::bigint)`
    : sort === "DATE" ? "(snapshot.bill->>'date',snapshot.sequence)<($7::text,$6::bigint)"
      : sort.startsWith("AMOUNT_") ? `(snapshot.bill->>'currency' collate "C">$8::text collate "C" or (snapshot.bill->>'currency'=$8 and ((snapshot.bill->>'totalMinor')::numeric,snapshot.sequence)${comparison}($7::numeric,$6::bigint)))` : "snapshot.sequence<$6::bigint";
  const values: unknown[] = [connection.id, search ? `%${search.replace(/[\\%_]/g, "\\$&")}%` : "", currency, through, eventThrough];
  const pageValues = [...values, after];
  if (sort !== "UPDATED") pageValues.push(sort === "SUPPLIER" ? anchor?.bill.vendorName.toLowerCase() ?? "" : sort === "DATE" ? anchor?.bill.date ?? "" : anchor?.bill.totalMinor ?? "0");
  if (sort.startsWith("AMOUNT_")) pageValues.push(anchor?.bill.currency ?? "");
  const projection = reviewProjection("$4", "$5");
  const page = await client.query<{ sequence: string; bill_id: string }>(`${projection} select snapshot.sequence::text,snapshot.bill_id ${filter} and ($6::bigint is null or ${seek}) order by ${order} limit 51`, pageValues);
  const total = Number((await client.query(`${projection} select count(*)::text as count ${filter}`, values)).rows[0].count);
  const selectedRows = page.rows.slice(0, 50);
  const compared = new Set((await client.query<{ source_sequence: string }>(`select link.source_sequence::text from recovery_provider_bill_links link
    join commitment_control_reconciliations comparison on comparison.workspace_id=link.workspace_id and comparison.evidence_id=link.evidence_id
    where link.workspace_id=$1 and link.connection_id=$2 and comparison.decision_id=$3`, [workspaceId, connection.id, decision.id])).rows.map(row => row.source_sequence));
  const candidates: ControlProviderBillCandidateDto[] = [];
  for (const selected of selectedRows) {
    const row = await loadControlProviderBillSource(client, workspaceId, { connectionId: connection.id, organizationId: connection.organization_id, billId: selected.bill_id, sourceSequence: selected.sequence });
    if (!row) throw new RecoveryServiceError("INVALID_EVIDENCE", "The source snapshot is incomplete. Reload the source register.");
    const blocker = providerBillSourceBlocker(row, now);
    const selectionReasons = [...capabilityReasons, ...(blocker ? [blocker] : []), ...(compared.has(row.sequence) ? ["ALREADY_COMPARED"] : [])];
    let prospectiveVerdict: ControlProviderBillCandidateDto["prospectiveVerdict"] = null;
    try {
      prospectiveVerdict = compareAuthorizedProviderBill({ decision,
        evidence: { evidenceId: decision.id, evidenceBasis: row.bill.basis, totalMinor: row.bill.totalMinor, currency: row.bill.currency, billDate: row.bill.date, sourceObservedAt: row.observed_at.toISOString(), status: row.bill.status, changeKind: row.change_kind },
        wholeCharge: "USER_CONFIRMED_SAME_CHARGE", comparedOn: calendarDateInTimeZone(now, "Asia/Kolkata") }).verdict;
    } catch (error) { selectionReasons.push(error instanceof Error ? error.message : "COMPARISON_NOT_SUPPORTED"); }
    candidates.push({ source: "ZOHO_BOOKS", connectionId: connection.id, organizationId: connection.organization_id, billId: row.bill_id,
      sourceSequence: row.sequence, sourceVersion: row.bill.version, sourceFingerprint: row.fingerprint, sourceObservedAt: row.observed_at.toISOString(),
      providerModifiedAt: row.bill.modifiedAt, billDate: row.bill.date, billStatus: row.bill.status, changeKind: row.change_kind,
      vendorName: row.bill.vendorName, billNumber: row.bill.billNumber, totalMinor: row.bill.totalMinor, currency: row.bill.currency, evidenceBasis: row.bill.basis,
      consentReference: row.grant_id, consentGeneration: row.consent_generation, consentScopes: row.scopes,
      consentAuthorizedByUserId: row.authorized_by_user_id, consentAuthorizedAt: row.authorized_at?.toISOString() ?? null,
      consentNoticeVersion: row.notice_version, region: "IN", expectedSourceVersion: row.revision, expectedLatestSequence: row.latest_sequence,
      canSelect: selectionReasons.length === 0, selectionReasons, alreadyCompared: compared.has(row.sequence), prospectiveVerdict,
      billReviewPath: `/app?view=BILL_REVIEW&bill=${encodeURIComponent(row.bill_id)}` });
  }
  return { ...base, candidates, total, throughSequence: through, throughEventSequence: eventThrough,
    nextCursor: page.rows.length > 50 ? `a2.${through}.${eventThrough}.${selectedRows.at(-1)!.sequence}.${fingerprint}` : null };
}

export async function loadControlProviderBillResponsibilities(client: PoolClient, workspaceId: string, bills: readonly ControlProviderBillProvenanceDto[], now: Date) {
  const results = new Map<string, ControlProviderBillSourceStateDto>();
  for (const bill of bills) {
    const connection = (await client.query<Connection>("select id,revision::text,organization_id,status,active_grant_id,last_error_code,last_success_at,next_run_at from zoho_books_connections where workspace_id=$1 and id=$2", [workspaceId, bill.connectionId])).rows[0] ?? null;
    const base: ControlProviderBillSourceStateDto = { condition: "ERASED", latestSequence: null, currentStatus: connection?.status ?? null,
      currentReviewRelevance: null, freshness: freshness(connection, now), pendingMaterialNewerCount: 0, pendingMaterialNewerSequences: [],
      pendingMaterialOlderCount: 0, pendingMaterialOlderSequences: [], openFollowUpCount: 0, billReviewPath: null };
    if (!connection) { results.set(bill.evidenceId, base); continue; }
    const current = (await client.query<{ sequence: string; change_kind: string; review_relevance: "BASELINE" | "INFORMATIONAL" | "MATERIAL" }>(`${reviewProjection()} select sequence::text,change_kind,review_relevance from bill_register where bill_id=$2`, [connection.id, bill.billId])).rows[0];
    if (!current) { results.set(bill.evidenceId, base); continue; }
    const pending = (await client.query<{ newer: string; older: string; newer_sequences: string[] | null; older_sequences: string[] | null; followups: string }>(`${reviewProjection()}
      select count(*) filter(where sequence>$2 and review_relevance='MATERIAL' and disposition is null)::text as newer,
        count(*) filter(where sequence<=$2 and review_relevance='MATERIAL' and disposition is null)::text as older,
        (array_agg(sequence::text order by sequence desc) filter(where sequence>$2 and review_relevance='MATERIAL' and disposition is null))[1:50] as newer_sequences,
        (array_agg(sequence::text order by sequence desc) filter(where sequence<=$2 and review_relevance='MATERIAL' and disposition is null))[1:50] as older_sequences,
        count(*) filter(where disposition->>'kind'='FOLLOW_UP')::text as followups
      from classified_observations where bill_id=$3`, [connection.id, bill.sourceSequence, bill.billId])).rows[0];
    const condition: ControlProviderBillSourceStateDto["condition"] = connection.status === "REVOKED" ? "CONSENT_WITHDRAWN"
      : connection.last_error_code === "ABSENCE_UNCONFIRMED" ? "ABSENCE_UNCONFIRMED"
        : current.change_kind === "REMOVED" ? "REMOVED" : current.change_kind === "VOIDED" ? "VOIDED"
          : connection.active_grant_id !== bill.consentReference ? "CONSENT_CHANGED"
            : base.freshness.status === "UNAVAILABLE" ? "UNAVAILABLE" : base.freshness.status === "STALE" ? "STALE"
              : current.sequence !== bill.sourceSequence ? "AMENDED" : "CURRENT";
    results.set(bill.evidenceId, { ...base, condition, latestSequence: current.sequence, currentReviewRelevance: current.review_relevance,
      pendingMaterialNewerCount: Number(pending.newer), pendingMaterialNewerSequences: pending.newer_sequences ?? [],
      pendingMaterialOlderCount: Number(pending.older), pendingMaterialOlderSequences: pending.older_sequences ?? [], openFollowUpCount: Number(pending.followups),
      billReviewPath: `/app?view=BILL_REVIEW&bill=${encodeURIComponent(bill.billId)}` });
  }
  return results;
}
