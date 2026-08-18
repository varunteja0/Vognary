import "server-only";

import type { PoolClient } from "pg";

import { type ChargeObservation } from "@/lib/recovery/absence";
import { buildAttentionFeed, type AttentionCard } from "@/lib/recovery/attention-feed";
import {
  detectChangeSignals,
  reconcileChangeSignals,
  type ChangeSignal,
  type ChangeSignalKind,
  type ChangeSignalState,
  type CommitmentChangeContext,
  type DuplicateSuspicion,
  type StoredChangeSignal,
} from "@/lib/recovery/change-intelligence";
import { buildCommitmentBelief, type CommitmentBelief } from "@/lib/recovery/commitment-state";
import type { Cadence, SenderTrustTier, SourceType } from "@/lib/recovery/contracts";
import {
  advanceCancellationOutcome,
  type CancellationEvent,
  type CancellationOutcomeState,
} from "@/lib/recovery/cancellation-outcome";
import { buildLearningExample, type CorrectionOutcome } from "@/lib/recovery/correction-learning";
import {
  resolveMerchantIdentity,
  type CanonicalMerchantRecord,
  type ObservedMerchantSignal,
} from "@/lib/recovery/merchant-identity";
import {
  assessCommitmentCoverage,
  assessSourceLiveness,
  rollUpWorkspaceCoverage,
  type SourceLiveness,
  type WorkspaceCoverageHealth,
} from "@/lib/recovery/source-liveness";
import { getDatabasePool } from "@/lib/server/database";
import { RecoveryServiceError } from "@/lib/server/recovery-api";

/**
 * Persistence for the commitment graph.
 *
 * Everything here is derived and additive. Money, merchant, cadence and
 * corrections stay in the frozen Recovery tables; this recomputes belief,
 * coverage and change from those facts and writes the result idempotently.
 * Running it twice against unchanged facts performs no meaningful write.
 */

const roleRank = { viewer: 1, member: 2, admin: 3, owner: 4 } as const;
type GraphRole = keyof typeof roleRank;

async function assertGraphRole(client: PoolClient, userId: string, workspaceId: string, minimumRole: GraphRole) {
  const result = await client.query<{ role: GraphRole }>(
    `select member.role
     from workspace_members member
     join users actor on actor.id = member.user_id and actor.deleted_at is null
     where member.user_id = $1 and member.workspace_id = $2`,
    [userId, workspaceId],
  );
  const row = result.rows[0];
  if (!row || roleRank[row.role] < roleRank[minimumRole]) throw new RecoveryServiceError("FORBIDDEN");
  return row.role;
}

async function withGraphRead<T>(read: (client: PoolClient) => Promise<T>) {
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin isolation level repeatable read read only");
    const result = await read(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function withGraphWrite<T>(write: (client: PoolClient) => Promise<T>) {
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    const result = await write(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

type SourceRow = {
  id: string;
  source_type: SourceType;
  label: string;
  ingested_at: string;
  coverage_start: string | null;
  coverage_end: string | null;
  evidence_count: string;
  last_evidence_at: string | null;
  disconnected: boolean;
};

type CommitmentRow = {
  id: string;
  merchant: string;
  currency: string;
  amount_minor: string;
  cadence: Cadence;
  next_expected_date: string | null;
  status: string;
  first_detected_at: string;
};

type ObservationRow = {
  commitment_id: string;
  evidence_id: string;
  source_id: string;
  evidence_date: string | null;
  amount_minor: string | null;
  currency: string | null;
  normalized_merchant: string;
  sender_domain: string | null;
  sender_tier: SenderTrustTier | null;
};

async function readGraphInputs(client: PoolClient, workspaceId: string) {
  const sources = await client.query<SourceRow>(
    `select source.id,
            source.source_type,
            source.label,
            source.ingested_at::text as ingested_at,
            source.coverage_start::text as coverage_start,
            source.coverage_end::text as coverage_end,
            count(evidence.id)::text as evidence_count,
            max(evidence.created_at)::text as last_evidence_at,
            (disconnection.source_id is not null and disconnection.reconnected_at is null) as disconnected
     from recovery_sources source
     left join recovery_evidence evidence
       on evidence.workspace_id = source.workspace_id and evidence.source_id = source.id
     left join recovery_source_disconnections disconnection
       on disconnection.workspace_id = source.workspace_id and disconnection.source_id = source.id
     where source.workspace_id = $1
     group by source.id, disconnection.source_id, disconnection.reconnected_at
     order by source.id`,
    [workspaceId],
  );

  const commitments = await client.query<CommitmentRow>(
    `select id,
            effective_merchant as merchant,
            base_currency as currency,
            effective_amount_minor::text as amount_minor,
            effective_cadence as cadence,
            effective_next_expected_date::text as next_expected_date,
            effective_status as status,
            first_detected_at::text as first_detected_at
     from recovery_commitments
     where workspace_id = $1
     order by id`,
    [workspaceId],
  );

  const observations = await client.query<ObservationRow>(
    `select link.commitment_id,
            evidence.id as evidence_id,
            evidence.source_id,
            evidence.evidence_date::text as evidence_date,
            evidence.amount_minor::text as amount_minor,
            evidence.currency,
            evidence.normalized_merchant,
            assessment.from_domain as sender_domain,
            assessment.trust_tier as sender_tier
     from recovery_commitment_evidence link
     join recovery_evidence evidence
       on evidence.workspace_id = link.workspace_id and evidence.id = link.evidence_id
     left join recovery_inbound_sender_assessments assessment
       on assessment.workspace_id = evidence.workspace_id and assessment.source_id = evidence.source_id
     where link.workspace_id = $1
     order by link.commitment_id, evidence.evidence_date nulls last, evidence.id`,
    [workspaceId],
  );

  const aliasRevoked = await client.query<{ revoked: boolean }>(
    `select bool_and(status <> 'ACTIVE') as revoked
     from recovery_inbound_aliases where workspace_id = $1`,
    [workspaceId],
  );

  const cancellations = await client.query<{ commitment_id: string; cancellation_state: CancellationOutcomeState }>(
    `select commitment_id, cancellation_state from recovery_commitment_states where workspace_id = $1`,
    [workspaceId],
  );

  const storedSignals = await client.query<{ dedupe_key: string; kind: ChangeSignalKind; commitment_id: string | null; state: ChangeSignalState }>(
    `select dedupe_key, kind, commitment_id, state from recovery_change_signals where workspace_id = $1`,
    [workspaceId],
  );

  const rejections = await client.query<{ commitment_id: string; merchant_id: string }>(
    `select commitment_id, merchant_id from recovery_merchant_merge_rejections where workspace_id = $1`,
    [workspaceId],
  );

  const links = await client.query<{ commitment_id: string; merchant_id: string }>(
    `select commitment_id, merchant_id from recovery_merchant_links
     where workspace_id = $1 and reversed_at is null`,
    [workspaceId],
  );

  return {
    sources: sources.rows,
    commitments: commitments.rows,
    observations: observations.rows,
    aliasRevoked: aliasRevoked.rows[0]?.revoked === true,
    cancellations: new Map(cancellations.rows.map((row) => [row.commitment_id, row.cancellation_state])),
    storedSignals: storedSignals.rows.map((row): StoredChangeSignal => ({
      dedupeKey: row.dedupe_key,
      kind: row.kind,
      commitmentId: row.commitment_id,
      state: row.state,
    })),
    rejections: rejections.rows,
    links: links.rows,
  };
}

const automaticSourceTypes = new Set<SourceType>(["FORWARDED_EMAIL", "GMAIL_OAUTH"]);

/**
 * A forwarded receipt creates one source row per delivery, so the live thing is
 * the shared inbox channel rather than any single row. Automatic rows therefore
 * inherit the channel's newest delivery and its widest covered window; a one-off
 * import keeps its own narrow window and stays a baseline.
 */
function buildSourceLiveness(input: {
  sources: readonly SourceRow[];
  aliasRevoked: boolean;
  now: Date;
}): SourceLiveness[] {
  const automatic = input.sources.filter((source) => automaticSourceTypes.has(source.source_type));
  const channelLastDelivery = automatic
    .map((source) => source.last_evidence_at ?? source.ingested_at)
    .sort()
    .at(-1) ?? null;
  const channelStart = automatic.map((source) => source.coverage_start)
    .filter((value): value is string => Boolean(value)).sort().at(0) ?? null;
  const channelEnd = automatic.map((source) => source.coverage_end)
    .filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;

  return input.sources.map((source) => {
    const isAutomatic = automaticSourceTypes.has(source.source_type);
    return assessSourceLiveness({
      sourceId: source.id,
      kind: source.source_type,
      connected: !source.disconnected,
      credentialRevoked: isAutomatic && source.source_type === "FORWARDED_EMAIL" && input.aliasRevoked,
      consecutiveFailureCount: 0,
      evidenceCount: Number(source.evidence_count),
      lastEvidenceAt: source.last_evidence_at,
      lastDeliveryAt: isAutomatic ? channelLastDelivery : source.ingested_at,
      coverageStart: isAutomatic ? channelStart : source.coverage_start,
      coverageEnd: isAutomatic ? channelEnd : source.coverage_end,
    }, input.now);
  });
}

/**
 * Today's evidence carries two usable identity signals: the normalized merchant
 * name and, on forwarded mail, the assessed sender domain with its trust tier.
 * A name alone can only ask; it can never merge.
 */
function buildMerchantClaims(input: {
  commitments: readonly CommitmentRow[];
  observations: readonly ObservationRow[];
}) {
  const byCommitment = new Map<string, ObservedMerchantSignal[]>();
  for (const observation of input.observations) {
    const signals = byCommitment.get(observation.commitment_id) ?? [];
    if (observation.normalized_merchant) {
      signals.push({ signal: { kind: "FUZZY_ALIAS", value: observation.normalized_merchant }, evidenceId: observation.evidence_id });
    }
    if (observation.sender_domain && observation.sender_tier) {
      signals.push({
        signal: { kind: "SENDER_DOMAIN", value: observation.sender_domain, tier: observation.sender_tier },
        evidenceId: observation.evidence_id,
      });
    }
    byCommitment.set(observation.commitment_id, signals);
  }
  return input.commitments.map((commitment): CanonicalMerchantRecord => ({
    id: commitment.id,
    currency: commitment.currency,
    displayName: commitment.merchant,
    signals: byCommitment.get(commitment.id) ?? [],
  }));
}

/**
 * Duplicate answers are stored against canonical merchants, so a rejection is
 * translated back into the commitment it actually refers to before detection
 * runs. A question the customer has already answered is never asked again.
 */
function confirmedSamePairKeys(links: readonly { commitment_id: string; merchant_id: string }[]) {
  const commitmentsByMerchant = new Map<string, string[]>();
  for (const link of links) {
    commitmentsByMerchant.set(link.merchant_id, [...(commitmentsByMerchant.get(link.merchant_id) ?? []), link.commitment_id]);
  }
  const keys = new Set<string>();
  for (const group of commitmentsByMerchant.values()) {
    const ids = [...new Set(group)].sort();
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        keys.add(`${ids[i]}:${ids[j]}`);
      }
    }
  }
  return { commitmentsByMerchant, keys };
}

function buildDuplicateSuspicions(
  claims: readonly CanonicalMerchantRecord[],
  rejections: readonly { commitment_id: string; merchant_id: string }[],
  links: readonly { commitment_id: string; merchant_id: string }[],
): DuplicateSuspicion[] {
  const { commitmentsByMerchant, keys: confirmedSame } = confirmedSamePairKeys(links);
  const rejectedPairs = new Set<string>();
  for (const rejection of rejections) {
    for (const other of commitmentsByMerchant.get(rejection.merchant_id) ?? []) {
      rejectedPairs.add([rejection.commitment_id, other].sort().join(":"));
    }
  }
  const suspicions: DuplicateSuspicion[] = [];
  for (const claim of claims) {
    const others = claims.filter((entry) => entry.id !== claim.id);
    const resolution = resolveMerchantIdentity({
      claim,
      candidates: others,
      rejectedMerchantIds: others
        .filter((entry) => rejectedPairs.has([claim.id, entry.id].sort().join(":")))
        .map((entry) => entry.id),
    });
    // An automatic merge would rewrite commitment identity, which is frozen.
    // Both outcomes are surfaced as a question the customer answers.
    const match = resolution.match;
    if (!match) continue;
    const other = claims.find((entry) => entry.id === match.merchantId);
    if (!other) continue;
    if (confirmedSame.has([claim.id, other.id].sort().join(":"))) continue;
    suspicions.push({
      commitmentId: claim.id,
      otherCommitmentId: other.id,
      merchant: claim.displayName,
      otherMerchant: other.displayName,
      score: match.score,
      evidenceIds: match.evidenceIds,
      reasons: match.reasons,
    });
  }
  return suspicions;
}

function toChargeObservation(row: ObservationRow): ChargeObservation | null {
  if (!row.evidence_date || row.amount_minor === null || !row.currency) return null;
  return {
    evidenceId: row.evidence_id,
    date: row.evidence_date,
    amountMinor: BigInt(row.amount_minor),
    currency: row.currency,
  };
}

export type CommitmentGraphRefresh = {
  evaluatedOn: string;
  sourceCount: number;
  commitmentCount: number;
  openedSignals: number;
  reopenedSignals: number;
  resolvedSignals: number;
  supersededSignals: number;
};

export async function refreshCommitmentGraph(input: {
  workspaceId: string;
  actorUserId: string;
  now?: Date;
}): Promise<CommitmentGraphRefresh> {
  const now = input.now ?? new Date();
  const evaluatedOn = now.toISOString().slice(0, 10);
  return withGraphWrite(async (client) => {
    await assertGraphRole(client, input.actorUserId, input.workspaceId, "member");
    const facts = await readGraphInputs(client, input.workspaceId);
    const liveness = buildSourceLiveness({ sources: facts.sources, aliasRevoked: facts.aliasRevoked, now });

    for (const source of liveness) {
      await client.query(
        `insert into recovery_source_health (
           workspace_id, source_id, liveness_state, automatic, consecutive_failure_count, credential_revoked, last_delivery_at, assessed_at
         ) values ($1, $2, $3, $4, 0, $5, $6, now())
         on conflict (workspace_id, source_id) do update set
           liveness_state = excluded.liveness_state,
           automatic = excluded.automatic,
           credential_revoked = excluded.credential_revoked,
           last_delivery_at = excluded.last_delivery_at,
           assessed_at = excluded.assessed_at`,
        [
          input.workspaceId,
          source.sourceId,
          source.state,
          source.automatic,
          source.state === "BROKEN" && source.automatic,
          source.lastDeliveryAt,
        ],
      );
    }

    const observationsByCommitment = new Map<string, ObservationRow[]>();
    for (const observation of facts.observations) {
      const list = observationsByCommitment.get(observation.commitment_id) ?? [];
      list.push(observation);
      observationsByCommitment.set(observation.commitment_id, list);
    }

    const claims = buildMerchantClaims({ commitments: facts.commitments, observations: facts.observations });
    const duplicateSuspicions = buildDuplicateSuspicions(claims, facts.rejections, facts.links);
    const identityConflicts = new Set(duplicateSuspicions.map((suspicion) => suspicion.commitmentId));

    const contexts: CommitmentChangeContext[] = [];
    for (const commitment of facts.commitments) {
      const rows = observationsByCommitment.get(commitment.id) ?? [];
      const citedSourceIds = [...new Set(rows.map((row) => row.source_id))];
      const coverage = assessCommitmentCoverage(citedSourceIds, liveness);
      const observations = rows.flatMap((row) => {
        const observation = toChargeObservation(row);
        return observation ? [observation] : [];
      });
      const belief = buildCommitmentBelief({
        commitmentId: commitment.id,
        merchant: commitment.merchant,
        currency: commitment.currency,
        amountMinor: BigInt(commitment.amount_minor),
        cadence: commitment.cadence,
        nextExpectedDate: commitment.next_expected_date,
        evaluatedOn,
        coverage,
        observations,
        cadenceAssertions: commitment.cadence === "IRREGULAR" ? [] : rows
          .filter((row) => row.evidence_date)
          .map((row) => ({ at: row.evidence_date!, cadence: commitment.cadence, evidenceIds: [row.evidence_id] })),
        cancellationState: facts.cancellations.get(commitment.id) ?? "NONE",
        identityConflict: identityConflicts.has(commitment.id),
      });
      await persistCommitmentBelief(client, input.workspaceId, belief, evaluatedOn);
      contexts.push({
        belief,
        merchant: commitment.merchant,
        currency: commitment.currency,
        amountMinor: BigInt(commitment.amount_minor),
        cadence: commitment.cadence,
        nextExpectedDate: commitment.next_expected_date,
        firstDetectedAt: commitment.first_detected_at,
        observationCount: observations.length,
        trial: null,
      });
    }

    const detected = detectChangeSignals({
      evaluatedOn,
      commitments: contexts,
      sources: liveness,
      workspaceCoverage: rollUpWorkspaceCoverage(liveness),
      duplicateSuspicions,
    });
    const plan = reconcileChangeSignals({ stored: facts.storedSignals, detected, at: now.toISOString() });

    for (const signal of plan.opened) {
      await insertChangeSignal(client, input.workspaceId, signal, now);
    }
    for (const reopened of plan.reopened) {
      await client.query(
        `update recovery_change_signals set state = 'OPEN', resolved_at = null, detected_at = $3
         where workspace_id = $1 and dedupe_key = $2 and state = 'RESOLVED'`,
        [input.workspaceId, reopened.dedupeKey, reopened.at],
      );
    }
    for (const closed of plan.closed) {
      await client.query(
        `update recovery_change_signals set state = 'RESOLVED', resolved_at = $3
         where workspace_id = $1 and dedupe_key = $2 and state in ('OPEN', 'ACKNOWLEDGED')`,
        [input.workspaceId, closed.dedupeKey, closed.at],
      );
    }
    for (const superseded of plan.superseded) {
      await client.query(
        `update recovery_change_signals set state = 'SUPERSEDED', superseded_at = $3
         where workspace_id = $1 and dedupe_key = $2 and state in ('OPEN', 'ACKNOWLEDGED')`,
        [input.workspaceId, superseded.dedupeKey, superseded.at],
      );
    }

    return {
      evaluatedOn,
      sourceCount: liveness.length,
      commitmentCount: facts.commitments.length,
      openedSignals: plan.opened.length,
      reopenedSignals: plan.reopened.length,
      resolvedSignals: plan.closed.length,
      supersededSignals: plan.superseded.length,
    };
  });
}

async function persistCommitmentBelief(
  client: PoolClient,
  workspaceId: string,
  belief: CommitmentBelief,
  evaluatedOn: string,
) {
  await client.query(
    `insert into recovery_commitment_states (
       workspace_id, commitment_id, lifecycle_state, coverage_state, conflict_state, prediction_state,
       cancellation_state, last_verified_on, next_verification_due_on, expected_window_start, expected_window_end,
       belief, because, falsifiability, cited_evidence_ids, coverage_source_ids, evaluated_on, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15::uuid[], $16::uuid[], $17, now())
     on conflict (workspace_id, commitment_id) do update set
       lifecycle_state = excluded.lifecycle_state,
       coverage_state = excluded.coverage_state,
       conflict_state = excluded.conflict_state,
       prediction_state = excluded.prediction_state,
       last_verified_on = excluded.last_verified_on,
       next_verification_due_on = excluded.next_verification_due_on,
       expected_window_start = excluded.expected_window_start,
       expected_window_end = excluded.expected_window_end,
       belief = excluded.belief,
       because = excluded.because,
       falsifiability = excluded.falsifiability,
       cited_evidence_ids = excluded.cited_evidence_ids,
       coverage_source_ids = excluded.coverage_source_ids,
       evaluated_on = excluded.evaluated_on,
       updated_at = now()`,
    [
      workspaceId,
      belief.commitmentId,
      belief.lifecycleState,
      belief.coverageState,
      belief.conflictState,
      belief.predictionState,
      belief.cancellationState,
      belief.lastVerifiedAt,
      belief.nextVerificationDueAt,
      belief.expectedChargeWindow?.start ?? null,
      belief.expectedChargeWindow?.end ?? null,
      belief.belief.slice(0, 400),
      JSON.stringify(belief.because),
      JSON.stringify(belief.falsifiability),
      belief.citedEvidenceIds,
      belief.coverageSourceIds,
      evaluatedOn,
    ],
  );
}

async function insertChangeSignal(client: PoolClient, workspaceId: string, signal: ChangeSignal, now: Date) {
  const citedEvidenceIds = signal.citation.kind === "EVIDENCE" ? signal.citation.evidenceIds : [];
  const citedSourceIds = signal.citation.kind === "SOURCE_HEALTH"
    ? signal.citation.sourceIds
    : signal.citation.kind === "COVERED_ABSENCE"
      ? signal.citation.coverageSourceIds
      : [];
  const window = signal.citation.kind === "COVERED_ABSENCE" ? signal.citation.window : null;
  await client.query(
    `insert into recovery_change_signals (
       workspace_id, dedupe_key, kind, state, commitment_id, materiality, confidence, title, detail,
       currency, amount_minor, delta_minor, due_date, citation_kind, cited_evidence_ids, cited_source_ids,
       absence_window_start, absence_window_end, detected_at
     ) values ($1, $2, $3, 'OPEN', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::uuid[], $15::uuid[], $16, $17, $18)
     on conflict (workspace_id, dedupe_key) do nothing`,
    [
      workspaceId,
      signal.dedupeKey,
      signal.kind,
      signal.commitmentId,
      signal.materiality,
      signal.confidence,
      signal.title.slice(0, 200),
      signal.detail.slice(0, 600),
      signal.currency,
      signal.amountMinor?.toString() ?? null,
      signal.deltaMinor?.toString() ?? null,
      signal.dueDate,
      signal.citation.kind,
      citedEvidenceIds,
      citedSourceIds,
      window?.start ?? null,
      window?.end ?? null,
      now.toISOString(),
    ],
  );
}

export type CommitmentGraphView = {
  attention: readonly AttentionCard[];
  coverage: WorkspaceCoverageHealth;
  sources: readonly (SourceLiveness & { label: string })[];
  commitments: readonly {
    commitmentId: string;
    merchant: string;
    lifecycleState: string;
    coverageState: string;
    belief: string;
    because: readonly string[];
    falsifiability: readonly string[];
    lastVerifiedOn: string | null;
    nextVerificationDueOn: string | null;
    cancellationState: CancellationOutcomeState;
  }[];
};

export async function readCommitmentGraph(input: {
  workspaceId: string;
  actorUserId: string;
  evaluatedOn?: string;
}): Promise<CommitmentGraphView> {
  const evaluatedOn = input.evaluatedOn ?? new Date().toISOString().slice(0, 10);
  return withGraphRead(async (client) => {
    await assertGraphRole(client, input.actorUserId, input.workspaceId, "viewer");

    const health = await client.query<{
      source_id: string; liveness_state: SourceLiveness["state"]; automatic: boolean;
      last_delivery_at: string | null; label: string; source_type: SourceType;
      coverage_start: string | null; coverage_end: string | null; last_evidence_at: string | null;
    }>(
      `select health.source_id, health.liveness_state, health.automatic, health.last_delivery_at::text as last_delivery_at,
              source.label, source.source_type,
              source.coverage_start::text as coverage_start, source.coverage_end::text as coverage_end,
              (select max(created_at)::text from recovery_evidence evidence
                where evidence.workspace_id = health.workspace_id and evidence.source_id = health.source_id) as last_evidence_at
       from recovery_source_health health
       join recovery_sources source
         on source.workspace_id = health.workspace_id and source.id = health.source_id
       where health.workspace_id = $1
       order by health.source_id`,
      [input.workspaceId],
    );

    const sources = health.rows.map((row) => ({
      sourceId: row.source_id,
      kind: row.source_type,
      state: row.liveness_state,
      automatic: row.automatic,
      trustworthy: row.liveness_state === "CURRENT",
      lastEvidenceAt: row.last_evidence_at,
      lastDeliveryAt: row.last_delivery_at,
      coverageStart: row.coverage_start,
      coverageEnd: row.coverage_end,
      ageDays: null,
      spanDays: null,
      limitations: [] as readonly string[],
      label: row.label,
    }));

    const signals = await client.query<{
      dedupe_key: string; kind: ChangeSignalKind; commitment_id: string | null; materiality: ChangeSignal["materiality"];
      confidence: number; title: string; detail: string; currency: string | null; amount_minor: string | null;
      delta_minor: string | null; due_date: string | null; citation_kind: ChangeSignal["citation"]["kind"];
      cited_evidence_ids: string[]; cited_source_ids: string[]; absence_window_start: string | null; absence_window_end: string | null;
    }>(
      `select dedupe_key, kind, commitment_id, materiality, confidence, title, detail, currency,
              amount_minor::text as amount_minor, delta_minor::text as delta_minor, due_date::text as due_date,
              citation_kind, cited_evidence_ids, cited_source_ids,
              absence_window_start::text as absence_window_start, absence_window_end::text as absence_window_end
       from recovery_change_signals
       where workspace_id = $1 and state = 'OPEN'
       order by dedupe_key`,
      [input.workspaceId],
    );

    const attention = buildAttentionFeed(signals.rows.map((row): ChangeSignal => ({
      dedupeKey: row.dedupe_key,
      kind: row.kind,
      commitmentId: row.commitment_id,
      merchant: null,
      title: row.title,
      detail: row.detail,
      confidence: row.confidence,
      materiality: row.materiality,
      currency: row.currency,
      amountMinor: row.amount_minor === null ? null : BigInt(row.amount_minor),
      deltaMinor: row.delta_minor === null ? null : BigInt(row.delta_minor),
      dueDate: row.due_date,
      citation: row.citation_kind === "EVIDENCE"
        ? { kind: "EVIDENCE", evidenceIds: row.cited_evidence_ids }
        : row.citation_kind === "SOURCE_HEALTH"
          ? { kind: "SOURCE_HEALTH", sourceIds: row.cited_source_ids }
          : {
              kind: "COVERED_ABSENCE",
              window: { start: row.absence_window_start ?? "", end: row.absence_window_end ?? "" },
              coverageSourceIds: row.cited_source_ids,
            },
    })), { evaluatedOn });

    const states = await client.query<{
      commitment_id: string; merchant: string; lifecycle_state: string; coverage_state: string;
      belief: string; because: string[]; falsifiability: string[]; last_verified_on: string | null;
      next_verification_due_on: string | null; cancellation_state: CancellationOutcomeState;
    }>(
      `select state.commitment_id, commitment.effective_merchant as merchant, state.lifecycle_state, state.coverage_state,
              state.belief, state.because, state.falsifiability,
              state.last_verified_on::text as last_verified_on,
              state.next_verification_due_on::text as next_verification_due_on,
              state.cancellation_state
       from recovery_commitment_states state
       join recovery_commitments commitment
         on commitment.workspace_id = state.workspace_id and commitment.id = state.commitment_id
       where state.workspace_id = $1
       order by commitment.effective_merchant, state.commitment_id`,
      [input.workspaceId],
    );

    return {
      attention,
      coverage: rollUpWorkspaceCoverage(sources),
      sources,
      commitments: states.rows.map((row) => ({
        commitmentId: row.commitment_id,
        merchant: row.merchant,
        lifecycleState: row.lifecycle_state,
        coverageState: row.coverage_state,
        belief: row.belief,
        because: row.because,
        falsifiability: row.falsifiability,
        lastVerifiedOn: row.last_verified_on,
        nextVerificationDueOn: row.next_verification_due_on,
        cancellationState: row.cancellation_state,
      })),
    };
  });
}

export async function acknowledgeChangeSignal(input: {
  workspaceId: string;
  actorUserId: string;
  dedupeKey: string;
}) {
  return withGraphWrite(async (client) => {
    await assertGraphRole(client, input.actorUserId, input.workspaceId, "member");
    const result = await client.query(
      `update recovery_change_signals set state = 'ACKNOWLEDGED', acknowledged_at = coalesce(acknowledged_at, now())
       where workspace_id = $1 and dedupe_key = $2 and state = 'OPEN'`,
      [input.workspaceId, input.dedupeKey],
    );
    return { acknowledged: (result.rowCount ?? 0) > 0 };
  });
}

/**
 * Records the customer's answer to a suspected duplicate. Rejection is stored so
 * the pair is never proposed automatically again, and either answer becomes a
 * labelled example for the correction dataset.
 */
export async function answerDuplicateSuspicion(input: {
  workspaceId: string;
  actorUserId: string;
  commitmentId: string;
  otherCommitmentId: string;
  sameSubscription: boolean;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return withGraphWrite(async (client) => {
    await assertGraphRole(client, input.actorUserId, input.workspaceId, "member");
    const pair = [input.commitmentId, input.otherCommitmentId].sort();
    const dedupeKey = `DUPLICATE_SUSPECTED:${pair.join(":")}`;
    const signal = await client.query<{ confidence: number; cited_evidence_ids: string[] }>(
      `select confidence, cited_evidence_ids from recovery_change_signals
       where workspace_id = $1 and dedupe_key = $2 and state in ('OPEN', 'ACKNOWLEDGED')`,
      [input.workspaceId, dedupeKey],
    );
    if (!signal.rows[0]) throw new RecoveryServiceError("NOT_FOUND");

    const commitment = await client.query<{ cadence: Cadence; currency: string }>(
      `select effective_cadence as cadence, base_currency as currency
       from recovery_commitments where workspace_id = $1 and id = $2`,
      [input.workspaceId, input.commitmentId],
    );
    if (!commitment.rows[0]) throw new RecoveryServiceError("NOT_FOUND");
    const coverage = await client.query<{ coverage_state: string }>(
      `select coverage_state from recovery_commitment_states where workspace_id = $1 and commitment_id = $2`,
      [input.workspaceId, input.commitmentId],
    );

    if (input.sameSubscription) {
      // Accepting makes one canonical merchant the answer for both sides. The
      // database still refuses the link if the currencies differ. Without a
      // stored link, refresh would reopen the same question and the headline
      // would count both rows again.
      const merchantId = await ensureCanonicalMerchant(client, input.workspaceId, input.commitmentId);
      const citedEvidenceIds = signal.rows[0].cited_evidence_ids;
      if (!merchantId || citedEvidenceIds.length === 0) {
        throw new RecoveryServiceError("INVALID_EVIDENCE", "We could not record that these are the same subscription from the receipts already stored.");
      }
      for (const commitmentId of [input.commitmentId, input.otherCommitmentId]) {
        await linkCommitmentToMerchant(client, {
          workspaceId: input.workspaceId,
          commitmentId,
          merchantId,
          score: signal.rows[0].confidence,
          citedEvidenceIds,
        });
      }
    } else {
      // Rejecting records the other side as its own canonical merchant and
      // stores the refusal against it, so detection can translate it back.
      const merchantId = await ensureCanonicalMerchant(client, input.workspaceId, input.otherCommitmentId);
      if (merchantId) {
        if (signal.rows[0].cited_evidence_ids.length) {
          await linkCommitmentToMerchant(client, {
            workspaceId: input.workspaceId,
            commitmentId: input.otherCommitmentId,
            merchantId,
            score: signal.rows[0].confidence,
            citedEvidenceIds: signal.rows[0].cited_evidence_ids,
          });
        }
        await client.query(
          `insert into recovery_merchant_merge_rejections (workspace_id, commitment_id, merchant_id, rejected_by_user_id)
           values ($1, $2, $3, $4)
           on conflict (workspace_id, commitment_id, merchant_id) do nothing`,
          [input.workspaceId, input.commitmentId, merchantId, input.actorUserId],
        );
      }
    }

    await client.query(
      `update recovery_change_signals set state = 'RESOLVED', resolved_at = $3
       where workspace_id = $1 and dedupe_key = $2 and state in ('OPEN', 'ACKNOWLEDGED')`,
      [input.workspaceId, dedupeKey, now.toISOString()],
    );

    const outcome: CorrectionOutcome = {
      kind: input.sameSubscription ? "DUPLICATE_MERGE_ACCEPTED" : "DUPLICATE_MERGE_REJECTED",
      observedAt: now.toISOString(),
      citedEvidenceIds: signal.rows[0].cited_evidence_ids,
      systemProposed: {
        matchScore: signal.rows[0].confidence,
        strongestSignalKind: "FUZZY_ALIAS",
        signalKinds: ["FUZZY_ALIAS"],
        cadence: commitment.rows[0].cadence,
        currency: commitment.rows[0].currency,
        coverageState: (coverage.rows[0]?.coverage_state ?? "NO_EVIDENCE") as SourceLiveness["state"],
      },
      userAnswer: input.sameSubscription ? "ACCEPTED" : "REJECTED",
    };
    await recordCorrectionOutcome(client, {
      workspaceId: input.workspaceId,
      commitmentId: input.commitmentId,
      idempotencyKey: dedupeKey,
      outcome,
    });
    return { recorded: true, sameSubscription: input.sameSubscription };
  });
}

async function ensureCanonicalMerchant(client: PoolClient, workspaceId: string, commitmentId: string) {
  const result = await client.query<{ id: string }>(
    `insert into recovery_merchants (workspace_id, currency, display_name)
     select $1, base_currency, left(effective_merchant, 180) || ' #' || left(id::text, 8)
     from recovery_commitments where workspace_id = $1 and id = $2
     on conflict (workspace_id, currency, display_name) do update set updated_at = now()
     returning id`,
    [workspaceId, commitmentId],
  );
  return result.rows[0]?.id ?? null;
}

async function linkCommitmentToMerchant(client: PoolClient, input: {
  workspaceId: string;
  commitmentId: string;
  merchantId: string;
  score: number;
  citedEvidenceIds: readonly string[];
}) {
  await client.query(
    `insert into recovery_merchant_links (
       workspace_id, commitment_id, merchant_id, decision, score, strongest_signal_kind, reasons, cited_evidence_ids
     ) values ($1, $2, $3, 'USER_CONFIRMED', $4, 'FUZZY_ALIAS', '["You told us which subscription this is."]'::jsonb, $5::uuid[])
     on conflict (workspace_id, commitment_id, merchant_id) do nothing`,
    [input.workspaceId, input.commitmentId, input.merchantId, Math.max(0, Math.min(100, input.score)), input.citedEvidenceIds],
  );
}

async function recordCorrectionOutcome(client: PoolClient, input: {
  workspaceId: string;
  commitmentId: string | null;
  correctionId?: string | null;
  idempotencyKey: string;
  outcome: CorrectionOutcome;
}) {
  const example = buildLearningExample(input.outcome);
  await client.query(
    `insert into recovery_correction_outcomes (
       workspace_id, kind, label, feature_version, features, cited_evidence_ids, commitment_id, correction_id, idempotency_key, observed_at
     ) values ($1, $2, $3, $4, $5::jsonb, $6::uuid[], $7, $8, $9, $10)
     on conflict (workspace_id, kind, idempotency_key) do nothing`,
    [
      input.workspaceId,
      example.kind,
      example.label,
      example.featureVersion,
      JSON.stringify(example.features),
      example.citedEvidenceIds,
      input.commitmentId,
      input.correctionId ?? null,
      input.idempotencyKey,
      example.observedAt,
    ],
  );
}

/**
 * Advances the cancellation lifecycle for one commitment. The transition is
 * decided by the pure state machine, appended as an auditable event, and only
 * then reflected on the commitment state.
 */
export async function recordCancellationEvent(input: {
  workspaceId: string;
  actorUserId: string;
  commitmentId: string;
  idempotencyKey: string;
  event: CancellationEvent;
}) {
  return withGraphWrite(async (client) => {
    await assertGraphRole(client, input.actorUserId, input.workspaceId, "member");
    const current = await client.query<{ cancellation_state: CancellationOutcomeState }>(
      `select cancellation_state from recovery_commitment_states
       where workspace_id = $1 and commitment_id = $2 for update`,
      [input.workspaceId, input.commitmentId],
    );
    if (!current.rows[0]) throw new RecoveryServiceError("NOT_FOUND");

    const transition = advanceCancellationOutcome({
      current: current.rows[0].cancellation_state,
      event: input.event,
    });
    if (!transition.accepted) {
      throw new RecoveryServiceError("CONFLICT", transition.reasons[0]);
    }

    await client.query(
      `insert into recovery_cancellation_events (
         workspace_id, commitment_id, idempotency_key, event_kind, from_state, to_state, proof, reasons, cited_evidence_ids, recorded_by_user_id
       ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::uuid[], $10)
       on conflict (workspace_id, commitment_id, idempotency_key) do nothing`,
      [
        input.workspaceId,
        input.commitmentId,
        input.idempotencyKey,
        input.event.kind,
        transition.previousState,
        transition.state,
        transition.proof === "SETTLEMENT" ? "NONE" : transition.proof,
        JSON.stringify(transition.reasons),
        transition.citedEvidenceIds,
        input.actorUserId,
      ],
    );
    await client.query(
      `update recovery_commitment_states set cancellation_state = $3, updated_at = now()
       where workspace_id = $1 and commitment_id = $2`,
      [input.workspaceId, input.commitmentId, transition.state],
    );
    return { state: transition.state, proof: transition.proof, reasons: transition.reasons };
  });
}
