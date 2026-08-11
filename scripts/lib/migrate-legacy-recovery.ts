import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import { recoveryEvidenceFingerprint } from "../../src/lib/recovery/evidence-fingerprint";
import { decimalToMinorUnits } from "../../src/lib/recovery/domain";
import { redactText } from "../../src/lib/redaction";
import { scheduleRenewalAlertsForWorkspace } from "../../src/lib/server/renewal-alert-store";

const cadenceByFrequency = {
  weekly: "WEEKLY",
  biweekly: "BIWEEKLY",
  semimonthly: "SEMIMONTHLY",
  monthly: "MONTHLY",
  bimonthly: "BIMONTHLY",
  quarterly: "QUARTERLY",
  yearly: "YEARLY",
  irregular: "IRREGULAR",
} as const;

const decisionByLegacyStatus = {
  keep: "KEEP",
  watch: "MONITOR",
  downgrade: "DOWNGRADE",
  cancel: "CANCEL",
  investigate: "INVESTIGATE",
  unknown: "INVESTIGATE",
} as const;

type LegacySource = {
  id: string;
  workspace_id: string;
  coverage_start_at: Date | null;
  coverage_end_at: Date | null;
  created_at: Date;
};

type LegacyItem = {
  id: string;
  workspace_id: string;
  merchant: string;
  normalized_merchant: string;
  category: string;
  frequency: keyof typeof cadenceByFrequency;
  currency: string;
  average_amount: string;
  monthly_cost: string;
  next_expected_date: string | null;
  confidence_score: number;
  status: keyof typeof decisionByLegacyStatus;
  recommendation_reason: string | null;
  risk_tags: string[];
  first_detected_at: Date;
};

type LegacyEvidence = {
  id: string;
  recurring_item_id: string;
  source_id: string;
  evidence_text: string;
  evidence_date: string;
  amount: string;
  created_at: Date;
};

type LegacyDecision = {
  recurring_item_id: string;
  decided_by_user_id: string | null;
  action: Exclude<keyof typeof decisionByLegacyStatus, "unknown">;
  decided_at: Date;
  updated_at: Date;
};

export type LegacyRecoveryMigrationResult = {
  status: "already-clean" | "migrated";
  workspacesMigrated: number;
  sourcesMigrated: number;
  commitmentsMigrated: number;
  evidenceMigrated: number;
  decisionsMigrated: number;
  remindersScheduled: number;
};

export async function migrateLegacyRecovery(pool: Pool): Promise<LegacyRecoveryMigrationResult> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock($1)", [8_668_642_792]);
    await client.query(
      "lock table workspace_states, recurring_items, evidence_links, commitment_decisions, data_sources, transactions, connector_evidence, connected_accounts, action_cases in share row exclusive mode",
    );

    const migration = await client.query(
      `select 1 from schema_migrations where id = '0026_recovery_inbound_retention'`,
    );
    if (!migration.rows[0]) throw new Error("Production must be migrated through 0026 before legacy Recovery materialization.");

    const workspaces = await client.query<{ workspace_id: string; owner_user_id: string }>(
      `select state.workspace_id, workspace.owner_user_id
       from workspace_states state
       join workspaces workspace on workspace.id = state.workspace_id
       order by state.workspace_id`,
    );
    if (!workspaces.rowCount) {
      await assertLegacyAuthorityRemoved(client);
      await client.query("commit");
      return cleanResult();
    }
    const workspaceIds = workspaces.rows.map((row) => row.workspace_id);
    await assertMigrationPreconditions(client, workspaceIds);

    const sources = (await client.query<LegacySource>(
      `select id, workspace_id, coverage_start_at, coverage_end_at, created_at
       from data_sources
       where workspace_id = any($1::uuid[])
       order by workspace_id, created_at, id`,
      [workspaceIds],
    )).rows;
    const items = (await client.query<LegacyItem>(
      `select id, workspace_id, merchant, normalized_merchant, category,
              frequency, currency, average_amount::text, monthly_cost::text,
              next_expected_date::text, confidence_score, status,
              recommendation_reason, risk_tags, first_detected_at
       from recurring_items
       where workspace_id = any($1::uuid[])
       order by workspace_id, first_detected_at, id`,
      [workspaceIds],
    )).rows;
    const evidence = (await client.query<LegacyEvidence>(
      `select link.id, link.recurring_item_id, link.source_id, link.evidence_text,
              link.evidence_date::text, link.amount::text, link.created_at
       from evidence_links link
       join recurring_items item on item.id = link.recurring_item_id
       where item.workspace_id = any($1::uuid[])
       order by item.workspace_id, link.created_at, link.id`,
      [workspaceIds],
    )).rows;
    const decisions = (await client.query<LegacyDecision>(
      `select decision.recurring_item_id, decision.decided_by_user_id,
              decision.action, decision.decided_at, decision.updated_at
       from commitment_decisions decision
       join recurring_items item on item.id = decision.recurring_item_id
       where item.workspace_id = any($1::uuid[])
       order by item.workspace_id, decision.decided_at`,
      [workspaceIds],
    )).rows;

    const sourceByLegacyId = new Map<string, string>();
    const commitmentByLegacyId = new Map<string, string>();
    let remindersScheduled = 0;

    for (const workspace of workspaces.rows) {
      const workspaceSources = sources.filter((source) => source.workspace_id === workspace.workspace_id);
      const workspaceItems = items.filter((item) => item.workspace_id === workspace.workspace_id);
      const workspaceItemIds = new Set(workspaceItems.map((item) => item.id));
      const submissionId = randomUUID();
      const workspaceEvidenceCount = evidence.filter((row) => workspaceItems.some((item) => item.id === row.recurring_item_id)).length;
      const results = workspaceSources.map((source) => ({
        clientRef: `legacy-source:${source.id}`,
        status: "ACCEPTED",
        code: null,
        message: null,
      }));

      await client.query(
        `insert into recovery_submissions (
           id, workspace_id, submitted_by_user_id, source_type,
           accepted_evidence_count, results
         ) values ($1, $2, $3, 'RECEIPT_PASTE', $4, $5::jsonb)`,
        [submissionId, workspace.workspace_id, workspace.owner_user_id, workspaceEvidenceCount, JSON.stringify(results)],
      );

      for (const source of workspaceSources) {
        const recoverySourceId = randomUUID();
        sourceByLegacyId.set(source.id, recoverySourceId);
        await client.query(
          `insert into recovery_sources (
             id, workspace_id, submission_id, source_type, client_ref, label,
             content_hash, raw_evidence, raw_minimized_at, coverage_start,
             coverage_end, ingested_at
           ) values ($1, $2, $3, 'RECEIPT_PASTE', $4, 'Migrated billing evidence',
             $5, '{}'::jsonb, now(), $6, $7, $8)`,
          [
            recoverySourceId,
            workspace.workspace_id,
            submissionId,
            `legacy-source:${source.id}`,
            sha256(`legacy-source\0${workspace.workspace_id}\0${source.id}`),
            dateOnly(source.coverage_start_at),
            dateOnly(source.coverage_end_at),
            source.created_at,
          ],
        );
      }

      const itemRecords: Array<{
        id: string;
        version: number;
        status: "ACTIVE";
        merchant: string;
        category: string;
        cadence: (typeof cadenceByFrequency)[keyof typeof cadenceByFrequency];
        currency: string;
        amountMinor: string;
        monthlyEquivalentMinor: string;
        nextExpectedDate: string | null;
        evidenceIds: string[];
      }> = [];

      for (const item of workspaceItems) {
        const commitmentId = randomUUID();
        commitmentByLegacyId.set(item.id, commitmentId);
        const cadence = cadenceByFrequency[item.frequency];
        if (!cadence) throw new Error(`Unsupported legacy cadence for recurring item ${item.id}.`);
        const merchant = boundedRedacted(item.merchant, 240);
        const normalizedMerchant = boundedRedacted(item.normalized_merchant, 240);
        const amountMinor = decimalToMinorUnits(item.average_amount, item.currency);
        const monthlyMinor = decimalToMinorUnits(item.monthly_cost, item.currency);
        const recommendationReason = boundedRedacted(
          item.recommendation_reason || "Migrated from previously accepted Vognary billing evidence.",
          2_000,
        );
        const recommendedDecision = decisionByLegacyStatus[item.status];
        if (!recommendedDecision) throw new Error(`Unsupported legacy status for recurring item ${item.id}.`);

        await client.query(
          `insert into recovery_commitments (
             id, workspace_id, identity_key, base_status, base_merchant,
             base_category, base_cadence, base_currency, base_amount_minor,
             base_monthly_minor, base_next_expected_date, effective_status,
             effective_merchant, effective_cadence, effective_amount_minor,
             effective_monthly_minor, effective_next_expected_date,
             confidence_score, confidence_reasons, recommended_decision,
             recommendation_reason, risk_tags, first_detected_at, updated_at
           ) values (
             $1, $2, $3, 'ACTIVE', $4, $5, $6, $7, $8, $9, $10,
             'ACTIVE', $4, $6, $8, $9, $10, $11, $12::jsonb, $13, $14,
             $15, $16, now()
           )`,
          [
            commitmentId,
            workspace.workspace_id,
            `legacy:${item.id}`,
            merchant,
            boundedRedacted(item.category, 120),
            cadence,
            item.currency,
            amountMinor,
            monthlyMinor,
            item.next_expected_date,
            item.confidence_score,
            JSON.stringify([recommendationReason]),
            recommendedDecision,
            recommendationReason,
            item.risk_tags,
            item.first_detected_at,
          ],
        );

        const itemEvidence = evidence.filter((row) => row.recurring_item_id === item.id);
        const migratedEvidenceIds: string[] = [];
        for (const [index, row] of itemEvidence.entries()) {
          const sourceId = sourceByLegacyId.get(row.source_id);
          if (!sourceId) throw new Error(`Legacy evidence ${row.id} has no migrated source.`);
          const evidenceId = randomUUID();
          const evidenceAmountMinor = decimalToMinorUnits(row.amount, item.currency);
          const excerpt = boundedRedacted(row.evidence_text, 500);
          const fingerprint = recoveryEvidenceFingerprint({
            sourceId,
            evidenceKind: "RECEIPT",
            rowNumber: index + 1,
            normalizedMerchant,
            amountMinor: evidenceAmountMinor,
            currency: item.currency,
            evidenceDate: row.evidence_date,
            direction: "debit",
            cadenceHint: cadence,
            nextExpectedDate: item.next_expected_date,
          });
          await client.query(
            `insert into recovery_evidence (
               id, workspace_id, source_id, fingerprint, evidence_kind,
               row_number, observed_at, excerpt, excerpt_truncated, merchant,
               normalized_merchant, category, amount_minor, currency,
               evidence_date, direction, cadence_hint, next_expected_date,
               provenance_kind, provenance_reference, confidence_state,
               confidence_score, confidence_reasons, created_at
             ) values (
               $1, $2, $3, $4, 'RECEIPT', $5, $6, $7, $8, $9, $10, $11,
               $12, $13, $14, 'debit', $15, $16, 'USER_SUBMITTED', $17,
               $18, $19, $20::jsonb, $21
             )`,
            [
              evidenceId,
              workspace.workspace_id,
              sourceId,
              fingerprint,
              index + 1,
              `${row.evidence_date}T00:00:00.000Z`,
              excerpt,
              normalizedWhitespace(row.evidence_text).length > excerpt.length,
              merchant,
              normalizedMerchant,
              boundedRedacted(item.category, 120),
              evidenceAmountMinor,
              item.currency,
              row.evidence_date,
              cadence,
              item.next_expected_date,
              `legacy-evidence:${row.id}`,
              confidenceState(item.confidence_score),
              item.confidence_score,
              JSON.stringify(["Migrated from previously accepted Vognary billing evidence."]),
              row.created_at,
            ],
          );
          await client.query(
            `insert into recovery_commitment_evidence (workspace_id, commitment_id, evidence_id, linked_at)
             values ($1, $2, $3, $4)`,
            [workspace.workspace_id, commitmentId, evidenceId, row.created_at],
          );
          migratedEvidenceIds.push(evidenceId);
        }
        itemRecords.push({
          id: commitmentId,
          version: 1,
          status: "ACTIVE",
          merchant,
          category: boundedRedacted(item.category, 120),
          cadence,
          currency: item.currency,
          amountMinor,
          monthlyEquivalentMinor: monthlyMinor,
          nextExpectedDate: item.next_expected_date,
          evidenceIds: migratedEvidenceIds,
        });
      }

      for (const decision of decisions.filter((row) => workspaceItemIds.has(row.recurring_item_id))) {
        const commitmentId = commitmentByLegacyId.get(decision.recurring_item_id)!;
        await client.query(
          `insert into recovery_decisions (
             workspace_id, commitment_id, decided_by_user_id, decision,
             decided_at, updated_at
           ) values ($1, $2, $3, $4, $5, $6)`,
          [
            workspace.workspace_id,
            commitmentId,
            decision.decided_by_user_id,
            decisionByLegacyStatus[decision.action],
            decision.decided_at,
            decision.updated_at,
          ],
        );
      }

      await client.query(
        `insert into recovery_workspace_states (
           workspace_id, version, baseline_version, latest_changed_state
         ) values ($1, 1, 1, 'NO_PRIOR_BASELINE')`,
        [workspace.workspace_id],
      );
      await client.query(
        `insert into recovery_workspace_versions (
           workspace_id, version, actor_user_id, mutation_kind,
           changed_state, from_version, snapshot
         ) values ($1, 1, $2, 'EVIDENCE', 'NO_PRIOR_BASELINE', null, $3::jsonb)`,
        [
          workspace.workspace_id,
          workspace.owner_user_id,
          JSON.stringify({ version: 1, commitments: itemRecords, changeIds: [] }),
        ],
      );
      await client.query(
        `insert into audit_log (workspace_id, user_id, action, entity_type, entity_id, metadata)
         values ($1, $2, 'recovery.legacy_migrated', 'recovery', $1, $3::jsonb)`,
        [
          workspace.workspace_id,
          workspace.owner_user_id,
          JSON.stringify({
            sourcesMigrated: workspaceSources.length,
            commitmentsMigrated: workspaceItems.length,
            evidenceMigrated: workspaceEvidenceCount,
          }),
        ],
      );
    }

    await verifyCanonicalCopy(client, workspaceIds, {
      workspaces: workspaces.rowCount,
      sources: sources.length,
      commitments: items.length,
      evidence: evidence.length,
      decisions: decisions.length,
    });

    await client.query(`delete from recurring_items where workspace_id = any($1::uuid[])`, [workspaceIds]);
    await client.query(`delete from data_sources where workspace_id = any($1::uuid[])`, [workspaceIds]);
    await client.query(`delete from workspace_states where workspace_id = any($1::uuid[])`, [workspaceIds]);

    for (const workspaceId of workspaceIds) {
      const scheduled = await scheduleRenewalAlertsForWorkspace(workspaceId, client);
      remindersScheduled += scheduled.touched;
    }
    await assertLegacyAuthorityRemoved(client);
    await client.query("commit");
    return {
      status: "migrated",
      workspacesMigrated: workspaces.rowCount,
      sourcesMigrated: sources.length,
      commitmentsMigrated: items.length,
      evidenceMigrated: evidence.length,
      decisionsMigrated: decisions.length,
      remindersScheduled,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function assertMigrationPreconditions(client: PoolClient, workspaceIds: string[]) {
  const result = await client.query<{
    unsupported_sources: number;
    incomplete_evidence: number;
    items_without_evidence: number;
    unsupported_actions: number;
    transactions: number;
    connector_evidence: number;
    legacy_connected_accounts: number;
    action_cases: number;
    partial_recovery_rows: number;
  }>(
    `select
       (select count(*)::int from data_sources
         where workspace_id = any($1::uuid[]) and kind <> 'manual_entry') as unsupported_sources,
       (select count(*)::int from evidence_links link
         join recurring_items item on item.id = link.recurring_item_id
         where item.workspace_id = any($1::uuid[])
           and (link.source_id is null or link.amount is null or link.evidence_date is null)) as incomplete_evidence,
       (select count(*)::int from recurring_items item
         where item.workspace_id = any($1::uuid[])
           and not exists (select 1 from evidence_links link where link.recurring_item_id = item.id)) as items_without_evidence,
       (select count(*)::int from commitment_decisions decision
         join recurring_items item on item.id = decision.recurring_item_id
         where item.workspace_id = any($1::uuid[])
           and decision.action not in ('keep', 'watch', 'downgrade', 'cancel', 'investigate')) as unsupported_actions,
       (select count(*)::int from transactions where workspace_id = any($1::uuid[])) as transactions,
       (select count(*)::int from connector_evidence where workspace_id = any($1::uuid[])) as connector_evidence,
       (select count(*)::int from connected_accounts
         where workspace_id = any($1::uuid[])
           and coalesce(metadata ->> 'ledgerAuthority', 'LEGACY') <> 'RECOVERY_V1') as legacy_connected_accounts,
       (select count(*)::int from action_cases where workspace_id = any($1::uuid[])) as action_cases,
       ((select count(*) from recovery_workspace_states where workspace_id = any($1::uuid[]))
         + (select count(*) from recovery_submissions where workspace_id = any($1::uuid[]))
         + (select count(*) from recovery_sources where workspace_id = any($1::uuid[]))
         + (select count(*) from recovery_commitments where workspace_id = any($1::uuid[]))
         + (select count(*) from recovery_evidence where workspace_id = any($1::uuid[])))::int as partial_recovery_rows`,
    [workspaceIds],
  );
  const state = result.rows[0]!;
  const blockers = Object.entries(state).filter(([, count]) => count !== 0);
  if (blockers.length) {
    throw new Error(`Legacy Recovery migration preconditions failed: ${blockers.map(([name, count]) => `${name}=${count}`).join(", ")}.`);
  }
}

async function verifyCanonicalCopy(
  client: PoolClient,
  workspaceIds: string[],
  expected: { workspaces: number; sources: number; commitments: number; evidence: number; decisions: number },
) {
  const result = await client.query<{
    workspaces: number;
    sources: number;
    commitments: number;
    evidence: number;
    links: number;
    decisions: number;
  }>(
    `select
       (select count(*)::int from recovery_workspace_states where workspace_id = any($1::uuid[])) as workspaces,
       (select count(*)::int from recovery_sources where workspace_id = any($1::uuid[])) as sources,
       (select count(*)::int from recovery_commitments where workspace_id = any($1::uuid[])) as commitments,
       (select count(*)::int from recovery_evidence where workspace_id = any($1::uuid[])) as evidence,
       (select count(*)::int from recovery_commitment_evidence where workspace_id = any($1::uuid[])) as links,
       (select count(*)::int from recovery_decisions where workspace_id = any($1::uuid[])) as decisions`,
    [workspaceIds],
  );
  const actual = result.rows[0]!;
  if (actual.workspaces !== expected.workspaces
    || actual.sources !== expected.sources
    || actual.commitments !== expected.commitments
    || actual.evidence !== expected.evidence
    || actual.links !== expected.evidence
    || actual.decisions !== expected.decisions) {
    throw new Error(`Canonical Recovery copy verification failed: ${JSON.stringify(actual)}.`);
  }
}

async function assertLegacyAuthorityRemoved(client: PoolClient) {
  const result = await client.query<{ legacy_rows: number }>(
    `select ((select count(*) from workspace_states)
      + (select count(*) from recurring_items)
      + (select count(*) from evidence_links)
      + (select count(*) from commitment_decisions)
      + (select count(*) from transactions)
      + (select count(*) from data_sources)
      + (select count(*) from connector_evidence)
      + (select count(*) from connected_accounts
        where coalesce(metadata ->> 'ledgerAuthority', 'LEGACY') <> 'RECOVERY_V1'))::int as legacy_rows`,
  );
  if (result.rows[0]?.legacy_rows !== 0) throw new Error("Legacy live authority remains after Recovery migration.");
}

function cleanResult(): LegacyRecoveryMigrationResult {
  return {
    status: "already-clean",
    workspacesMigrated: 0,
    sourcesMigrated: 0,
    commitmentsMigrated: 0,
    evidenceMigrated: 0,
    decisionsMigrated: 0,
    remindersScheduled: 0,
  };
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function dateOnly(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : null;
}

function normalizedWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function boundedRedacted(value: string, limit: number) {
  const text = normalizedWhitespace(redactText(value).text).slice(0, limit);
  if (!text) throw new Error("Legacy evidence became empty after bounded redaction.");
  return text;
}

function confidenceState(score: number) {
  if (score >= 85) return "HIGH";
  if (score >= 65) return "MEDIUM";
  if (score > 0) return "LOW";
  return "UNKNOWN";
}
