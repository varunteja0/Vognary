/** Honest Autopilot funnel SQL. Counts connected mandates and distinct eligible accounts, not raw ACTIVE/ELIGIBLE rows. */

import { canonicalProvenProviderIds } from "@/lib/recovery/provider-registry";

export const standingMandateConsentPurpose = "standing-mandate-autopilot";

export const currentSourceNotDisconnectedSql = `
not exists (
  select 1 from recovery_source_disconnections disconnected
  where disconnected.workspace_id = source.workspace_id
    and disconnected.source_id = source.id
    and disconnected.reconnected_at is null
)`;

export const currentlyConnectedSourceSql = `
exists (
  select 1
  from recovery_sources source
  join recovery_evidence evidence
    on evidence.workspace_id = source.workspace_id and evidence.source_id = source.id
  where source.workspace_id = mandate.workspace_id
    and ${currentSourceNotDisconnectedSql}
)`;

/** Candidate is current only when every cited snapshot evidence source is still connected. */
export const candidateCitedSourcesCurrentSql = `
cardinality(snapshot.evidence_ids) > 0
and (
  select count(*)
  from unnest(snapshot.evidence_ids) as cited(id)
  join recovery_evidence evidence
    on evidence.workspace_id = candidate.workspace_id and evidence.id = cited.id
  join recovery_sources source
    on source.workspace_id = evidence.workspace_id and source.id = evidence.source_id
  where ${currentSourceNotDisconnectedSql}
) = cardinality(snapshot.evidence_ids)
`;

/** Candidate facts are current only when the bound snapshot is the latest persisted classification. */
export const candidateClassificationCurrentSql = `
snapshot.id = (
  select newer.id
  from recovery_classification_snapshots newer
  where newer.workspace_id = candidate.workspace_id
    and newer.commitment_id = candidate.commitment_id
  order by newer.created_at desc, newer.id desc
  limit 1
)
`;

export const standingMandateConsentExistsSql = `
exists (
  select 1 from consent_grants consent
  where consent.workspace_id = mandate.workspace_id
    and consent.user_id = workspace.owner_user_id
    and consent.purpose = '${standingMandateConsentPurpose}'
    and consent.withdrawn_at is null
    and (consent.expires_at is null or consent.expires_at > now())
)`;

export const connectedActiveMandatesSql = `
select count(distinct mandate.workspace_id)::text as n
from recovery_standing_mandates mandate
join workspaces workspace on workspace.id = mandate.workspace_id
join users owner on owner.id = workspace.owner_user_id and owner.deleted_at is null
where mandate.status = 'ACTIVE'
  and ${currentlyConnectedSourceSql}
  and ${standingMandateConsentExistsSql}
`;

export const currentlyEligibleAccountsSql = `
select count(distinct candidate.workspace_id)::text as n
from recovery_action_candidates candidate
join recovery_standing_mandates mandate
  on mandate.workspace_id = candidate.workspace_id and mandate.id = candidate.mandate_id
join workspaces workspace on workspace.id = candidate.workspace_id
join recovery_classification_snapshots snapshot
  on snapshot.id = candidate.classification_snapshot_id
where candidate.eligibility = 'ELIGIBLE'
  and candidate.status not in ('VETOED', 'REVOKED', 'EXCEPTION', 'FAILED', 'DISPUTED', 'WITHDRAWN', 'VERIFIED')
  and mandate.status = 'ACTIVE'
  and candidate.provider_id = any($1::text[])
  and not exists (
    select 1 from recovery_provider_disables disabled
    where disabled.provider_id = candidate.provider_id and disabled.disabled
  )
  and cardinality(snapshot.evidence_ids) > 0
  and (
    select count(*) from recovery_evidence live
    where live.workspace_id = candidate.workspace_id
      and live.id = any(snapshot.evidence_ids)
  ) = cardinality(snapshot.evidence_ids)
  and ${candidateCitedSourcesCurrentSql}
  and ${candidateClassificationCurrentSql}
  and ${standingMandateConsentExistsSql}
`;


export const d30ConnectedRetentionEligibleSql = `
select count(distinct cohort.workspace_id)::text as n
from recovery_connected_mandate_cohort cohort
where cohort.started_at <= now() - interval '30 days'
`;

export const d30ConnectedRetentionReturnedSql = `
select count(distinct cohort.workspace_id)::text as n
from recovery_connected_mandate_cohort cohort
join recovery_standing_mandates mandate
  on mandate.workspace_id = cohort.workspace_id and mandate.status = 'ACTIVE'
join workspaces workspace on workspace.id = cohort.workspace_id
join users owner on owner.id = workspace.owner_user_id and owner.deleted_at is null
where cohort.started_at <= now() - interval '30 days'
  and ${currentlyConnectedSourceSql}
  and ${standingMandateConsentExistsSql}
`;

export function liveNoticeReady() {
  return process.env.AUTOPILOT_NOTICE_ENABLED === "true"
    && process.env.AUTOPILOT_NOTICE_CHANNEL_READY === "true";
}

/** Same production-safe proven IDs execution uses. Test flags cannot activate production. */
export function liveProvenProviderIds() {
  return canonicalProvenProviderIds();
}

export function unmeasuredD30() {
  return { status: "unmeasured" as const, eligibleWorkspaces: null, returned: null, rate: null };
}

type FunnelClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<{ n?: string; name?: string | null }> }>;
};

export async function queryAutopilotFunnel(client: FunnelClient) {
  const count = async (sql: string, params: unknown[] = []) => Number((await client.query(sql, params)).rows[0]?.n ?? 0);
  const noticeReady = liveNoticeReady();
  const provenProviderIds = liveProvenProviderIds();
  const connectedActiveMandates = await count(connectedActiveMandatesSql);
  const currentlyEligibleAccounts = noticeReady && provenProviderIds.length
    ? await count(currentlyEligibleAccountsSql, [provenProviderIds])
    : 0;
  const cohort = await client.query(
    `select to_regclass('public.recovery_connected_mandate_cohort') as name`,
  );
  if (!cohort.rows[0]?.name) {
    return {
      connectedActiveMandates,
      currentlyEligibleAccounts,
      d30ConnectedRetention: unmeasuredD30(),
    };
  }
  const eligible = await count(d30ConnectedRetentionEligibleSql);
  const returned = await count(d30ConnectedRetentionReturnedSql);
  return {
    connectedActiveMandates,
    currentlyEligibleAccounts,
    d30ConnectedRetention: {
      status: "measured" as const,
      eligibleWorkspaces: eligible,
      returned,
      rate: eligible ? Number((returned / eligible).toFixed(3)) : null,
    },
  };
}
