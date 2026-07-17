import "server-only";

import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { CanonicalConnectorObservation, NormalizedConnectorSyncResult } from "@/lib/connector-evidence-normalizer";
import { getDatabasePool } from "@/lib/server/database";
import { recordProductEvent } from "@/lib/server/product-event-store";
import { syncWorkspaceProofGraph } from "@/lib/server/proof-graph-store";
import { scheduleRenewalAlertsForWorkspace } from "@/lib/server/renewal-alert-store";

export type MaterializeConnectorBatchInput = {
  workspaceId: string;
  connectedAccountId: string;
  connectorId: string;
  syncRunId: string;
  batch: NormalizedConnectorSyncResult;
};

export type MaterializeConnectorBatchResult = {
  sourceId: string;
  evidenceWritten: number;
  transactionsWritten: number;
  commitmentsTouched: number;
  usageObservationsWritten: number;
};

type ConnectedAccountRow = {
  id: string;
  source_id: string | null;
  display_name: string;
  scopes: string[];
};

export async function materializeConnectorBatch(
  input: MaterializeConnectorBatchInput,
): Promise<MaterializeConnectorBatchResult> {
  const client = await getDatabasePool().connect();

  try {
    await client.query("begin");
    const account = await lockConnectedAccount(client, input);
    const sourceId = await ensureDataSource(client, input, account);
    const result: MaterializeConnectorBatchResult = {
      sourceId,
      evidenceWritten: 0,
      transactionsWritten: 0,
      commitmentsTouched: 0,
      usageObservationsWritten: 0,
    };

    for (const observation of input.batch.observations) {
      const evidence = await upsertConnectorEvidence(client, input, sourceId, observation);
      const evidenceId = evidence.id;
      result.evidenceWritten += 1;

      const transactionId = observation.materializeTransaction
        ? await upsertTransaction(client, input, sourceId, evidenceId, observation)
        : null;
      if (transactionId) result.transactionsWritten += 1;

      const recurringItemId = observation.materializeCommitment
        ? await upsertRecurringCommitment(client, input, observation, evidence.recurringItemId)
        : null;
      if (recurringItemId) {
        result.commitmentsTouched += 1;
        await linkEvidenceToCommitment(client, sourceId, transactionId, recurringItemId, observation);
        await refreshRecurringCommitmentAmounts(client, recurringItemId);
        await client.query(
          `update connector_evidence
           set recurring_item_id = $1
           where id = $2`,
          [recurringItemId, evidenceId],
        );
      }

      if (observation.materializeUsage) {
        await upsertUsageObservation(client, input, recurringItemId, observation);
        result.usageObservationsWritten += 1;
      }
    }

    await updateSourceFreshness(client, input, sourceId);
    await syncWorkspaceProofGraph({
      workspaceId: input.workspaceId,
      idempotencyKey: `graph:connector-sync:${input.syncRunId}`,
    }, client);
    if (result.commitmentsTouched > 0) {
      await scheduleRenewalAlertsForWorkspace(input.workspaceId, client);
    }
    await recordProductEvent({
      workspaceId: input.workspaceId,
      eventName: "ledger.materialized",
      source: "living-ledger",
      status: "succeeded",
      metrics: {
        recordsSeen: input.batch.observations.length,
        evidenceWritten: result.evidenceWritten,
        transactionsWritten: result.transactionsWritten,
        commitmentsTouched: result.commitmentsTouched,
        usageObservationsWritten: result.usageObservationsWritten,
      },
    }, client);

    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function lockConnectedAccount(client: PoolClient, input: MaterializeConnectorBatchInput) {
  const result = await client.query<ConnectedAccountRow>(
    `select id, source_id, display_name, scopes
     from connected_accounts
     where id = $1
       and workspace_id = $2
       and connector_id = $3
       and status = 'active'
       and exists (
         select 1
         from consent_grants consent
         where consent.id = connected_accounts.consent_grant_id
           and consent.workspace_id = connected_accounts.workspace_id
           and consent.withdrawn_at is null
           and (consent.expires_at is null or consent.expires_at > now())
       )
     for update`,
    [input.connectedAccountId, input.workspaceId, input.connectorId],
  );
  const account = result.rows[0];
  if (!account) throw new Error("Connected account is not active or does not belong to this workspace.");
  return account;
}

async function ensureDataSource(
  client: PoolClient,
  input: MaterializeConnectorBatchInput,
  account: ConnectedAccountRow,
) {
  if (account.source_id) {
    const existing = await client.query<{ id: string }>(
      `select id
       from data_sources
       where id = $1
         and workspace_id = $2
       for update`,
      [account.source_id, input.workspaceId],
    );
    if (!existing.rows[0]) {
      throw new Error("Connected account data source does not belong to this workspace.");
    }
    return existing.rows[0].id;
  }

  const inserted = await client.query<{ id: string }>(
    `insert into data_sources (
       workspace_id,
       kind,
       provider,
       display_name,
       consent_scope,
       status,
       rail_id
     ) values ($1, $2, $3, $4, $5, 'active', $6)
     returning id`,
    [
      input.workspaceId,
      input.connectorId === "gmail-readonly" ? "gmail_receipt" : "cloud_connector",
      input.connectorId,
      account.display_name,
      account.scopes.join(" ") || null,
      input.connectorId === "gmail-readonly" ? "email-receipt" : "cloud-provider",
    ],
  );
  const sourceId = inserted.rows[0]?.id;
  if (!sourceId) throw new Error("Data source insert did not return an id.");

  await client.query(
    `update connected_accounts
     set source_id = $1, updated_at = now()
     where id = $2`,
    [sourceId, account.id],
  );
  return sourceId;
}

async function upsertConnectorEvidence(
  client: PoolClient,
  input: MaterializeConnectorBatchInput,
  sourceId: string,
  observation: CanonicalConnectorObservation,
) {
  const payloadHash = observation.evidence.sourcePayloadHash ?? hashJson(observation.evidence);
  const result = await client.query<{ id: string; recurring_item_id: string | null }>(
    `insert into connector_evidence (
       workspace_id,
       connected_account_id,
       sync_run_id,
       source_id,
       connector_id,
       provider,
       evidence_type,
       external_id,
       observed_at,
       merchant_raw,
       amount,
       currency,
       cadence_hint,
       next_debit_hint,
       confidence_score,
       payload_hash,
       payload
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     on conflict (workspace_id, connector_id, connected_account_id, external_id) where external_id is not null
     do update set
       sync_run_id = excluded.sync_run_id,
       source_id = excluded.source_id,
       provider = excluded.provider,
       evidence_type = excluded.evidence_type,
       observed_at = excluded.observed_at,
       merchant_raw = excluded.merchant_raw,
       amount = excluded.amount,
       currency = excluded.currency,
       cadence_hint = excluded.cadence_hint,
       next_debit_hint = excluded.next_debit_hint,
       confidence_score = excluded.confidence_score,
       payload_hash = excluded.payload_hash,
       payload = case
         when connector_evidence.payload_minimized_at is null then excluded.payload
         else connector_evidence.payload
       end
    returning id, recurring_item_id`,
    [
      input.workspaceId,
      input.connectedAccountId,
      input.syncRunId,
      sourceId,
      input.connectorId,
      observation.evidence.provider,
      observation.evidence.evidenceType,
      observation.externalId,
      observation.observedAt,
      observation.evidence.merchantRaw ?? null,
      observation.amount,
      observation.currency,
      observation.evidence.cadenceHint ?? null,
      observation.nextExpectedDate,
      observation.confidence,
      payloadHash,
      observation.evidence,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Connector evidence upsert did not return an id.");
  return { id: row.id, recurringItemId: row.recurring_item_id };
}

async function upsertTransaction(
  client: PoolClient,
  input: MaterializeConnectorBatchInput,
  sourceId: string,
  evidenceId: string,
  observation: CanonicalConnectorObservation,
) {
  const externalReference = transactionExternalReference(input, observation);
  const result = await client.query<{ id: string }>(
    `insert into transactions (
       workspace_id,
       source_id,
       transaction_date,
       description,
       normalized_merchant,
       category,
       amount,
       currency,
       direction,
       external_reference,
       raw_row
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, 'debit', $9, $10)
     on conflict (workspace_id, source_id, external_reference) where external_reference like 'connector:%'
     do update set
       transaction_date = excluded.transaction_date,
       description = excluded.description,
       normalized_merchant = excluded.normalized_merchant,
       category = excluded.category,
       amount = excluded.amount,
       currency = excluded.currency,
       direction = excluded.direction,
       raw_row = case
         when transactions.raw_row_minimized_at is null then excluded.raw_row
         else transactions.raw_row
       end
     returning id`,
    [
      input.workspaceId,
      sourceId,
      observation.transactionDate,
      observation.merchant,
      observation.normalizedMerchant,
      observation.category,
      observation.amount,
      observation.currency,
      externalReference,
      {
        connectorEvidenceId: evidenceId,
        connectorId: input.connectorId,
        evidenceType: observation.evidence.evidenceType,
      },
    ],
  );
  const transactionId = result.rows[0]?.id;
  if (!transactionId) throw new Error("Canonical transaction upsert did not return an id.");
  return transactionId;
}

async function upsertRecurringCommitment(
  client: PoolClient,
  input: MaterializeConnectorBatchInput,
  observation: CanonicalConnectorObservation,
  existingRecurringItemId: string | null,
) {
  if (existingRecurringItemId) {
    const existing = await client.query<{ id: string }>(
      `update recurring_items
       set merchant = $3,
           normalized_merchant = $4,
           category = $5,
           frequency = $6,
           currency = $7,
           amount_min = least(amount_min, $8),
           amount_max = greatest(amount_max, $8),
           average_amount = $8,
           monthly_cost = $9,
           annual_cost = $10,
           last_charge_date = greatest(last_charge_date, $11),
           next_expected_date = $12,
           confidence_score = greatest(confidence_score, $13),
           risk_tags = array(select distinct unnest(risk_tags || $14::text[])),
           updated_at = now()
       where id = $1
         and workspace_id = $2
       returning id`,
      [
        existingRecurringItemId,
        input.workspaceId,
        observation.merchant,
        observation.normalizedMerchant,
        observation.category,
        observation.frequency,
        observation.currency,
        observation.amount,
        observation.monthlyCost,
        observation.annualCost,
        observation.transactionDate,
        observation.nextExpectedDate,
        observation.confidence,
        ["connector-materialized"],
      ],
    );
    const recurringItemId = existing.rows[0]?.id;
    if (!recurringItemId) throw new Error("Linked recurring commitment does not belong to this workspace.");
    return recurringItemId;
  }

  const externalReference = commitmentExternalReference(input, observation);
  const result = await client.query<{ id: string }>(
    `insert into recurring_items (
       workspace_id,
       external_reference,
       merchant,
       normalized_merchant,
       category,
       frequency,
       currency,
       amount_min,
       amount_max,
       average_amount,
       monthly_cost,
       annual_cost,
       last_charge_date,
       next_expected_date,
       confidence_score,
       status,
       recommendation_reason,
       risk_tags
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $8, $8, $9, $10, $11, $12, $13, 'unknown', $14, $15)
     on conflict (workspace_id, external_reference) where external_reference like 'connector:%'
     do update set
       merchant = excluded.merchant,
       normalized_merchant = excluded.normalized_merchant,
       category = excluded.category,
       frequency = excluded.frequency,
       currency = excluded.currency,
       amount_min = least(recurring_items.amount_min, excluded.amount_min),
       amount_max = greatest(recurring_items.amount_max, excluded.amount_max),
       average_amount = excluded.average_amount,
       monthly_cost = excluded.monthly_cost,
       annual_cost = excluded.annual_cost,
       last_charge_date = greatest(recurring_items.last_charge_date, excluded.last_charge_date),
       next_expected_date = excluded.next_expected_date,
       confidence_score = greatest(recurring_items.confidence_score, excluded.confidence_score),
       risk_tags = array(select distinct unnest(recurring_items.risk_tags || excluded.risk_tags)),
       updated_at = now()
     returning id`,
    [
      input.workspaceId,
      externalReference,
      observation.merchant,
      observation.normalizedMerchant,
      observation.category,
      observation.frequency,
      observation.currency,
      observation.amount,
      observation.monthlyCost,
      observation.annualCost,
      observation.transactionDate,
      observation.nextExpectedDate,
      observation.confidence,
      "Automatically materialized from connector evidence; verify before taking action.",
      ["connector-materialized"],
    ],
  );
  const recurringItemId = result.rows[0]?.id;
  if (!recurringItemId) throw new Error("Recurring commitment upsert did not return an id.");
  return recurringItemId;
}

async function linkEvidenceToCommitment(
  client: PoolClient,
  sourceId: string,
  transactionId: string | null,
  recurringItemId: string,
  observation: CanonicalConnectorObservation,
) {
  await client.query(
    `insert into evidence_links (
       recurring_item_id,
       transaction_id,
       source_id,
       external_reference,
       evidence_type,
       evidence_text,
       evidence_date,
       amount
     ) values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (recurring_item_id, external_reference) where external_reference like 'connector:%'
     do update set
       transaction_id = excluded.transaction_id,
       source_id = excluded.source_id,
       evidence_text = excluded.evidence_text,
       evidence_date = excluded.evidence_date,
       amount = excluded.amount`,
    [
      recurringItemId,
      transactionId,
      sourceId,
      `connector:${hashJson({ sourceId, externalId: observation.externalId })}`,
      observation.evidence.evidenceType,
      `${observation.evidence.provider} ${observation.evidence.evidenceType} evidence`,
      observation.transactionDate,
      observation.amount,
    ],
  );
}

async function refreshRecurringCommitmentAmounts(client: PoolClient, recurringItemId: string) {
  await client.query(
    `with stats as (
       select min(amount) as amount_min,
              max(amount) as amount_max,
              avg(amount) as average_amount
       from evidence_links
       where recurring_item_id = $1
         and amount is not null
     )
     update recurring_items item
     set amount_min = round(stats.amount_min, 2),
         amount_max = round(stats.amount_max, 2),
         average_amount = round(stats.average_amount, 2),
         annual_cost = round(stats.average_amount * case item.frequency
           when 'weekly' then 52
           when 'biweekly' then 26
           when 'semimonthly' then 24
           when 'monthly' then 12
           when 'bimonthly' then 6
           when 'quarterly' then 4
           when 'yearly' then 1
           else 1
         end, 2),
         monthly_cost = round((stats.average_amount * case item.frequency
           when 'weekly' then 52
           when 'biweekly' then 26
           when 'semimonthly' then 24
           when 'monthly' then 12
           when 'bimonthly' then 6
           when 'quarterly' then 4
           when 'yearly' then 1
           else 1
         end) / 12, 2),
         updated_at = now()
     from stats
     where item.id = $1
       and stats.average_amount is not null`,
    [recurringItemId],
  );
}

async function upsertUsageObservation(
  client: PoolClient,
  input: MaterializeConnectorBatchInput,
  recurringItemId: string | null,
  observation: CanonicalConnectorObservation,
) {
  await client.query(
    `insert into usage_observations (
       workspace_id,
       connected_account_id,
       recurring_item_id,
       connector_id,
       provider,
       external_id,
       metric_name,
       metric_value,
       metric_unit,
       window_start,
       window_end,
       payload_hash
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     on conflict (workspace_id, connector_id, connected_account_id, external_id) where external_id is not null
     do update set
       recurring_item_id = excluded.recurring_item_id,
       provider = excluded.provider,
       metric_name = excluded.metric_name,
       metric_value = excluded.metric_value,
       metric_unit = excluded.metric_unit,
       window_start = excluded.window_start,
       window_end = excluded.window_end,
       payload_hash = excluded.payload_hash`,
    [
      input.workspaceId,
      input.connectedAccountId,
      recurringItemId,
      input.connectorId,
      observation.evidence.provider,
      observation.externalId,
      observation.evidence.evidenceType === "cost" ? "cost" : "usage",
      observation.amount,
      observation.evidence.evidenceType === "cost" ? observation.currency : "count",
      input.batch.coverage.startAt ?? observation.observedAt,
      input.batch.coverage.endAt,
      observation.evidence.sourcePayloadHash ?? hashJson(observation.evidence),
    ],
  );
}

async function updateSourceFreshness(client: PoolClient, input: MaterializeConnectorBatchInput, sourceId: string) {
  await client.query(
    `update data_sources
     set coverage_start_at = case
           when $1::timestamptz is null then coverage_start_at
           when coverage_start_at is null then $1::timestamptz
           else least(coverage_start_at, $1::timestamptz)
         end,
         coverage_end_at = greatest(coalesce(coverage_end_at, $2::timestamptz), $2::timestamptz),
         coverage_completeness = $3,
         freshness_status = 'fresh',
         last_synced_at = now(),
         status = 'active',
         updated_at = now()
     where id = $4
       and workspace_id = $5`,
    [
      input.batch.coverage.startAt ?? null,
      input.batch.coverage.endAt,
      input.batch.coverage.completeness,
      sourceId,
      input.workspaceId,
    ],
  );
  await client.query(
    `update connected_accounts
     set last_synced_at = now(), last_error = null, last_error_at = null, updated_at = now()
     where id = $1
       and workspace_id = $2`,
    [input.connectedAccountId, input.workspaceId],
  );
}

function commitmentExternalReference(
  input: MaterializeConnectorBatchInput,
  observation: CanonicalConnectorObservation,
) {
  return `connector:${hashJson({
    connectedAccountId: input.connectedAccountId,
    connectorId: input.connectorId,
    merchant: observation.normalizedMerchant,
    currency: observation.currency,
  })}`;
}

function transactionExternalReference(
  input: MaterializeConnectorBatchInput,
  observation: CanonicalConnectorObservation,
) {
  return `connector:${hashJson({
    connectedAccountId: input.connectedAccountId,
    connectorId: input.connectorId,
    externalId: observation.externalId,
  })}`;
}

function hashJson(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("base64url");
}
