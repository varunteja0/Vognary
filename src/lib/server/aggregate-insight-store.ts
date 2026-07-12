import "server-only";

import {
  aggregateInsightMaxCommitmentsPerWorkspace,
  aggregateInsightMinimumWorkspaces,
  normalizeAggregateInsight,
} from "@/lib/aggregate-insights";
import { getDatabasePool } from "@/lib/server/database";

type AggregateRow = {
  category: string;
  currency: string;
  frequency: string;
  workspace_count: string;
  commitment_count: string;
  median_monthly_cost: string;
  average_monthly_cost: string;
  as_of_date: string;
};

export async function listPrivacySafeAggregateInsights() {
  const result = await getDatabasePool().query<AggregateRow>(
    `with opted_workspaces as (
       select distinct w.id
       from workspaces w
       join consent_grants consent
         on consent.workspace_id = w.id
        and consent.user_id = w.owner_user_id
        and consent.purpose = 'merchant-intelligence-opt-in'
        and consent.withdrawn_at is null
        and (consent.expires_at is null or consent.expires_at > now())
         ), workspace_contributions as (
      select ri.workspace_id,
        ri.category,
        ri.currency,
        ri.frequency,
        avg(ri.monthly_cost) as workspace_monthly_cost,
        least(count(*), $1)::int as bounded_commitment_count
      from recurring_items ri
      join opted_workspaces opted on opted.id = ri.workspace_id
      where ri.updated_at < date_trunc('day', now())
      group by ri.workspace_id, ri.category, ri.currency, ri.frequency
         )
         select contribution.category,
           contribution.currency,
           contribution.frequency,
           count(*)::text as workspace_count,
           sum(contribution.bounded_commitment_count)::text as commitment_count,
           percentile_cont(0.5) within group (order by contribution.workspace_monthly_cost)::text as median_monthly_cost,
           avg(contribution.workspace_monthly_cost)::text as average_monthly_cost,
           current_date::text as as_of_date
         from workspace_contributions contribution
         group by contribution.category, contribution.currency, contribution.frequency
         having count(*) >= $2
         order by count(*) desc, contribution.category asc
         limit 100`,
        [aggregateInsightMaxCommitmentsPerWorkspace, aggregateInsightMinimumWorkspaces],
  );
  return result.rows.flatMap((row) => {
    const normalized = normalizeAggregateInsight({
      category: row.category,
      currency: row.currency,
      frequency: row.frequency,
      workspaceCount: Number(row.workspace_count),
      commitmentCount: Number(row.commitment_count),
      medianMonthlyCost: Number(row.median_monthly_cost),
      averageMonthlyCost: Number(row.average_monthly_cost),
      asOfDate: row.as_of_date,
    });
    return normalized ? [normalized] : [];
  });
}
