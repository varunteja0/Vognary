import "server-only";

import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { parseIsoDateOnly } from "@/lib/date-only";
import {
  analyzeStatements,
  normalizeCurrencyCode,
  type Frequency,
  type ManualRecurringInput,
  type RecurringItem,
  type StatementSource,
} from "@/lib/recurring-audit";
import { receiptTextToManualInputs } from "@/lib/receipt-parser";
import { explainProofConfidence } from "@/lib/proof-graph";
import { scheduleRenewalAlertsForWorkspace } from "@/lib/server/renewal-alert-store";

const maxStatementSources = 25;
const maxStatementCharacters = 2_000_000;
const maxManualItems = 500;
const maxReceiptCharacters = 20_000;
const frequencies = new Set<Frequency>([
  "weekly",
  "biweekly",
  "semimonthly",
  "monthly",
  "bimonthly",
  "quarterly",
  "yearly",
  "irregular",
]);

export class WorkspaceStateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceStateValidationError";
  }
}

export async function materializeWorkspaceState(
  client: PoolClient,
  workspaceId: string,
  snapshot: unknown,
) {
  const input = normalizeWorkspaceEvidence(snapshot);
  const receiptItems = receiptTextToManualInputs(input.receiptText);
  const audit = analyzeStatements(input.statementSources, [...input.manualItems, ...receiptItems]);
  const sourceId = await upsertWorkspaceStateSource(client, workspaceId);
  const transactionReferences: string[] = [];
  const recurringReferences: string[] = [];
  const evidenceReferences: string[] = [];
  const transactionIds = new Map<string, string>();

  for (const transaction of audit.transactions) {
    const externalReference = workspaceStateReference({
      type: "transaction",
      source: transaction.source,
      rowNumber: transaction.rowNumber,
      date: transaction.date,
      description: transaction.description,
      amount: transaction.amount,
      currency: transaction.currency,
    });
    transactionReferences.push(externalReference);
    const result = await client.query<{ id: string }>(
      `insert into transactions (
         workspace_id, source_id, transaction_date, description,
         normalized_merchant, category, amount, currency, direction,
         external_reference, raw_row
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
       on conflict (workspace_id, source_id, external_reference)
         where external_reference like 'workspace-state:%'
       do update set transaction_date = excluded.transaction_date,
                     description = excluded.description,
                     normalized_merchant = excluded.normalized_merchant,
                     category = excluded.category,
                     amount = excluded.amount,
                     currency = excluded.currency,
                     direction = excluded.direction,
                     raw_row = excluded.raw_row
       returning id`,
      [
        workspaceId,
        sourceId,
        transaction.date,
        transaction.description,
        transaction.normalizedMerchant,
        transaction.category,
        transaction.amount,
        transaction.currency,
        transaction.direction,
        externalReference,
        JSON.stringify({ source: transaction.source, rowNumber: transaction.rowNumber }),
      ],
    );
    const transactionId = result.rows[0]?.id;
    if (!transactionId) throw new Error("Workspace transaction upsert did not return an id.");
    transactionIds.set(transactionEvidenceKey(transaction), transactionId);
  }

  for (const item of audit.recurringItems) {
    const externalReference = workspaceStateReference({ type: "commitment", identityKey: item.identityKey });
    recurringReferences.push(externalReference);
    const recurringItemId = await upsertRecurringItem(client, workspaceId, externalReference, item);
    const confidence = explainProofConfidence(item);
    await client.query(
      `insert into confidence_explanations (
         recurring_item_id, workspace_id, score, proof_density, source_diversity,
         freshness, cadence_stability, model_version, graph_revision, explanation
       ) values ($1, $2, $3, $4, $5, $6, $7, $8,
                 greatest(1, coalesce((select max(workspace_sequence) from ledger_events where workspace_id = $2), 1)),
                 $9::jsonb)
       on conflict (recurring_item_id)
       do update set score = excluded.score,
                     proof_density = excluded.proof_density,
                     source_diversity = excluded.source_diversity,
                     freshness = excluded.freshness,
                     cadence_stability = excluded.cadence_stability,
                     model_version = excluded.model_version,
                     graph_revision = excluded.graph_revision,
                     explanation = excluded.explanation,
                     computed_at = now()`,
      [
        recurringItemId,
        workspaceId,
        confidence.score,
        confidence.proofDensity,
        confidence.sourceDiversity,
        confidence.freshness,
        confidence.cadenceStability,
        confidence.modelVersion,
        JSON.stringify({ reasons: confidence.reasons }),
      ],
    );

    for (const evidence of item.evidence) {
      const evidenceReference = workspaceStateReference({
        type: "evidence",
        commitment: externalReference,
        source: evidence.source,
        rowNumber: evidence.rowNumber,
        date: evidence.date,
        amount: evidence.amount,
        kind: evidence.kind ?? "observed-charge",
      });
      evidenceReferences.push(evidenceReference);
      await client.query(
        `insert into evidence_links (
           recurring_item_id, transaction_id, source_id, external_reference,
           evidence_type, evidence_text, evidence_date, amount
         ) values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (recurring_item_id, external_reference)
           where external_reference like 'workspace-state:%'
         do update set transaction_id = excluded.transaction_id,
                       source_id = excluded.source_id,
                       evidence_type = excluded.evidence_type,
                       evidence_text = excluded.evidence_text,
                       evidence_date = excluded.evidence_date,
                       amount = excluded.amount`,
        [
          recurringItemId,
          transactionIds.get(transactionEvidenceKey(evidence)) ?? null,
          sourceId,
          evidenceReference,
          evidence.kind === "scheduled" ? "scheduled" : "transaction",
          evidence.description,
          evidence.date,
          evidence.amount,
        ],
      );
    }
  }

  await deleteStaleWorkspaceRows(client, workspaceId, sourceId, {
    transactionReferences,
    recurringReferences,
    evidenceReferences,
  });
  await updateWorkspaceSourceCoverage(client, workspaceId, sourceId, audit.transactions.map((transaction) => transaction.date));
  await scheduleRenewalAlertsForWorkspace(workspaceId, client);

  return {
    transactionsWritten: audit.transactions.length,
    commitmentsWritten: audit.recurringItems.length,
    evidenceWritten: evidenceReferences.length,
  };
}

function normalizeWorkspaceEvidence(snapshot: unknown): {
  statementSources: StatementSource[];
  manualItems: ManualRecurringInput[];
  receiptText: string;
} {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new WorkspaceStateValidationError("Workspace state must be an object.");
  }
  const value = snapshot as Record<string, unknown>;
  if (!Array.isArray(value.statementSources) || value.statementSources.length > maxStatementSources) {
    throw new WorkspaceStateValidationError(`Workspace state supports at most ${maxStatementSources} statement sources.`);
  }
  if (!Array.isArray(value.manualItems) || value.manualItems.length > maxManualItems) {
    throw new WorkspaceStateValidationError(`Workspace state supports at most ${maxManualItems} manual commitments.`);
  }

  const statementSources = value.statementSources.map((source, index) => {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw new WorkspaceStateValidationError(`Statement source ${index + 1} is invalid.`);
    }
    const row = source as Record<string, unknown>;
    const name = boundedText(row.name, 240, `Statement source ${index + 1} name`);
    const text = boundedText(row.text, maxStatementCharacters, `Statement source ${index + 1} text`);
    return { name, text };
  });

  const manualItems = value.manualItems.map((item, index) => normalizeManualItem(item, index));
  const receiptText = typeof value.receiptText === "string" ? value.receiptText.trim() : "";
  if (receiptText.length > maxReceiptCharacters) {
    throw new WorkspaceStateValidationError(`Receipt text exceeds ${maxReceiptCharacters} characters.`);
  }
  return { statementSources, manualItems, receiptText };
}

function normalizeManualItem(value: unknown, index: number): ManualRecurringInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkspaceStateValidationError(`Manual commitment ${index + 1} is invalid.`);
  }
  const item = value as Record<string, unknown>;
  const amount = typeof item.amount === "number" ? item.amount : Number.NaN;
  const frequency = typeof item.frequency === "string" ? item.frequency as Frequency : "irregular";
  if (!Number.isFinite(amount) || amount <= 0 || !frequencies.has(frequency)) {
    throw new WorkspaceStateValidationError(`Manual commitment ${index + 1} has an invalid amount or frequency.`);
  }
  const nextExpectedDate = boundedText(item.nextExpectedDate, 10, `Manual commitment ${index + 1} date`);
  if (!parseIsoDateOnly(nextExpectedDate)) {
    throw new WorkspaceStateValidationError(`Manual commitment ${index + 1} has an invalid calendar date.`);
  }
  const currency = item.currency === undefined ? undefined : normalizeCurrencyCode(item.currency, null);
  if (item.currency !== undefined && !currency) {
    throw new WorkspaceStateValidationError(`Manual commitment ${index + 1} has an invalid currency code.`);
  }
  return {
    id: boundedText(item.id, 240, `Manual commitment ${index + 1} id`),
    canonicalRecurringItemId: typeof item.canonicalRecurringItemId === "string" ? item.canonicalRecurringItemId : undefined,
    merchant: boundedText(item.merchant, 180, `Manual commitment ${index + 1} merchant`),
    amount,
    currency: currency ?? undefined,
    frequency,
    nextExpectedDate,
    category: boundedText(item.category, 100, `Manual commitment ${index + 1} category`),
    sourceName: typeof item.sourceName === "string" ? item.sourceName.trim().slice(0, 240) : undefined,
  };
}

async function upsertWorkspaceStateSource(client: PoolClient, workspaceId: string) {
  const result = await client.query<{ id: string }>(
    `insert into data_sources (
       workspace_id, external_reference, kind, provider, display_name,
       consent_scope, status, freshness_status, rail_id
     ) values ($1, 'workspace-state:evidence', 'manual_entry', 'workspace-state',
               'Workspace uploads and manual evidence', 'user-submitted', 'active', 'fresh', 'manual-proof')
     on conflict (workspace_id, external_reference)
       where external_reference like 'workspace-state:%'
     do update set status = 'active', freshness_status = 'fresh', updated_at = now()
     returning id`,
    [workspaceId],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Workspace data source upsert did not return an id.");
  return id;
}

async function upsertRecurringItem(
  client: PoolClient,
  workspaceId: string,
  externalReference: string,
  item: RecurringItem,
) {
  const result = await client.query<{ id: string }>(
    `insert into recurring_items (
       workspace_id, external_reference, merchant, normalized_merchant, category,
       frequency, currency, amount_min, amount_max, average_amount, monthly_cost,
       annual_cost, last_charge_date, next_expected_date, confidence_score, status,
       recommendation_reason, risk_tags
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     on conflict (workspace_id, external_reference)
       where external_reference like 'workspace-state:%'
     do update set merchant = excluded.merchant,
                   normalized_merchant = excluded.normalized_merchant,
                   category = excluded.category,
                   frequency = excluded.frequency,
                   currency = excluded.currency,
                   amount_min = excluded.amount_min,
                   amount_max = excluded.amount_max,
                   average_amount = excluded.average_amount,
                   monthly_cost = excluded.monthly_cost,
                   annual_cost = excluded.annual_cost,
                   last_charge_date = excluded.last_charge_date,
                   next_expected_date = excluded.next_expected_date,
                   confidence_score = excluded.confidence_score,
                   status = excluded.status,
                   recommendation_reason = excluded.recommendation_reason,
                   risk_tags = excluded.risk_tags,
                   updated_at = now()
     returning id`,
    [
      workspaceId,
      externalReference,
      item.merchant,
      item.normalizedMerchant,
      item.category,
      item.frequency,
      item.currency,
      item.amountMin,
      item.amountMax,
      item.averageAmount,
      item.monthlyCost,
      item.annualCost,
      item.lastChargeDate,
      item.nextExpectedDate,
      item.confidenceScore,
      item.recommendationType,
      item.recommendationReason,
      item.riskTags,
    ],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Workspace recurring item upsert did not return an id.");
  return id;
}

async function deleteStaleWorkspaceRows(
  client: PoolClient,
  workspaceId: string,
  sourceId: string,
  references: {
    transactionReferences: string[];
    recurringReferences: string[];
    evidenceReferences: string[];
  },
) {
  await client.query(
    `delete from evidence_links evidence
     using recurring_items item
     where evidence.recurring_item_id = item.id
       and item.workspace_id = $1
       and evidence.external_reference like 'workspace-state:%'
       and not (evidence.external_reference = any($2::text[]))`,
    [workspaceId, references.evidenceReferences],
  );
  await client.query(
    `delete from recurring_items
     where workspace_id = $1
       and external_reference like 'workspace-state:%'
       and not (external_reference = any($2::text[]))`,
    [workspaceId, references.recurringReferences],
  );
  await client.query(
    `delete from transactions
     where workspace_id = $1
       and source_id = $2
       and external_reference like 'workspace-state:%'
       and not (external_reference = any($3::text[]))`,
    [workspaceId, sourceId, references.transactionReferences],
  );
}

async function updateWorkspaceSourceCoverage(
  client: PoolClient,
  workspaceId: string,
  sourceId: string,
  dates: string[],
) {
  const sorted = [...dates].sort();
  await client.query(
    `update data_sources
     set coverage_start_at = $1::date,
         coverage_end_at = $2::date,
         coverage_completeness = 'partial',
         freshness_status = 'fresh',
         last_synced_at = now(),
         updated_at = now()
     where id = $3 and workspace_id = $4`,
    [sorted[0] ?? null, sorted.at(-1) ?? null, sourceId, workspaceId],
  );
}

function transactionEvidenceKey(evidence: {
  source: string;
  rowNumber: number;
  date: string;
  amount: number;
  description: string;
}) {
  return [
    evidence.source,
    String(evidence.rowNumber),
    evidence.date,
    evidence.amount.toFixed(2),
    evidence.description.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim(),
  ].join("\u0000");
}

function workspaceStateReference(value: unknown) {
  return `workspace-state:${createHash("sha256").update(JSON.stringify(value)).digest("base64url")}`;
}

function boundedText(value: unknown, maxLength: number, label: string) {
  if (typeof value !== "string") throw new WorkspaceStateValidationError(`${label} is required.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new WorkspaceStateValidationError(`${label} must be 1 to ${maxLength} characters.`);
  }
  return normalized;
}
