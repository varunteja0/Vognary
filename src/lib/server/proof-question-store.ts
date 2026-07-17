import "server-only";

import { answerProofQuestion, type ProofQuestionCommitment, type ProofQuestionDataset } from "@/lib/proof-questions";
import { getDatabasePool } from "@/lib/server/database";

type CommitmentQuestionRow = {
  id: string;
  merchant: string;
  normalized_merchant: string;
  category: string;
  frequency: string;
  currency: string;
  monthly_cost: string;
  annual_cost: string;
  next_expected_date: string | null;
  last_charge_date: string | null;
  confidence_score: number;
  proof_density: string | null;
  source_diversity: string | null;
  freshness: string | null;
  cadence_stability: string | null;
  evidence_count: number;
  source_names: string[];
  newest_evidence_date: string | null;
};

export async function askWorkspaceProofGraph(workspaceId: string, question: unknown) {
  const pool = getDatabasePool();
  const [commitmentResult, savingResult, revisionResult] = await Promise.all([
    pool.query<CommitmentQuestionRow>(
      `select item.id, item.merchant, item.normalized_merchant, item.category,
              item.frequency, item.currency, item.monthly_cost::text,
              item.annual_cost::text, item.next_expected_date::text,
              item.last_charge_date::text,
              coalesce(confidence.score, item.confidence_score) as confidence_score,
              confidence.proof_density::text, confidence.source_diversity::text,
              confidence.freshness::text, confidence.cadence_stability::text,
              coalesce(proof.evidence_count, 0)::int as evidence_count,
              coalesce(proof.source_names, array[]::text[]) as source_names,
              proof.newest_evidence_date
       from recurring_items item
       left join confidence_explanations confidence
         on confidence.workspace_id = item.workspace_id
        and confidence.recurring_item_id = item.id
       left join lateral (
         select count(*)::int as evidence_count,
                array_remove(array_agg(distinct source.display_name order by source.display_name), null) as source_names,
                max(link.evidence_date)::text as newest_evidence_date
         from evidence_links link
         left join data_sources source on source.id = link.source_id
         where link.recurring_item_id = item.id
       ) proof on true
       where item.workspace_id = $1
       order by item.monthly_cost desc, item.merchant asc
       limit 500`,
      [workspaceId],
    ),
    pool.query<{
      id: string;
      action_case_id: string;
      merchant: string;
      currency: string;
      verified_monthly_saving: string;
      verified_annual_saving: string;
      clean_cycles: number;
      required_clean_cycles: number;
      coverage_start_on: string;
      coverage_end_on: string;
      minted_at: Date;
    }>(
      `select receipt.id, receipt.action_case_id, item.merchant, receipt.currency,
              receipt.verified_monthly_saving::text, receipt.verified_annual_saving::text,
              receipt.clean_cycles, receipt.required_clean_cycles,
              receipt.coverage_start_on::text, receipt.coverage_end_on::text,
              receipt.minted_at
       from verified_saving_receipts receipt
       join action_cases action_case
         on action_case.workspace_id = receipt.workspace_id
        and action_case.id = receipt.action_case_id
       join recurring_items item on item.id = action_case.recurring_item_id
       where receipt.workspace_id = $1 and receipt.status = 'active'
       order by receipt.minted_at desc, receipt.id desc
       limit 500`,
      [workspaceId],
    ),
    pool.query<{ graph_revision: string | null }>(
      `select max(workspace_sequence)::text as graph_revision
       from ledger_events
       where workspace_id = $1`,
      [workspaceId],
    ),
  ]);

  const dataset: ProofQuestionDataset = {
    graphRevision: Number(revisionResult.rows[0]?.graph_revision ?? 0),
    asOf: new Date().toISOString(),
    commitments: commitmentResult.rows.map(mapCommitment),
    savings: savingResult.rows.map((row) => ({
      id: row.id,
      actionCaseId: row.action_case_id,
      merchant: row.merchant,
      currency: row.currency,
      verifiedMonthlySaving: Number(row.verified_monthly_saving),
      verifiedAnnualSaving: Number(row.verified_annual_saving),
      cleanCycles: row.clean_cycles,
      requiredCleanCycles: row.required_clean_cycles,
      coverageStart: row.coverage_start_on,
      coverageEnd: row.coverage_end_on,
      mintedAt: row.minted_at.toISOString(),
    })),
  };
  return answerProofQuestion(question, dataset);
}

function mapCommitment(row: CommitmentQuestionRow): ProofQuestionCommitment {
  return {
    id: row.id,
    merchant: row.merchant,
    normalizedMerchant: row.normalized_merchant,
    category: row.category,
    frequency: row.frequency,
    currency: row.currency,
    monthlyCost: Number(row.monthly_cost),
    annualCost: Number(row.annual_cost),
    nextExpectedDate: row.next_expected_date,
    lastChargeDate: row.last_charge_date,
    confidenceScore: row.confidence_score,
    proofDensity: nullableNumber(row.proof_density),
    sourceDiversity: nullableNumber(row.source_diversity),
    freshness: nullableNumber(row.freshness),
    cadenceStability: nullableNumber(row.cadence_stability),
    evidenceCount: row.evidence_count,
    sourceNames: row.source_names.length ? row.source_names : row.evidence_count ? ["Unattributed evidence"] : [],
    newestEvidenceDate: row.newest_evidence_date,
  };
}

function nullableNumber(value: string | null) {
  return value === null ? null : Number(value);
}
