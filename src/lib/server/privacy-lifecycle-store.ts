import "server-only";

import type { PoolClient, QueryResultRow } from "pg";
import {
  buildPrivacyExportDocument,
  retentionPolicyBounds,
  retentionPolicyDefaults,
  type PrivacyExportConnectedSource,
  type PrivacyExportEvidence,
  type PrivacyExportRecurringItem,
  type RetentionPolicyValues,
} from "@/lib/privacy-lifecycle";
import { getDatabasePool } from "@/lib/server/database";
import { decryptSecret, type EncryptedSecret } from "@/lib/server/token-vault";

const exportAvailabilityDays = 7;
const exportRowLimits = {
  consents: 500,
  connectedSources: 500,
  dataSources: 1_000,
  uploadedFiles: 1_000,
  transactions: 10_000,
  recurringLedger: 5_000,
  evidence: 10_000,
  decisions: 5_000,
  recommendations: 5_000,
  recoveryRecords: 20_000,
  productEvents: 5_000,
  renewalAlertPreferences: 500,
  renewalAlertDeliveries: 10_000,
  weeklyDigestDeliveries: 1_000,
  apiTokens: 500,
  billingCheckouts: 1_000,
  assistedAuditOrders: 1_000,
  billingRefunds: 2_000,
  entitlements: 100,
  proofNodes: 20_000,
  proofEdges: 40_000,
  confidenceExplanations: 5_000,
  ledgerEvents: 20_000,
  actionCases: 5_000,
  actionAuthorizations: 5_000,
  actionCaseEvents: 20_000,
  verificationWindows: 20_000,
  savingReceipts: 5_000,
  successFeeInvoices: 5_000,
  auditHistory: 10_000,
};
const maxSerializedExportBytes = 64 * 1024 * 1024;

const roleRank = { viewer: 1, member: 2, admin: 3, owner: 4 } as const;
type WorkspaceRole = keyof typeof roleRank;

export class PrivacyLifecycleAccessError extends Error {
  constructor() {
    super("Workspace access denied.");
    this.name = "PrivacyLifecycleAccessError";
  }
}

export class PrivacyExportTooLargeError extends Error {
  constructor(public readonly collection: keyof typeof exportRowLimits | "serializedBytes") {
    super(`Privacy export exceeds the synchronous ${collection} limit.`);
    this.name = "PrivacyExportTooLargeError";
  }
}

export type WorkspaceRetentionPolicyDto = RetentionPolicyValues & {
  workspaceId: string;
  usesWorkspaceOverride: boolean;
  updatedAt: string | null;
  bounds: typeof retentionPolicyBounds;
};

export type DataSubjectRequestDto = {
  id: string;
  workspaceId: string | null;
  requestType: "access_export";
  status: "ready" | "completed" | "failed" | "expired";
  requestedAt: string;
  completedAt: string | null;
  downloadExpiresAt: string;
  lastDownloadedAt: string | null;
  downloadCount: number;
  failureCode: string | null;
};

export async function getWorkspaceRetentionPolicy(input: {
  workspaceId: string;
  actorUserId: string;
}): Promise<WorkspaceRetentionPolicyDto> {
  const client = await getDatabasePool().connect();
  try {
    await assertWorkspaceRole(client, input.actorUserId, input.workspaceId, "viewer");
    return await readRetentionPolicy(client, input.workspaceId);
  } finally {
    client.release();
  }
}

export async function updateWorkspaceRetentionPolicy(input: {
  workspaceId: string;
  actorUserId: string;
  policy: RetentionPolicyValues;
  changedFields: Array<keyof RetentionPolicyValues>;
}): Promise<WorkspaceRetentionPolicyDto> {
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    await assertWorkspaceRole(client, input.actorUserId, input.workspaceId, "admin");
    await client.query(
      `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`retention-policy:${input.workspaceId}`],
    );
    const previous = await readRetentionPolicy(client, input.workspaceId);
    const next = policyValues(previous);
    for (const field of input.changedFields) next[field] = input.policy[field];
    const result = await client.query<RetentionPolicyRow>(
      `insert into workspace_retention_policies (
         workspace_id,
         raw_connector_payload_days,
         product_event_days,
         operational_error_days,
         updated_by_user_id
       ) values ($1, $2, $3, $4, $5)
       on conflict (workspace_id)
       do update set
         raw_connector_payload_days = excluded.raw_connector_payload_days,
         product_event_days = excluded.product_event_days,
         operational_error_days = excluded.operational_error_days,
         updated_by_user_id = excluded.updated_by_user_id,
         updated_at = now()
       returning workspace_id, raw_connector_payload_days, product_event_days,
                 operational_error_days, updated_at`,
      [
        input.workspaceId,
        next.rawConnectorPayloadDays,
        next.productEventDays,
        next.operationalErrorDays,
        input.actorUserId,
      ],
    );
    await client.query(
      `insert into audit_log (workspace_id, user_id, action, entity_type, entity_id, metadata)
       values ($1, $2, 'privacy.retention.updated', 'workspace_retention_policy', $1, $3)`,
      [input.workspaceId, input.actorUserId, {
        previous: policyValues(previous),
        next,
      }],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Retention policy upsert did not return a row.");
    await client.query("commit");
    return mapRetentionPolicy(row, true);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function createAccessExportRequest(input: {
  workspaceId: string;
  actorUserId: string;
}): Promise<DataSubjectRequestDto> {
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    await assertWorkspaceRole(client, input.actorUserId, input.workspaceId, "admin");
    await client.query(
      `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`privacy-export:${input.actorUserId}:${input.workspaceId}`],
    );
    await client.query(
      `update data_subject_requests
       set status = 'expired', updated_at = now()
       where requester_user_id = $1
         and workspace_id = $2
         and status = 'ready'
         and download_expires_at <= now()`,
      [input.actorUserId, input.workspaceId],
    );
    const existing = await client.query<DataSubjectRequestRow>(
      `select id, workspace_id, request_type, status, requested_at, completed_at,
              download_expires_at, last_downloaded_at, download_count, failure_code
       from data_subject_requests
       where requester_user_id = $1
         and workspace_id = $2
         and request_type = 'access_export'
         and status = 'ready'
         and download_expires_at > now()
       order by requested_at desc
       limit 1`,
      [input.actorUserId, input.workspaceId],
    );
    if (existing.rows[0]) {
      await client.query("commit");
      return mapDataSubjectRequest(existing.rows[0]);
    }
    const result = await client.query<DataSubjectRequestRow>(
      `insert into data_subject_requests (
         workspace_id,
         requester_user_id,
         request_type,
         status,
         download_expires_at
       ) values ($1, $2, 'access_export', 'ready', now() + ($3 * interval '1 day'))
       returning id, workspace_id, request_type, status, requested_at, completed_at,
                 download_expires_at, last_downloaded_at, download_count, failure_code`,
      [input.workspaceId, input.actorUserId, exportAvailabilityDays],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Privacy request insert did not return a row.");
    await client.query(
      `insert into audit_log (workspace_id, user_id, action, entity_type, entity_id, metadata)
       values ($1, $2, 'privacy.export.requested', 'data_subject_request', $3, $4)`,
      [input.workspaceId, input.actorUserId, row.id, { requestType: "access_export", availabilityDays: exportAvailabilityDays }],
    );
    await client.query("commit");
    return mapDataSubjectRequest(row);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function listDataSubjectRequests(input: {
  workspaceId: string;
  actorUserId: string;
}): Promise<DataSubjectRequestDto[]> {
  const client = await getDatabasePool().connect();
  try {
    await assertWorkspaceRole(client, input.actorUserId, input.workspaceId, "viewer");
    const result = await client.query<DataSubjectRequestRow>(
      `select id, workspace_id, request_type,
              case
                when status = 'ready' and download_expires_at <= now() then 'expired'
                else status
              end as status,
              requested_at, completed_at, download_expires_at, last_downloaded_at,
              download_count, failure_code
       from data_subject_requests
       where requester_user_id = $1
         and workspace_id = $2
       order by requested_at desc
       limit 100`,
      [input.actorUserId, input.workspaceId],
    );
    return result.rows.map(mapDataSubjectRequest);
  } finally {
    client.release();
  }
}

export async function downloadAccessExport(input: {
  requestId: string;
  workspaceId: string;
  actorUserId: string;
}): Promise<{ status: "ok"; serialized: string } | { status: "not-found" | "expired" }> {
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin isolation level repeatable read");
    const membership = await assertWorkspaceRole(client, input.actorUserId, input.workspaceId, "admin");
    const requestResult = await client.query<DataSubjectRequestRow>(
      `select id, workspace_id, request_type, status, requested_at, completed_at,
              download_expires_at, last_downloaded_at, download_count, failure_code
       from data_subject_requests
       where id = $1
         and requester_user_id = $2
         and workspace_id = $3
       for update`,
      [input.requestId, input.actorUserId, input.workspaceId],
    );
    const request = requestResult.rows[0];
    if (!request || request.status === "failed") {
      await client.query("rollback");
      return { status: "not-found" };
    }
    if (request.download_expires_at.getTime() <= Date.now() || request.status === "expired") {
      await client.query(
        `update data_subject_requests
         set status = 'expired', updated_at = now()
         where id = $1`,
        [request.id],
      );
      await client.query("commit");
      return { status: "expired" };
    }

    const document = await buildAccessExport(client, {
      requestId: request.id,
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      role: membership.role,
    });
    const serialized = JSON.stringify(document, null, 2);
    if (Buffer.byteLength(serialized, "utf8") > maxSerializedExportBytes) {
      throw new PrivacyExportTooLargeError("serializedBytes");
    }
    const download = await client.query<{ download_count: number }>(
      `update data_subject_requests
       set status = 'completed',
           completed_at = coalesce(completed_at, now()),
           last_downloaded_at = now(),
           download_count = download_count + 1,
           updated_at = now()
       where id = $1
       returning download_count`,
      [request.id],
    );
    await client.query(
      `insert into audit_log (workspace_id, user_id, action, entity_type, entity_id, metadata)
       values ($1, $2, 'privacy.export.downloaded', 'data_subject_request', $3, $4)`,
      [input.workspaceId, input.actorUserId, request.id, {
        exportVersion: 1,
        downloadCount: download.rows[0]?.download_count ?? request.download_count + 1,
      }],
    );
    await client.query("commit");
    return { status: "ok", serialized };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function markAccessExportFailed(input: {
  requestId: string;
  workspaceId: string;
  actorUserId: string;
  failureCode: "export_too_large" | "generation_failed";
}) {
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    await assertWorkspaceRole(client, input.actorUserId, input.workspaceId, "admin");
    const updated = await client.query(
      `update data_subject_requests
       set status = 'failed', failure_code = $1, updated_at = now()
       where id = $2
         and requester_user_id = $3
         and workspace_id = $4
         and status = 'ready'`,
      [input.failureCode, input.requestId, input.actorUserId, input.workspaceId],
    );
    if (updated.rowCount) {
      await client.query(
        `insert into audit_log (workspace_id, user_id, action, entity_type, entity_id, metadata)
         values ($1, $2, 'privacy.export.failed', 'data_subject_request', $3, $4)`,
        [input.workspaceId, input.actorUserId, input.requestId, { failureCode: input.failureCode }],
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function buildAccessExport(client: PoolClient, input: {
  requestId: string;
  workspaceId: string;
  actorUserId: string;
  role: WorkspaceRole;
}) {
  const accountResult = await client.query<AccountWorkspaceRow>(
    `select u.id as user_id, u.email, u.display_name, u.created_at as user_created_at,
            u.updated_at as user_updated_at, w.id as workspace_id, w.name as workspace_name,
            w.plan, w.workspace_type, w.created_at as workspace_created_at, w.updated_at as workspace_updated_at
     from users u
     join workspace_members wm on wm.user_id = u.id
     join workspaces w on w.id = wm.workspace_id
     where u.id = $1
       and w.id = $2
       and u.deleted_at is null`,
    [input.actorUserId, input.workspaceId],
  );
  const account = accountResult.rows[0];
  if (!account) throw new PrivacyLifecycleAccessError();

  const policy = await readRetentionPolicy(client, input.workspaceId);
  const query = createSequentialQuery(client);
  const [
    consentResult,
    sourceResult,
    dataSourceResult,
    uploadedFileResult,
    transactionResult,
    recurringResult,
    evidenceResult,
    decisionResult,
    recommendationResult,
    workspaceStateResult,
    recoveryResult,
    productEventResult,
    renewalPreferenceResult,
    renewalDeliveryResult,
    weeklyDigestDeliveryResult,
    apiTokenResult,
    billingCheckoutResult,
    assistedAuditOrderResult,
    billingRefundResult,
    entitlementResult,
    proofNodeResult,
    proofEdgeResult,
    confidenceResult,
    ledgerEventResult,
    actionCaseResult,
    actionAuthorizationResult,
    actionCaseEventResult,
    verificationWindowResult,
    savingReceiptResult,
    successFeeInvoiceResult,
    auditResult,
  ] = await Promise.all([
    query<ConsentExportRow>(
      `select id, workspace_id, purpose, notice_version, source, scopes,
              granted_at, withdrawn_at, expires_at
       from consent_grants
       where (user_id = $1 or lower(subject_email) = lower($2))
         and (workspace_id = $3 or workspace_id is null)
       order by granted_at desc
       limit $4`,
      [input.actorUserId, account.email, input.workspaceId, exportRowLimits.consents + 1],
    ),
    query<ConnectedSourceExportRow>(
      `select ca.id, ca.source_id, ca.connector_id, ca.auth_type, ca.provider_account_id,
              ca.display_name, ca.scopes, ca.status, ca.consent_expires_at,
              ca.last_synced_at, ca.created_at, ca.updated_at,
              ds.kind, ds.provider, ds.display_name as source_display_name,
              ds.consent_scope, ds.status as source_status, ds.coverage_start_at,
              ds.coverage_end_at, ds.coverage_completeness, ds.freshness_status
       from connected_accounts ca
       left join data_sources ds
         on ds.id = ca.source_id and ds.workspace_id = ca.workspace_id
       where ca.workspace_id = $1
       order by ca.created_at asc
       limit $2`,
      [input.workspaceId, exportRowLimits.connectedSources + 1],
    ),
    query<{
      id: string;
      external_reference: string | null;
      kind: string;
      provider: string | null;
      display_name: string;
      consent_scope: string | null;
      status: string;
      last_synced_at: Date | null;
      coverage_start_at: Date | null;
      coverage_end_at: Date | null;
      coverage_completeness: string;
      freshness_status: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `select id, external_reference, kind::text, provider, display_name,
              consent_scope, status, last_synced_at, coverage_start_at,
              coverage_end_at, coverage_completeness, freshness_status,
              created_at, updated_at
       from data_sources
       where workspace_id = $1
       order by created_at asc
       limit $2`,
      [input.workspaceId, exportRowLimits.dataSources + 1],
    ),
    query<{
      id: string;
      source_id: string | null;
      file_name: string;
      mime_type: string;
      byte_size: string;
      encrypted: boolean;
      parsed_at: Date | null;
      deleted_at: Date | null;
      created_at: Date;
    }>(
      `select id, source_id, file_name, mime_type, byte_size::text,
              encrypted, parsed_at, deleted_at, created_at
       from uploaded_files
       where workspace_id = $1
       order by created_at asc
       limit $2`,
      [input.workspaceId, exportRowLimits.uploadedFiles + 1],
    ),
    query<{
      id: string;
      source_id: string | null;
      uploaded_file_id: string | null;
      transaction_date: Date | string;
      description: string;
      normalized_merchant: string;
      category: string;
      amount: string;
      currency: string;
      direction: string;
      external_reference: string | null;
      created_at: Date;
    }>(
      `select id, source_id, uploaded_file_id, transaction_date, description,
              normalized_merchant, category, amount, currency, direction,
              external_reference, created_at
       from transactions
       where workspace_id = $1
       order by transaction_date asc, id asc
       limit $2`,
      [input.workspaceId, exportRowLimits.transactions + 1],
    ),
    query<RecurringExportRow>(
      `select id, merchant, normalized_merchant, category, frequency, currency,
              amount_min, amount_max, average_amount, monthly_cost, annual_cost,
              last_charge_date, next_expected_date, confidence_score, status,
              recommendation_reason, risk_tags, first_detected_at, updated_at
       from recurring_items
       where workspace_id = $1
       order by first_detected_at asc
       limit $2`,
      [input.workspaceId, exportRowLimits.recurringLedger + 1],
    ),
    query<EvidenceExportRow>(
      `select id, connected_account_id, source_id, recurring_item_id, connector_id,
              provider, evidence_type, observed_at, amount, currency, cadence_hint,
              next_debit_hint, confidence_score, created_at
       from connector_evidence
       where workspace_id = $1
       order by created_at asc
       limit $2`,
      [input.workspaceId, exportRowLimits.evidence + 1],
    ),
    query<{
      id: string;
      recurring_item_id: string;
      decided_by_user_id: string | null;
      action: string;
      decided_at: Date;
      updated_at: Date;
    }>(
      `select id, recurring_item_id, decided_by_user_id, action, decided_at, updated_at
       from commitment_decisions
       where workspace_id = $1
       order by decided_at asc
       limit $2`,
      [input.workspaceId, exportRowLimits.decisions + 1],
    ),
    query<{
      id: string;
      recurring_item_id: string;
      recommendation_type: string;
      reason: string;
      estimated_monthly_savings: string;
      currency: string;
      confidence_score: number;
      accepted_at: Date | null;
      dismissed_at: Date | null;
      created_at: Date;
    }>(
      `select recommendation.id, recommendation.recurring_item_id,
              recommendation.recommendation_type, recommendation.reason,
              recommendation.estimated_monthly_savings,
              item.currency,
              recommendation.confidence_score, recommendation.accepted_at,
              recommendation.dismissed_at, recommendation.created_at
       from recommendations recommendation
       join recurring_items item on item.id = recommendation.recurring_item_id
       where item.workspace_id = $1
       order by recommendation.created_at asc
       limit $2`,
      [input.workspaceId, exportRowLimits.recommendations + 1],
    ),
    query<{
      encrypted_snapshot: { encrypted?: boolean; payload?: EncryptedSecret };
      revision: string;
      updated_at: Date;
    }>(
      `select encrypted_snapshot, revision::text, updated_at
       from workspace_states
       where workspace_id = $1`,
      [input.workspaceId],
    ),
    query<RecoveryExportRow>(
      `select
        (select to_jsonb(record) from (
             select version::text, baseline_version::text as "baselineVersion",
                 latest_changed_state as "latestChangedState",
               latest_from_version::text as "latestFromVersion",
               latest_changed_version::text as "latestChangedVersion",
                 created_at as "createdAt", updated_at as "updatedAt"
          from recovery_workspace_states where workspace_id = $1
        ) record) as workspace_state,
        (select coalesce(jsonb_agg(to_jsonb(record)), '[]'::jsonb) from (
             select version::text, actor_user_id as "actorUserId", mutation_kind as "mutationKind",
               changed_state as "changedState", from_version::text as "fromVersion",
                 snapshot, created_at as "createdAt"
          from recovery_workspace_versions where workspace_id = $1
          order by version asc limit $2
        ) record) as versions,
        (select coalesce(jsonb_agg(to_jsonb(record)), '[]'::jsonb) from (
          select id, submitted_by_user_id as "submittedByUserId", source_type as "sourceType",
                 accepted_evidence_count as "acceptedEvidenceCount", results,
                 ingested_at as "ingestedAt"
          from recovery_submissions where workspace_id = $1
          order by ingested_at asc, id asc limit $2
        ) record) as submissions,
        (select coalesce(jsonb_agg(to_jsonb(record)), '[]'::jsonb) from (
          select id, submission_id as "submissionId", source_type as "sourceType",
               client_ref as "clientRef", label,
                 (raw_minimized_at is null) as "rawEvidenceRetained",
                 raw_minimized_at as "rawMinimizedAt", coverage_start as "coverageStart",
                 coverage_end as "coverageEnd", ingested_at as "ingestedAt"
          from recovery_sources where workspace_id = $1
          order by ingested_at asc, id asc limit $2
        ) record) as sources,
        (select coalesce(jsonb_agg(to_jsonb(record)), '[]'::jsonb) from (
          select id, identity_key as "identityKey", version,
                 base_status as "baseStatus", base_merchant as "baseMerchant",
                 base_category as "baseCategory", base_cadence as "baseCadence",
                 base_currency as "baseCurrency", base_amount_minor::text as "baseAmountMinor",
                 base_monthly_minor::text as "baseMonthlyMinor",
                 base_next_expected_date as "baseNextExpectedDate",
                 effective_status as "effectiveStatus", effective_merchant as "effectiveMerchant",
                 effective_cadence as "effectiveCadence", effective_amount_minor::text as "effectiveAmountMinor",
                 effective_monthly_minor::text as "effectiveMonthlyMinor",
                 effective_next_expected_date as "effectiveNextExpectedDate",
                 confidence_score as "confidenceScore", confidence_reasons as "confidenceReasons",
                 recommended_decision as "recommendedDecision",
                 recommendation_reason as "recommendationReason", risk_tags as "riskTags",
                 first_detected_at as "firstDetectedAt", updated_at as "updatedAt"
          from recovery_commitments where workspace_id = $1
          order by first_detected_at asc, id asc limit $2
        ) record) as commitments,
        (select coalesce(jsonb_agg(to_jsonb(record)), '[]'::jsonb) from (
          select id, source_id as "sourceId", immutable,
                 evidence_kind as "evidenceKind", row_number as "rowNumber",
                 observed_at as "observedAt", excerpt, excerpt_truncated as "excerptTruncated",
                 merchant, normalized_merchant as "normalizedMerchant", category,
                 amount_minor::text as "amountMinor", currency, evidence_date as "evidenceDate",
                 direction, cadence_hint as "cadenceHint", next_expected_date as "nextExpectedDate",
                 provenance_kind as "provenanceKind", provenance_reference as "provenanceReference",
                 confidence_state as "confidenceState", confidence_score as "confidenceScore",
                 confidence_reasons as "confidenceReasons", created_at as "createdAt"
          from recovery_evidence where workspace_id = $1
          order by created_at asc, id asc limit $2
        ) record) as evidence,
        (select coalesce(jsonb_agg(to_jsonb(record)), '[]'::jsonb) from (
          select commitment_id as "commitmentId", evidence_id as "evidenceId", linked_at as "linkedAt"
          from recovery_commitment_evidence where workspace_id = $1
          order by linked_at asc, commitment_id asc, evidence_id asc limit $2
        ) record) as commitment_evidence,
        (select coalesce(jsonb_agg(to_jsonb(record)), '[]'::jsonb) from (
          select id, commitment_id as "commitmentId", created_by_user_id as "createdByUserId",
                 field, patch, reason, status, created_at as "createdAt",
                 reversed_at as "reversedAt", superseded_at as "supersededAt"
          from recovery_corrections where workspace_id = $1
          order by created_at asc, id asc limit $2
        ) record) as corrections,
        (select coalesce(jsonb_agg(to_jsonb(record)), '[]'::jsonb) from (
          select commitment_id as "commitmentId", decided_by_user_id as "decidedByUserId",
                 decision, decided_at as "decidedAt", updated_at as "updatedAt"
          from recovery_decisions where workspace_id = $1
          order by decided_at asc, commitment_id asc limit $2
        ) record) as decisions,
        (select coalesce(jsonb_agg(to_jsonb(record)), '[]'::jsonb) from (
             select id, commitment_id as "commitmentId", from_version::text as "fromVersion",
               to_version::text as "toVersion", kind, merchant, before_value as "before",
               after_value as "after", provenance_kind as "provenanceKind",
               evidence_submission_id as "evidenceSubmissionId", correction_id as "correctionId",
               evidence_ids as "evidenceIds", detected_at as "detectedAt"
          from recovery_changes where workspace_id = $1
          order by to_version asc, detected_at asc, id asc limit $2
        ) record) as changes,
        (select coalesce(jsonb_agg(to_jsonb(record)), '[]'::jsonb) from (
          select id, connected_account_id as "connectedAccountId",
                 receiving_domain as "receivingDomain", status,
                 replaced_by_id as "replacedById", created_at as "createdAt",
                 rotated_at as "rotatedAt", revoked_at as "revokedAt"
          from recovery_inbound_aliases where workspace_id = $1
          order by created_at asc, id asc limit $2
        ) record) as inbound_aliases,
        (select coalesce(jsonb_agg(to_jsonb(record)), '[]'::jsonb) from (
          select id, provider, event_type as "eventType", status,
                 error_code as "errorCode", received_at as "receivedAt",
                 processed_at as "processedAt"
          from recovery_inbound_events where workspace_id = $1
          order by received_at asc, id asc limit $2
        ) record) as inbound_events,
        (select coalesce(jsonb_agg(to_jsonb(record)), '[]'::jsonb) from (
          select id, source_id as "sourceId", trust_tier as "trustTier",
                 from_domain as "fromDomain", trusted_authority as "trustedAuthority",
                 assertions, signing_domains as "signingDomains", reasons,
                 assessed_at as "assessedAt"
          from recovery_inbound_sender_assessments where workspace_id = $1
          order by assessed_at asc, id asc limit $2
        ) record) as inbound_sender_assessments,
        (select coalesce(jsonb_agg(to_jsonb(record)), '[]'::jsonb) from (
          select id, version, status, terms_version as "termsVersion",
                 signed_text_hash as "signedTextHash", currency,
                 per_action_ceiling_minor::text as "perActionCeilingMinor",
                 rolling_30d_ceiling_minor::text as "rolling30dCeilingMinor",
                 veto_window_hours as "vetoWindowHours",
                 signed_at as "signedAt", revoked_at as "revokedAt"
          from recovery_standing_mandates where workspace_id = $1
          order by version asc limit $2
        ) record) as standing_mandates,
        (select coalesce(jsonb_agg(to_jsonb(record)), '[]'::jsonb) from (
          select id, commitment_id as "commitmentId", eligibility, status,
                 ineligible_reasons as "ineligibleReasons", provider_id as "providerId",
                 amount_minor::text as "amountMinor", currency,
                 notice_delivered_at as "noticeDeliveredAt",
                 veto_deadline_at as "vetoDeadlineAt", exception_code as "exceptionCode"
          from recovery_action_candidates where workspace_id = $1
          order by created_at asc, id asc limit $2
        ) record) as action_candidates,
        (select coalesce(jsonb_agg(to_jsonb(record)), '[]'::jsonb) from (
          select candidate_id as "candidateId", status, expected_debit_date as "expectedDebitDate",
               saving_minor::text as "savingMinor", currency
          from recovery_covered_windows where workspace_id = $1
          order by expected_debit_date asc limit $2
        ) record) as covered_windows,
        (select coalesce(jsonb_agg(to_jsonb(record)), '[]'::jsonb) from (
          select period_start as "periodStart", period_end as "periodEnd",
               currency,
                 monitoring_minor::text as "monitoringMinor",
                 verified_saving_minor::text as "verifiedSavingMinor",
                 retained_minor::text as "retainedMinor",
                 razorpay_charge_status as "razorpayChargeStatus"
          from recovery_fee_ledger where workspace_id = $1
          order by period_end desc limit $2
        ) record) as fee_ledger,
        (select coalesce(jsonb_agg(to_jsonb(record)), '[]'::jsonb) from (
          select anchor_date as "anchorDate", created_at as "createdAt"
          from recovery_billing_year_anchors where workspace_id = $1
          limit $2
        ) record) as billing_year_anchors,
        (select coalesce(jsonb_agg(to_jsonb(record)), '[]'::jsonb) from (
          select mandate_id as "mandateId", kind, created_at as "createdAt"
          from recovery_standing_mandate_events where workspace_id = $1
          order by created_at asc limit $2
        ) record) as mandate_events,
        (select coalesce(jsonb_agg(to_jsonb(record)), '[]'::jsonb) from (
          select id, commitment_id as "commitmentId", commitment_class as "commitmentClass",
                 protected_override as "protectedOverride", cited_category as "citedCategory",
                 confidence_score as "confidenceScore", created_at as "createdAt"
          from recovery_classification_snapshots where workspace_id = $1
          order by created_at asc, id asc limit $2
        ) record) as classification_snapshots,
        (select coalesce(jsonb_agg(to_jsonb(record)), '[]'::jsonb) from (
          select candidate_id as "candidateId", previous_status as "previousStatus", status,
                 actor_kind as "actorKind", reason_code as "reasonCode", created_at as "createdAt"
          from recovery_candidate_events where workspace_id = $1
          order by created_at asc limit $2
        ) record) as candidate_events,
        (select coalesce(jsonb_agg(to_jsonb(record)), '[]'::jsonb) from (
          select candidate_id as "candidateId", channel, delivery_status as "deliveryStatus",
                 delivered_at as "deliveredAt",
                 veto_expires_at as "vetoExpiresAt",
                 frozen_at as "frozenAt", created_at as "createdAt"
          from recovery_veto_notices where workspace_id = $1
          order by created_at asc limit $2
        ) record) as veto_notices,
        (select coalesce(jsonb_agg(to_jsonb(record)), '[]'::jsonb) from (
          select candidate_id as "candidateId", attempt_no as "attemptNo", status, outcome,
                 operator_minutes::text as "operatorMinutes", proof_kind as "proofKind", created_at as "createdAt"
          from recovery_execution_attempts where workspace_id = $1
          order by created_at asc limit $2
        ) record) as execution_attempts,
        (select coalesce(jsonb_agg(to_jsonb(record)), '[]'::jsonb) from (
          select candidate_id as "candidateId", outcome, operator_minutes::text as "operatorMinutes",
                 proof_kind as "proofKind", attempt_no as "attemptNo", created_at as "createdAt"
          from recovery_executions where workspace_id = $1
          order by created_at asc limit $2
        ) record) as executions,
        (select coalesce(jsonb_agg(to_jsonb(record)), '[]'::jsonb) from (
          select candidate_id as "candidateId", minutes::text, outcome, created_at as "createdAt"
          from recovery_operator_actions where workspace_id = $1
          order by created_at asc limit $2
        ) record) as operator_actions,
        (select coalesce(jsonb_agg(to_jsonb(record)), '[]'::jsonb) from (
          select candidate_id as "candidateId", event_type as "eventType", occurred_at as "occurredAt"
          from recovery_notice_delivery_events where workspace_id = $1
          order by created_at asc limit $2
        ) record) as notice_delivery_events,
        (select coalesce(jsonb_agg(to_jsonb(record)), '[]'::jsonb) from (
          select kind, last_error_code as "lastErrorCode", attempt_count as "attemptCount",
                 created_at as "createdAt"
          from recovery_autopilot_dead_letters where workspace_id = $1
          order by created_at asc limit $2
        ) record) as dead_letters,
        (select coalesce(jsonb_agg(to_jsonb(record)), '[]'::jsonb) from (
          select disable.provider_id as "providerId", disable.disabled,
                 disable.updated_at as "updatedAt"
          from recovery_provider_disables disable
          where disable.provider_id in (
            select distinct candidate.provider_id
            from recovery_action_candidates candidate
            where candidate.workspace_id = $1 and candidate.provider_id is not null
          )
          order by disable.provider_id
          limit $2
        ) record) as provider_controls,
        (select coalesce(jsonb_agg(to_jsonb(record)), '[]'::jsonb) from (
          select started_at as "startedAt", recorded_at as "recordedAt"
          from recovery_connected_mandate_cohort where workspace_id = $1
          limit $2
        ) record) as connected_mandate_cohort,
        (select coalesce(jsonb_agg(to_jsonb(record)), '[]'::jsonb) from (
          select source_id as "sourceId", disconnected_at as "disconnectedAt",
                 reconnected_at as "reconnectedAt"
          from recovery_source_disconnections where workspace_id = $1
          order by disconnected_at asc, source_id asc limit $2
        ) record) as source_disconnections`,
      [input.workspaceId, exportRowLimits.recoveryRecords + 1],
    ),
    query<{
      id: string;
      user_id: string | null;
      event_name: string;
      occurred_at: Date;
      source: string;
      status: string | null;
      duration_ms: number | null;
      metrics: Record<string, number>;
    }>(
      `select id, user_id, event_name, occurred_at, source, status,
              duration_ms, metrics
       from product_events
       where workspace_id = $1
       order by occurred_at asc
       limit $2`,
      [input.workspaceId, exportRowLimits.productEvents + 1],
    ),
    query<{
      id: string;
      user_id: string;
      consent_grant_id: string | null;
      enabled: boolean;
      weekly_digest_enabled: boolean;
      seven_day_enabled: boolean;
      one_day_enabled: boolean;
      time_zone: string;
      send_hour_local: number;
      disabled_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `select id, user_id, consent_grant_id, enabled, weekly_digest_enabled, seven_day_enabled,
              one_day_enabled, time_zone, send_hour_local, disabled_at,
              created_at, updated_at
       from renewal_alert_preferences
       where workspace_id = $1
       order by created_at asc
       limit $2`,
      [input.workspaceId, exportRowLimits.renewalAlertPreferences + 1],
    ),
    query<{
      id: string;
      user_id: string;
      preference_id: string;
      consent_grant_id: string;
      recurring_item_id: string | null;
      recovery_commitment_id: string | null;
      alert_window: string;
      renewal_date: Date | string;
      scheduled_for: Date;
      status: string;
      attempt_count: number;
      next_attempt_at: Date | null;
      sent_at: Date | null;
      last_error_code: string | null;
      last_error_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(
            `select id, user_id, preference_id, consent_grant_id, recurring_item_id,
              recovery_commitment_id,
              alert_window, renewal_date, scheduled_for, status, attempt_count,
              next_attempt_at, sent_at, last_error_code, last_error_at,
              created_at, updated_at
       from renewal_alert_deliveries
       where workspace_id = $1
       order by created_at asc
       limit $2`,
      [input.workspaceId, exportRowLimits.renewalAlertDeliveries + 1],
    ),
    query<{
      id: string;
      user_id: string;
      preference_id: string;
      consent_grant_id: string;
      week_start: Date | string;
      scheduled_for: Date;
      status: string;
      attempt_count: number;
      next_attempt_at: Date | null;
      sent_at: Date | null;
      last_error_code: string | null;
      last_error_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `select id, user_id, preference_id, consent_grant_id, week_start,
              scheduled_for, status, attempt_count, next_attempt_at, sent_at,
              last_error_code, last_error_at, created_at, updated_at
       from weekly_digest_deliveries
       where workspace_id = $1
       order by created_at asc
       limit $2`,
      [input.workspaceId, exportRowLimits.weeklyDigestDeliveries + 1],
    ),
    query<{
      id: string;
      user_id: string;
      name: string;
      token_prefix: string;
      scopes: string[];
      expires_at: Date;
      last_used_at: Date | null;
      revoked_at: Date | null;
      created_at: Date;
    }>(
      `select id, user_id, name, token_prefix, scopes, expires_at,
              last_used_at, revoked_at, created_at
       from platform_api_tokens
       where workspace_id = $1
       order by created_at asc
       limit $2`,
      [input.workspaceId, exportRowLimits.apiTokens + 1],
    ),
    query<{
      id: string;
      user_id: string | null;
      plan: string;
      offer_id: string;
      offer_version: number;
      terms_version: string;
      provider: string;
      status: string;
      currency: string;
      amount_minor: string;
      refunded_amount_minor: string;
      provider_checkout_id: string | null;
      provider_payment_id: string | null;
      paid_at: Date | null;
      refunded_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(
            `select id, user_id, plan, offer_id, offer_version, terms_version,
              provider, status, currency, amount_minor::text,
              refunded_amount_minor::text, provider_checkout_id, provider_payment_id,
              paid_at, refunded_at, created_at, updated_at
       from billing_checkout_sessions
       where workspace_id = $1
       order by created_at asc
       limit $2`,
      [input.workspaceId, exportRowLimits.billingCheckouts + 1],
    ),
    query<{
      id: string;
      checkout_session_id: string;
      user_id: string | null;
      lead_id: string | null;
      offer_id: string;
      offer_version: number;
      terms_version: string;
      status: string;
      created_at: Date;
      started_at: Date | null;
      delivered_at: Date | null;
      refunded_at: Date | null;
      updated_at: Date;
    }>(
      `select id, checkout_session_id, user_id, lead_id, offer_id, offer_version,
              terms_version, status, created_at, started_at, delivered_at,
              refunded_at, updated_at
       from assisted_audit_orders
       where workspace_id = $1
       order by created_at asc
       limit $2`,
      [input.workspaceId, exportRowLimits.assistedAuditOrders + 1],
    ),
    query<{
      id: string;
      provider: string;
      provider_refund_id: string;
      provider_payment_id: string;
      checkout_session_id: string | null;
      amount_minor: string;
      currency: string;
      status: string;
      rejection_code: string | null;
      created_at: Date;
      applied_at: Date | null;
    }>(
      `select refund.id, refund.provider, refund.provider_refund_id,
              refund.provider_payment_id, refund.checkout_session_id,
              refund.amount_minor::text, refund.currency, refund.status,
              refund.rejection_code, refund.created_at, refund.applied_at
       from billing_refunds refund
       join billing_checkout_sessions checkout on checkout.id = refund.checkout_session_id
       where checkout.workspace_id = $1
       order by refund.created_at asc
       limit $2`,
      [input.workspaceId, exportRowLimits.billingRefunds + 1],
    ),
    query<{
      entitlement_key: string;
      source_checkout_session_id: string | null;
      status: string;
      starts_at: Date;
      expires_at: Date;
      revoked_at: Date | null;
      updated_at: Date;
    }>(
      `select entitlement_key, source_checkout_session_id, status, starts_at,
              expires_at, revoked_at, updated_at
       from workspace_entitlements
       where workspace_id = $1
       order by entitlement_key
       limit $2`,
      [input.workspaceId, exportRowLimits.entitlements + 1],
    ),
    query<{
      id: string;
      kind: string;
      entity_ref: string;
      status: string;
      created_at: Date;
      retired_at: Date | null;
    }>(
      `select id, kind, entity_ref, status, created_at, retired_at
       from proof_nodes
       where workspace_id = $1
       order by created_at asc, id asc
       limit $2`,
      [input.workspaceId, exportRowLimits.proofNodes + 1],
    ),
    query<{
      id: string;
      from_node_id: string;
      to_node_id: string;
      edge_type: string;
      valid_from: Date;
      valid_to: Date | null;
      created_by_event_id: string | null;
    }>(
      `select id, from_node_id, to_node_id, edge_type, valid_from, valid_to,
              created_by_event_id
       from proof_edges
       where workspace_id = $1
       order by valid_from asc, id asc
       limit $2`,
      [input.workspaceId, exportRowLimits.proofEdges + 1],
    ),
    query<{
      recurring_item_id: string;
      score: number;
      proof_density: string;
      source_diversity: string;
      freshness: string;
      cadence_stability: string;
      model_version: string;
      graph_revision: string;
      explanation: Record<string, unknown>;
      computed_at: Date;
    }>(
      `select recurring_item_id, score, proof_density::text, source_diversity::text,
              freshness::text, cadence_stability::text, model_version,
              graph_revision::text, explanation, computed_at
       from confidence_explanations
       where workspace_id = $1
       order by computed_at asc, recurring_item_id asc
       limit $2`,
      [input.workspaceId, exportRowLimits.confidenceExplanations + 1],
    ),
    query<{
      id: string;
      workspace_sequence: string;
      event_type: string;
      schema_version: number;
      actor_user_id: string | null;
      entity_kind: string;
      entity_ref: string;
      payload: Record<string, unknown>;
      previous_event_hash: string | null;
      event_hash: string;
      occurred_at: Date;
    }>(
      `select id, workspace_sequence::text, event_type, schema_version,
              actor_user_id, entity_kind, entity_ref, payload,
              previous_event_hash, event_hash, occurred_at
       from ledger_events
       where workspace_id = $1
       order by workspace_sequence asc
       limit $2`,
      [input.workspaceId, exportRowLimits.ledgerEvents + 1],
    ),
    query<{
      id: string;
      recurring_item_id: string;
      requested_by_user_id: string;
      assigned_operator_user_id: string | null;
      action: string;
      commitment_class: string;
      status: string;
      currency: string;
      baseline_monthly_amount: string;
      baseline_annual_amount: string;
      target_monthly_amount: string | null;
      maximum_success_fee_minor: string;
      failure_code: string | null;
      authorized_at: Date | null;
      execution_started_at: Date | null;
      executed_at: Date | null;
      verification_started_at: Date | null;
      verified_at: Date | null;
      withdrawn_at: Date | null;
      disputed_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `select id, recurring_item_id, requested_by_user_id, assigned_operator_user_id,
              action, commitment_class, status, currency,
              baseline_monthly_amount::text, baseline_annual_amount::text,
              target_monthly_amount::text, maximum_success_fee_minor::text,
              failure_code, authorized_at, execution_started_at, executed_at,
              verification_started_at, verified_at, withdrawn_at, disputed_at,
              created_at, updated_at
       from action_cases
       where workspace_id = $1
       order by created_at asc, id asc
       limit $2`,
      [input.workspaceId, exportRowLimits.actionCases + 1],
    ),
    query<{
      id: string;
      action_case_id: string;
      authorized_by_user_id: string;
      action: string;
      scope: string;
      authorization_version: number;
      terms_version: string;
      authorization_text: string | null;
      success_fee_basis_points: number;
      minimum_fee_minor: string;
      maximum_fee_minor: string;
      currency: string;
      authorized_at: Date;
      revoked_at: Date | null;
    }>(
            `select grant_record.id, grant_record.action_case_id, grant_record.authorized_by_user_id,
                    grant_record.action, grant_record.scope, grant_record.authorization_version,
                    grant_record.terms_version, grant_record.authorization_text,
                    grant_record.success_fee_basis_points, grant_record.minimum_fee_minor::text,
                    grant_record.maximum_fee_minor::text, action_case.currency,
                    grant_record.authorized_at, grant_record.revoked_at
             from action_authorizations grant_record
             join action_cases action_case
               on action_case.workspace_id = grant_record.workspace_id
              and action_case.id = grant_record.action_case_id
             where grant_record.workspace_id = $1
             order by grant_record.authorized_at asc, grant_record.id asc
       limit $2`,
      [input.workspaceId, exportRowLimits.actionAuthorizations + 1],
    ),
    query<{
      id: string;
      action_case_id: string;
      previous_status: string | null;
      status: string;
      actor_kind: string;
      actor_user_id: string | null;
      reason_code: string;
      occurred_at: Date;
    }>(
      `select id, action_case_id, previous_status, status, actor_kind,
              actor_user_id, reason_code, occurred_at
       from action_case_events
       where workspace_id = $1
       order by occurred_at asc, id asc
       limit $2`,
      [input.workspaceId, exportRowLimits.actionCaseEvents + 1],
    ),
    query<{
      id: string;
      action_case_id: string;
      ordinal: number;
      expected_debit_on: Date | string;
      window_start_on: Date | string;
      window_end_on: Date | string;
      source_id: string | null;
      status: string;
      observed_transaction_id: string | null;
      coverage_confirmed_at: Date | null;
      evaluated_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `select id, action_case_id, ordinal, expected_debit_on, window_start_on,
              window_end_on, source_id, status, observed_transaction_id,
              coverage_confirmed_at, evaluated_at, created_at, updated_at
       from saving_verification_windows
       where workspace_id = $1
       order by action_case_id asc, ordinal asc
       limit $2`,
      [input.workspaceId, exportRowLimits.verificationWindows + 1],
    ),
    query<{
      id: string;
      action_case_id: string;
      status: string;
      currency: string;
      baseline_monthly_amount: string;
      current_monthly_amount: string;
      verified_monthly_saving: string;
      verified_annual_saving: string;
      clean_cycles: number;
      required_clean_cycles: number;
      coverage_start_on: Date | string;
      coverage_end_on: Date | string;
      proof_version: string;
      evidence_manifest: Record<string, unknown>;
      receipt_hash: string;
      supersedes_receipt_id: string | null;
      minted_at: Date;
      updated_at: Date;
    }>(
      `select id, action_case_id, status, currency, baseline_monthly_amount::text,
              current_monthly_amount::text, verified_monthly_saving::text,
              verified_annual_saving::text, clean_cycles, required_clean_cycles,
              coverage_start_on, coverage_end_on, proof_version, evidence_manifest,
              receipt_hash, supersedes_receipt_id, minted_at, updated_at
       from verified_saving_receipts
       where workspace_id = $1
       order by minted_at asc, id asc
       limit $2`,
      [input.workspaceId, exportRowLimits.savingReceipts + 1],
    ),
    query<{
      id: string;
      action_case_id: string;
      verified_saving_receipt_id: string;
      checkout_session_id: string | null;
      offer_id: string;
      offer_version: number;
      terms_version: string;
      success_fee_basis_points: number;
      amount_minor: string;
      currency: string;
      status: string;
      review_available_until: Date;
      paid_at: Date | null;
      disputed_at: Date | null;
      voided_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `select id, action_case_id, verified_saving_receipt_id, checkout_session_id,
              offer_id, offer_version, terms_version, success_fee_basis_points,
              amount_minor::text, currency, status, review_available_until,
              paid_at, disputed_at, voided_at, created_at, updated_at
       from success_fee_invoices
       where workspace_id = $1
       order by created_at asc, id asc
       limit $2`,
      [input.workspaceId, exportRowLimits.successFeeInvoices + 1],
    ),
    query<{
      id: string;
      user_id: string | null;
      action: string;
      entity_type: string;
      entity_id: string | null;
      metadata: Record<string, unknown>;
      created_at: Date;
    }>(
      `select id, user_id, action, entity_type, entity_id, metadata, created_at
       from audit_log
       where workspace_id = $1
       order by created_at asc
       limit $2`,
      [input.workspaceId, exportRowLimits.auditHistory + 1],
    ),
  ]);

  assertWithinExportLimit("consents", consentResult.rows.length);
  assertWithinExportLimit("connectedSources", sourceResult.rows.length);
  assertWithinExportLimit("dataSources", dataSourceResult.rows.length);
  assertWithinExportLimit("uploadedFiles", uploadedFileResult.rows.length);
  assertWithinExportLimit("transactions", transactionResult.rows.length);
  assertWithinExportLimit("recurringLedger", recurringResult.rows.length);
  assertWithinExportLimit("evidence", evidenceResult.rows.length);
  assertWithinExportLimit("decisions", decisionResult.rows.length);
  assertWithinExportLimit("recommendations", recommendationResult.rows.length);
  const recovery = recoveryResult.rows[0];
  if (!recovery) throw new Error("Recovery privacy export query returned no row.");
  for (const records of [
    recovery.versions,
    recovery.submissions,
    recovery.sources,
    recovery.commitments,
    recovery.evidence,
    recovery.commitment_evidence,
    recovery.corrections,
    recovery.decisions,
    recovery.changes,
    recovery.inbound_aliases,
    recovery.inbound_events,
    recovery.inbound_sender_assessments,
    recovery.standing_mandates,
    recovery.action_candidates,
    recovery.covered_windows,
    recovery.fee_ledger,
    recovery.billing_year_anchors,
    recovery.mandate_events,
    recovery.classification_snapshots,
    recovery.candidate_events,
    recovery.veto_notices,
    recovery.execution_attempts,
    recovery.executions,
    recovery.operator_actions,
    recovery.notice_delivery_events,
    recovery.dead_letters,
    recovery.provider_controls,
    recovery.connected_mandate_cohort,
    recovery.source_disconnections,
  ]) {
    assertWithinExportLimit("recoveryRecords", records.length);
  }
  assertWithinExportLimit("productEvents", productEventResult.rows.length);
  assertWithinExportLimit("renewalAlertPreferences", renewalPreferenceResult.rows.length);
  assertWithinExportLimit("renewalAlertDeliveries", renewalDeliveryResult.rows.length);
  assertWithinExportLimit("weeklyDigestDeliveries", weeklyDigestDeliveryResult.rows.length);
  assertWithinExportLimit("apiTokens", apiTokenResult.rows.length);
  assertWithinExportLimit("billingCheckouts", billingCheckoutResult.rows.length);
  assertWithinExportLimit("assistedAuditOrders", assistedAuditOrderResult.rows.length);
  assertWithinExportLimit("billingRefunds", billingRefundResult.rows.length);
  assertWithinExportLimit("entitlements", entitlementResult.rows.length);
  assertWithinExportLimit("proofNodes", proofNodeResult.rows.length);
  assertWithinExportLimit("proofEdges", proofEdgeResult.rows.length);
  assertWithinExportLimit("confidenceExplanations", confidenceResult.rows.length);
  assertWithinExportLimit("ledgerEvents", ledgerEventResult.rows.length);
  assertWithinExportLimit("actionCases", actionCaseResult.rows.length);
  assertWithinExportLimit("actionAuthorizations", actionAuthorizationResult.rows.length);
  assertWithinExportLimit("actionCaseEvents", actionCaseEventResult.rows.length);
  assertWithinExportLimit("verificationWindows", verificationWindowResult.rows.length);
  assertWithinExportLimit("savingReceipts", savingReceiptResult.rows.length);
  assertWithinExportLimit("successFeeInvoices", successFeeInvoiceResult.rows.length);
  assertWithinExportLimit("auditHistory", auditResult.rows.length);

  return buildPrivacyExportDocument({
    requestId: input.requestId,
    generatedAt: new Date().toISOString(),
    scope: { userId: input.actorUserId, workspaceId: input.workspaceId },
    account: {
      id: account.user_id,
      email: account.email,
      displayName: account.display_name,
      createdAt: account.user_created_at.toISOString(),
      updatedAt: account.user_updated_at.toISOString(),
    },
    workspace: {
      id: account.workspace_id,
      name: account.workspace_name,
      plan: account.plan,
      workspaceType: account.workspace_type,
      role: input.role,
      createdAt: account.workspace_created_at.toISOString(),
      updatedAt: account.workspace_updated_at.toISOString(),
    },
    retentionPolicy: {
      rawConnectorPayloadDays: policy.rawConnectorPayloadDays,
      productEventDays: policy.productEventDays,
      operationalErrorDays: policy.operationalErrorDays,
      usesWorkspaceOverride: policy.usesWorkspaceOverride,
    },
    consents: consentResult.rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      purpose: row.purpose,
      noticeVersion: row.notice_version,
      source: row.source,
      scopes: row.scopes,
      grantedAt: row.granted_at.toISOString(),
      withdrawnAt: row.withdrawn_at?.toISOString() ?? null,
      expiresAt: row.expires_at?.toISOString() ?? null,
    })),
    connectedSources: sourceResult.rows.map(mapConnectedSource),
    dataSources: dataSourceResult.rows.map((row) => ({
      id: row.id,
      externalReference: row.external_reference,
      kind: row.kind,
      provider: row.provider,
      displayName: row.display_name,
      consentScope: row.consent_scope,
      status: row.status,
      lastSyncedAt: toIso(row.last_synced_at),
      coverageStartAt: toIso(row.coverage_start_at),
      coverageEndAt: toIso(row.coverage_end_at),
      coverageCompleteness: row.coverage_completeness,
      freshnessStatus: row.freshness_status,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    })),
    uploadedFiles: uploadedFileResult.rows.map((row) => ({
      id: row.id,
      dataSourceId: row.source_id,
      fileName: row.file_name,
      mimeType: row.mime_type,
      byteSize: Number(row.byte_size),
      encrypted: row.encrypted,
      parsedAt: toIso(row.parsed_at),
      deletedAt: toIso(row.deleted_at),
      createdAt: row.created_at.toISOString(),
    })),
    transactions: transactionResult.rows.map((row) => ({
      id: row.id,
      dataSourceId: row.source_id,
      uploadedFileId: row.uploaded_file_id,
      transactionDate: toDateOnly(row.transaction_date),
      description: row.description,
      normalizedMerchant: row.normalized_merchant,
      category: row.category,
      amount: Number(row.amount),
      currency: row.currency,
      direction: row.direction,
      externalReference: row.external_reference,
      createdAt: row.created_at.toISOString(),
    })),
    recurringLedger: recurringResult.rows.map(mapRecurringItem),
    evidence: evidenceResult.rows.map(mapEvidence),
    decisions: decisionResult.rows.map((row) => ({
      id: row.id,
      recurringItemId: row.recurring_item_id,
      decidedByUserId: row.decided_by_user_id,
      action: row.action,
      decidedAt: row.decided_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    })),
    recommendations: recommendationResult.rows.map((row) => ({
      id: row.id,
      recurringItemId: row.recurring_item_id,
      recommendationType: row.recommendation_type,
      reason: row.reason,
      estimatedMonthlySavings: Number(row.estimated_monthly_savings),
      estimatedMonthlySavingsCurrency: row.currency,
      confidenceScore: row.confidence_score,
      acceptedAt: toIso(row.accepted_at),
      dismissedAt: toIso(row.dismissed_at),
      createdAt: row.created_at.toISOString(),
    })),
    workspaceState: mapWorkspaceState(workspaceStateResult.rows[0], input.workspaceId),
    recovery: {
      workspaceState: recovery.workspace_state,
      versions: recovery.versions,
      submissions: recovery.submissions,
      sources: recovery.sources,
      commitments: recovery.commitments,
      evidence: recovery.evidence,
      commitmentEvidence: recovery.commitment_evidence,
      corrections: recovery.corrections,
      decisions: recovery.decisions,
      changes: recovery.changes,
      inboundAliases: recovery.inbound_aliases,
      inboundEvents: recovery.inbound_events,
      inboundSenderAssessments: recovery.inbound_sender_assessments,
      standingMandates: recovery.standing_mandates,
      actionCandidates: recovery.action_candidates,
      coveredWindows: recovery.covered_windows,
      feeLedger: recovery.fee_ledger,
      billingYearAnchors: recovery.billing_year_anchors,
      mandateEvents: recovery.mandate_events,
      classificationSnapshots: recovery.classification_snapshots,
      candidateEvents: recovery.candidate_events,
      vetoNotices: recovery.veto_notices,
      executionAttempts: recovery.execution_attempts,
      executions: recovery.executions,
      operatorActions: recovery.operator_actions,
      noticeDeliveryEvents: recovery.notice_delivery_events,
      deadLetters: recovery.dead_letters,
      providerControls: recovery.provider_controls,
      connectedMandateCohort: recovery.connected_mandate_cohort,
      sourceDisconnections: recovery.source_disconnections,
    },
    productEvents: productEventResult.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      eventName: row.event_name,
      occurredAt: row.occurred_at.toISOString(),
      source: row.source,
      status: row.status,
      durationMs: row.duration_ms,
      metrics: row.metrics,
    })),
    renewalAlertPreferences: renewalPreferenceResult.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      consentGrantId: row.consent_grant_id,
      enabled: row.enabled,
      weeklyDigestEnabled: row.weekly_digest_enabled,
      sevenDayEnabled: row.seven_day_enabled,
      oneDayEnabled: row.one_day_enabled,
      timeZone: row.time_zone,
      sendHourLocal: row.send_hour_local,
      disabledAt: toIso(row.disabled_at),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    })),
    renewalAlertDeliveries: renewalDeliveryResult.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      preferenceId: row.preference_id,
      consentGrantId: row.consent_grant_id,
      recurringItemId: row.recurring_item_id,
      recoveryCommitmentId: row.recovery_commitment_id,
      alertWindow: row.alert_window,
      renewalDate: toDateOnly(row.renewal_date),
      scheduledFor: row.scheduled_for.toISOString(),
      status: row.status,
      attemptCount: row.attempt_count,
      nextAttemptAt: toIso(row.next_attempt_at),
      sentAt: toIso(row.sent_at),
      lastErrorCode: row.last_error_code,
      lastErrorAt: toIso(row.last_error_at),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    })),
    weeklyDigestDeliveries: weeklyDigestDeliveryResult.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      preferenceId: row.preference_id,
      consentGrantId: row.consent_grant_id,
      weekStart: toDateOnly(row.week_start),
      scheduledFor: row.scheduled_for.toISOString(),
      status: row.status,
      attemptCount: row.attempt_count,
      nextAttemptAt: toIso(row.next_attempt_at),
      sentAt: toIso(row.sent_at),
      lastErrorCode: row.last_error_code,
      lastErrorAt: toIso(row.last_error_at),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    })),
    apiTokens: apiTokenResult.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      name: row.name,
      tokenPrefix: row.token_prefix,
      scopes: row.scopes,
      expiresAt: row.expires_at.toISOString(),
      lastUsedAt: toIso(row.last_used_at),
      revokedAt: toIso(row.revoked_at),
      createdAt: row.created_at.toISOString(),
    })),
    billingCheckouts: billingCheckoutResult.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      plan: row.plan,
      offerId: row.offer_id,
      offerVersion: row.offer_version,
      termsVersion: row.terms_version,
      provider: row.provider,
      status: row.status,
      currency: row.currency,
      amountMinor: Number(row.amount_minor),
      refundedAmountMinor: Number(row.refunded_amount_minor),
      providerCheckoutId: row.provider_checkout_id,
      providerPaymentId: row.provider_payment_id,
      paidAt: toIso(row.paid_at),
      refundedAt: toIso(row.refunded_at),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    })),
    assistedAuditOrders: assistedAuditOrderResult.rows.map((row) => ({
      id: row.id,
      checkoutSessionId: row.checkout_session_id,
      userId: row.user_id,
      leadId: row.lead_id,
      offerId: row.offer_id,
      offerVersion: row.offer_version,
      termsVersion: row.terms_version,
      status: row.status,
      createdAt: row.created_at.toISOString(),
      startedAt: toIso(row.started_at),
      deliveredAt: toIso(row.delivered_at),
      refundedAt: toIso(row.refunded_at),
      updatedAt: row.updated_at.toISOString(),
    })),
    billingRefunds: billingRefundResult.rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      providerRefundId: row.provider_refund_id,
      providerPaymentId: row.provider_payment_id,
      checkoutSessionId: row.checkout_session_id,
      amountMinor: Number(row.amount_minor),
      currency: row.currency,
      status: row.status,
      rejectionCode: row.rejection_code,
      createdAt: row.created_at.toISOString(),
      appliedAt: toIso(row.applied_at),
    })),
    entitlements: entitlementResult.rows.map((row) => ({
      key: row.entitlement_key,
      sourceCheckoutSessionId: row.source_checkout_session_id,
      status: row.status,
      startsAt: row.starts_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      revokedAt: toIso(row.revoked_at),
      updatedAt: row.updated_at.toISOString(),
    })),
    proofGraph: {
      nodes: proofNodeResult.rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        entityReference: row.entity_ref,
        status: row.status,
        createdAt: row.created_at.toISOString(),
        retiredAt: toIso(row.retired_at),
      })),
      edges: proofEdgeResult.rows.map((row) => ({
        id: row.id,
        fromNodeId: row.from_node_id,
        toNodeId: row.to_node_id,
        relationship: row.edge_type,
        validFrom: row.valid_from.toISOString(),
        validTo: toIso(row.valid_to),
        createdByEventId: row.created_by_event_id,
      })),
      confidenceExplanations: confidenceResult.rows.map((row) => ({
        recurringItemId: row.recurring_item_id,
        score: row.score,
        proofDensity: Number(row.proof_density),
        sourceDiversity: Number(row.source_diversity),
        freshness: Number(row.freshness),
        cadenceStability: Number(row.cadence_stability),
        modelVersion: row.model_version,
        graphRevision: Number(row.graph_revision),
        explanation: row.explanation,
        computedAt: row.computed_at.toISOString(),
      })),
      ledgerEvents: ledgerEventResult.rows.map((row) => ({
        id: row.id,
        sequence: Number(row.workspace_sequence),
        eventType: row.event_type,
        schemaVersion: row.schema_version,
        actorUserId: row.actor_user_id,
        entityKind: row.entity_kind,
        entityReference: row.entity_ref,
        details: row.payload,
        previousEventHash: row.previous_event_hash,
        eventHash: row.event_hash,
        occurredAt: row.occurred_at.toISOString(),
      })),
    },
    verifiedOutcomes: {
      actionCases: actionCaseResult.rows.map((row) => ({
        id: row.id,
        recurringItemId: row.recurring_item_id,
        requestedByUserId: row.requested_by_user_id,
        assignedOperatorUserId: row.assigned_operator_user_id,
        action: row.action,
        commitmentClass: row.commitment_class,
        status: row.status,
        currency: row.currency,
        baselineMonthlyAmount: Number(row.baseline_monthly_amount),
        baselineAnnualAmount: Number(row.baseline_annual_amount),
        targetMonthlyAmount: row.target_monthly_amount === null ? null : Number(row.target_monthly_amount),
        maximumSuccessFeeMinor: Number(row.maximum_success_fee_minor),
        failureCode: row.failure_code,
        authorizedAt: toIso(row.authorized_at),
        executionStartedAt: toIso(row.execution_started_at),
        executedAt: toIso(row.executed_at),
        verificationStartedAt: toIso(row.verification_started_at),
        verifiedAt: toIso(row.verified_at),
        withdrawnAt: toIso(row.withdrawn_at),
        disputedAt: toIso(row.disputed_at),
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      })),
      authorizations: actionAuthorizationResult.rows.map((row) => ({
        id: row.id,
        actionCaseId: row.action_case_id,
        authorizedByUserId: row.authorized_by_user_id,
        action: row.action,
        scope: row.scope,
        authorizationVersion: row.authorization_version,
        termsVersion: row.terms_version,
        authorizationText: row.authorization_text,
        successFeeBasisPoints: row.success_fee_basis_points,
        minimumFeeMinor: Number(row.minimum_fee_minor),
        maximumFeeMinor: Number(row.maximum_fee_minor),
        currency: row.currency,
        authorizedAt: row.authorized_at.toISOString(),
        revokedAt: toIso(row.revoked_at),
      })),
      caseEvents: actionCaseEventResult.rows.map((row) => ({
        id: row.id,
        actionCaseId: row.action_case_id,
        previousStatus: row.previous_status,
        status: row.status,
        actorKind: row.actor_kind,
        actorUserId: row.actor_user_id,
        reasonCode: row.reason_code,
        occurredAt: row.occurred_at.toISOString(),
      })),
      verificationWindows: verificationWindowResult.rows.map((row) => ({
        id: row.id,
        actionCaseId: row.action_case_id,
        ordinal: row.ordinal,
        expectedDebitOn: toDateOnly(row.expected_debit_on),
        windowStartOn: toDateOnly(row.window_start_on),
        windowEndOn: toDateOnly(row.window_end_on),
        dataSourceId: row.source_id,
        status: row.status,
        observedTransactionId: row.observed_transaction_id,
        coverageConfirmedAt: toIso(row.coverage_confirmed_at),
        evaluatedAt: toIso(row.evaluated_at),
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      })),
      savingReceipts: savingReceiptResult.rows.map((row) => ({
        id: row.id,
        actionCaseId: row.action_case_id,
        status: row.status,
        currency: row.currency,
        baselineMonthlyAmount: Number(row.baseline_monthly_amount),
        currentMonthlyAmount: Number(row.current_monthly_amount),
        verifiedMonthlySaving: Number(row.verified_monthly_saving),
        verifiedAnnualSaving: Number(row.verified_annual_saving),
        cleanCycles: row.clean_cycles,
        requiredCleanCycles: row.required_clean_cycles,
        coverageStartOn: toDateOnly(row.coverage_start_on),
        coverageEndOn: toDateOnly(row.coverage_end_on),
        proofVersion: row.proof_version,
        evidenceManifest: row.evidence_manifest,
        receiptHash: row.receipt_hash,
        supersedesReceiptId: row.supersedes_receipt_id,
        mintedAt: row.minted_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      })),
      successFeeInvoices: successFeeInvoiceResult.rows.map((row) => ({
        id: row.id,
        actionCaseId: row.action_case_id,
        verifiedSavingReceiptId: row.verified_saving_receipt_id,
        checkoutSessionId: row.checkout_session_id,
        offerId: row.offer_id,
        offerVersion: row.offer_version,
        termsVersion: row.terms_version,
        successFeeBasisPoints: row.success_fee_basis_points,
        amountMinor: Number(row.amount_minor),
        currency: row.currency,
        status: row.status,
        reviewAvailableUntil: row.review_available_until.toISOString(),
        paidAt: toIso(row.paid_at),
        disputedAt: toIso(row.disputed_at),
        voidedAt: toIso(row.voided_at),
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      })),
    },
    auditHistory: auditResult.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      metadata: row.metadata,
      createdAt: row.created_at.toISOString(),
    })),
  });
}

async function readRetentionPolicy(client: PoolClient, workspaceId: string): Promise<WorkspaceRetentionPolicyDto> {
  const result = await client.query<RetentionPolicyRow>(
    `select workspace_id, raw_connector_payload_days, product_event_days,
            operational_error_days, updated_at
     from workspace_retention_policies
     where workspace_id = $1`,
    [workspaceId],
  );
  const row = result.rows[0];
  return row ? mapRetentionPolicy(row, true) : {
    workspaceId,
    ...retentionPolicyDefaults,
    usesWorkspaceOverride: false,
    updatedAt: null,
    bounds: retentionPolicyBounds,
  };
}

async function assertWorkspaceRole(
  client: PoolClient,
  userId: string,
  workspaceId: string,
  minimumRole: WorkspaceRole,
) {
  const result = await client.query<{ role: WorkspaceRole }>(
    `select wm.role
     from workspace_members wm
     join users u on u.id = wm.user_id and u.deleted_at is null
     where wm.user_id = $1
       and wm.workspace_id = $2
     for share of wm, u`,
    [userId, workspaceId],
  );
  const role = result.rows[0]?.role;
  if (!role || roleRank[role] < roleRank[minimumRole]) throw new PrivacyLifecycleAccessError();
  return { role };
}

function mapRetentionPolicy(row: RetentionPolicyRow, usesWorkspaceOverride: boolean): WorkspaceRetentionPolicyDto {
  return {
    workspaceId: row.workspace_id,
    rawConnectorPayloadDays: row.raw_connector_payload_days,
    productEventDays: row.product_event_days,
    operationalErrorDays: row.operational_error_days,
    usesWorkspaceOverride,
    updatedAt: row.updated_at.toISOString(),
    bounds: retentionPolicyBounds,
  };
}

function mapDataSubjectRequest(row: DataSubjectRequestRow): DataSubjectRequestDto {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    requestType: row.request_type,
    status: row.status,
    requestedAt: row.requested_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
    downloadExpiresAt: row.download_expires_at.toISOString(),
    lastDownloadedAt: row.last_downloaded_at?.toISOString() ?? null,
    downloadCount: row.download_count,
    failureCode: row.failure_code,
  };
}

function mapConnectedSource(row: ConnectedSourceExportRow): PrivacyExportConnectedSource {
  return {
    connectedAccountId: row.id,
    dataSourceId: row.source_id,
    connectorId: row.connector_id,
    authType: row.auth_type,
    providerAccountId: row.provider_account_id,
    displayName: row.display_name,
    scopes: row.scopes,
    status: row.status,
    consentExpiresAt: row.consent_expires_at?.toISOString() ?? null,
    lastSyncedAt: row.last_synced_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    source: {
      kind: row.kind,
      provider: row.provider,
      displayName: row.source_display_name,
      consentScope: row.consent_scope,
      status: row.source_status,
      coverageStartAt: row.coverage_start_at?.toISOString() ?? null,
      coverageEndAt: row.coverage_end_at?.toISOString() ?? null,
      coverageCompleteness: row.coverage_completeness,
      freshnessStatus: row.freshness_status,
    },
  };
}

function mapRecurringItem(row: RecurringExportRow): PrivacyExportRecurringItem {
  return {
    id: row.id,
    merchant: row.merchant,
    normalizedMerchant: row.normalized_merchant,
    category: row.category,
    frequency: row.frequency,
    currency: row.currency,
    amountMin: Number(row.amount_min),
    amountMax: Number(row.amount_max),
    averageAmount: Number(row.average_amount),
    monthlyCost: Number(row.monthly_cost),
    annualCost: Number(row.annual_cost),
    lastChargeDate: toDateOnly(row.last_charge_date),
    nextExpectedDate: toDateOnly(row.next_expected_date),
    confidenceScore: row.confidence_score,
    status: row.status,
    recommendationReason: row.recommendation_reason,
    riskTags: row.risk_tags,
    firstDetectedAt: row.first_detected_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapEvidence(row: EvidenceExportRow): PrivacyExportEvidence {
  return {
    id: row.id,
    connectedAccountId: row.connected_account_id,
    dataSourceId: row.source_id,
    recurringItemId: row.recurring_item_id,
    connectorId: row.connector_id,
    provider: row.provider,
    evidenceType: row.evidence_type,
    observedAt: row.observed_at.toISOString(),
    amount: row.amount === null ? null : Number(row.amount),
    currency: row.currency,
    cadenceHint: row.cadence_hint,
    nextDebitHint: toDateOnly(row.next_debit_hint),
    confidenceScore: row.confidence_score,
    createdAt: row.created_at.toISOString(),
  };
}

function mapWorkspaceState(
  row: {
    encrypted_snapshot: { encrypted?: boolean; payload?: EncryptedSecret };
    revision: string;
    updated_at: Date;
  } | undefined,
  workspaceId: string,
) {
  if (!row) return null;
  if (!row.encrypted_snapshot?.encrypted || !row.encrypted_snapshot.payload) {
    throw new Error("Workspace state is not encrypted.");
  }
  const plaintext = decryptSecret(
    row.encrypted_snapshot.payload,
    `vognary-audit-snapshot:${workspaceId}`,
  );
  const parsed = JSON.parse(plaintext) as Record<string, unknown>;
  return {
    revision: Number(row.revision),
    updatedAt: row.updated_at.toISOString(),
    state: projectWorkspaceState(parsed),
  };
}

function projectWorkspaceState(value: Record<string, unknown>) {
  return {
    version: value.version,
    exportedAt: value.exportedAt ?? null,
    statementSources: Array.isArray(value.statementSources)
      ? value.statementSources.map((source) => projectRecord(source, ["id", "name", "text", "rowCount", "kind", "warnings"]))
      : [],
    manualItems: Array.isArray(value.manualItems)
      ? value.manualItems.map((item) => projectRecord(item, [
        "id",
        "canonicalRecurringItemId",
        "merchant",
        "amount",
        "currency",
        "frequency",
        "nextExpectedDate",
        "category",
        "sourceName",
      ]))
      : [],
    userActions: projectMap(value.userActions),
    itemOwners: projectMap(value.itemOwners),
    reviewNotes: projectMap(value.reviewNotes),
    teamMembers: Array.isArray(value.teamMembers)
      ? value.teamMembers.map((member) => projectRecord(member, ["id", "name", "role"]))
      : [],
    receiptText: typeof value.receiptText === "string" ? value.receiptText : "",
    actionsMeta: projectMap(value.actionsMeta),
    mergeDecisions: projectMap(value.mergeDecisions),
    lastReview: value.lastReview ?? null,
    reviewCompletedAt: value.reviewCompletedAt ?? null,
  };
}

function projectRecord(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return Object.fromEntries(keys.filter((key) => key in record).map((key) => [key, record[key]]));
}

function projectMap(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function assertWithinExportLimit(collection: keyof typeof exportRowLimits, length: number) {
  if (length > exportRowLimits[collection]) throw new PrivacyExportTooLargeError(collection);
}

function policyValues(policy: RetentionPolicyValues) {
  return {
    rawConnectorPayloadDays: policy.rawConnectorPayloadDays,
    productEventDays: policy.productEventDays,
    operationalErrorDays: policy.operationalErrorDays,
  };
}

function toDateOnly(value: Date | string | null) {
  if (!value) return null;
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

function toIso(value: Date | null) {
  return value?.toISOString() ?? null;
}

function createSequentialQuery(client: PoolClient) {
  let queue: Promise<unknown> = Promise.resolve();
  return function query<Row extends QueryResultRow>(text: string, values?: unknown[]) {
    const result = queue.then(() => client.query<Row>(text, values));
    queue = result.then(() => undefined, () => undefined);
    return result;
  };
}

type RetentionPolicyRow = {
  workspace_id: string;
  raw_connector_payload_days: number;
  product_event_days: number;
  operational_error_days: number;
  updated_at: Date;
};

type DataSubjectRequestRow = {
  id: string;
  workspace_id: string | null;
  request_type: "access_export";
  status: "ready" | "completed" | "failed" | "expired";
  requested_at: Date;
  completed_at: Date | null;
  download_expires_at: Date;
  last_downloaded_at: Date | null;
  download_count: number;
  failure_code: string | null;
};

type AccountWorkspaceRow = {
  user_id: string;
  email: string;
  display_name: string | null;
  user_created_at: Date;
  user_updated_at: Date;
  workspace_id: string;
  workspace_name: string;
  plan: string;
  workspace_type: string;
  workspace_created_at: Date;
  workspace_updated_at: Date;
};

type RecoveryExportRow = {
  workspace_state: Record<string, unknown> | null;
  versions: Array<Record<string, unknown>>;
  submissions: Array<Record<string, unknown>>;
  sources: Array<Record<string, unknown>>;
  commitments: Array<Record<string, unknown>>;
  evidence: Array<Record<string, unknown>>;
  commitment_evidence: Array<Record<string, unknown>>;
  corrections: Array<Record<string, unknown>>;
  decisions: Array<Record<string, unknown>>;
  changes: Array<Record<string, unknown>>;
  inbound_aliases: Array<Record<string, unknown>>;
  inbound_events: Array<Record<string, unknown>>;
  inbound_sender_assessments: Array<Record<string, unknown>>;
  standing_mandates: Array<Record<string, unknown>>;
  action_candidates: Array<Record<string, unknown>>;
  covered_windows: Array<Record<string, unknown>>;
  fee_ledger: Array<Record<string, unknown>>;
  billing_year_anchors: Array<Record<string, unknown>>;
  mandate_events: Array<Record<string, unknown>>;
  classification_snapshots: Array<Record<string, unknown>>;
  candidate_events: Array<Record<string, unknown>>;
  veto_notices: Array<Record<string, unknown>>;
  execution_attempts: Array<Record<string, unknown>>;
  executions: Array<Record<string, unknown>>;
  operator_actions: Array<Record<string, unknown>>;
  notice_delivery_events: Array<Record<string, unknown>>;
  dead_letters: Array<Record<string, unknown>>;
  provider_controls: Array<Record<string, unknown>>;
  connected_mandate_cohort: Array<Record<string, unknown>>;
  source_disconnections: Array<Record<string, unknown>>;
};

type ConsentExportRow = {
  id: string;
  workspace_id: string | null;
  purpose: string;
  notice_version: string;
  source: string;
  scopes: unknown;
  granted_at: Date;
  withdrawn_at: Date | null;
  expires_at: Date | null;
};

type ConnectedSourceExportRow = {
  id: string;
  source_id: string | null;
  connector_id: string;
  auth_type: string;
  provider_account_id: string | null;
  display_name: string;
  scopes: string[];
  status: string;
  consent_expires_at: Date | null;
  last_synced_at: Date | null;
  created_at: Date;
  updated_at: Date;
  kind: string | null;
  provider: string | null;
  source_display_name: string | null;
  consent_scope: string | null;
  source_status: string | null;
  coverage_start_at: Date | null;
  coverage_end_at: Date | null;
  coverage_completeness: string | null;
  freshness_status: string | null;
};

type RecurringExportRow = {
  id: string;
  merchant: string;
  normalized_merchant: string;
  category: string;
  frequency: string;
  currency: string;
  amount_min: string;
  amount_max: string;
  average_amount: string;
  monthly_cost: string;
  annual_cost: string;
  last_charge_date: Date | string | null;
  next_expected_date: Date | string | null;
  confidence_score: number;
  status: string;
  recommendation_reason: string | null;
  risk_tags: string[];
  first_detected_at: Date;
  updated_at: Date;
};

type EvidenceExportRow = {
  id: string;
  connected_account_id: string | null;
  source_id: string | null;
  recurring_item_id: string | null;
  connector_id: string;
  provider: string;
  evidence_type: string;
  observed_at: Date;
  amount: string | null;
  currency: string | null;
  cadence_hint: string | null;
  next_debit_hint: Date | string | null;
  confidence_score: number;
  created_at: Date;
};
