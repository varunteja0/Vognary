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
  productEvents: 5_000,
  renewalAlertPreferences: 500,
  renewalAlertDeliveries: 10_000,
  apiTokens: 500,
  billingCheckouts: 1_000,
  assistedAuditOrders: 1_000,
  billingRefunds: 2_000,
  entitlements: 100,
  auditHistory: 10_000,
};
const maxSerializedExportBytes = 16 * 1024 * 1024;

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
            w.plan, w.created_at as workspace_created_at, w.updated_at as workspace_updated_at
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
    productEventResult,
    renewalPreferenceResult,
    renewalDeliveryResult,
    apiTokenResult,
    billingCheckoutResult,
    assistedAuditOrderResult,
    billingRefundResult,
    entitlementResult,
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
      confidence_score: number;
      accepted_at: Date | null;
      dismissed_at: Date | null;
      created_at: Date;
    }>(
      `select recommendation.id, recommendation.recurring_item_id,
              recommendation.recommendation_type, recommendation.reason,
              recommendation.estimated_monthly_savings,
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
      seven_day_enabled: boolean;
      one_day_enabled: boolean;
      time_zone: string;
      send_hour_local: number;
      disabled_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `select id, user_id, consent_grant_id, enabled, seven_day_enabled,
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
      recurring_item_id: string;
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
  assertWithinExportLimit("productEvents", productEventResult.rows.length);
  assertWithinExportLimit("renewalAlertPreferences", renewalPreferenceResult.rows.length);
  assertWithinExportLimit("renewalAlertDeliveries", renewalDeliveryResult.rows.length);
  assertWithinExportLimit("apiTokens", apiTokenResult.rows.length);
  assertWithinExportLimit("billingCheckouts", billingCheckoutResult.rows.length);
  assertWithinExportLimit("assistedAuditOrders", assistedAuditOrderResult.rows.length);
  assertWithinExportLimit("billingRefunds", billingRefundResult.rows.length);
  assertWithinExportLimit("entitlements", entitlementResult.rows.length);
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
      confidenceScore: row.confidence_score,
      acceptedAt: toIso(row.accepted_at),
      dismissedAt: toIso(row.dismissed_at),
      createdAt: row.created_at.toISOString(),
    })),
    workspaceState: mapWorkspaceState(workspaceStateResult.rows[0], input.workspaceId),
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
  workspace_created_at: Date;
  workspace_updated_at: Date;
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
