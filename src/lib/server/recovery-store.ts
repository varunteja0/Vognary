import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  recoveryLimits,
  type Cadence,
  type ChangeItemDto,
  type CommitmentDetailDto,
  type CommitmentStatus,
  type CommitmentSummaryDto,
  type CorrectionDto,
  type CorrectionPatch,
  type CreateCorrectionRequest,
  type Decision,
  type EvidenceDto,
  type EvidenceIngestRequest,
  type EvidenceProvenanceKind,
  type EvidenceSubmissionDto,
  type ForwardedEmailMaterializationRequest,
  type HomeChangedDto,
  type HomeProjectionDto,
  type PutDecisionRequest,
  type RecoveryCutoverStatus,
  type SenderProvenanceDto,
  type SourceType,
  type SubmitEvidenceResponse,
} from "@/lib/recovery/contracts";
import {
  buildHomeProjection,
  currencyExponent,
  decimalToMinorUnits,
  minorUnitsToDecimal,
  normalizeMinorUnits,
  projectCadenceMonthlyMinor,
  toMoneyDto,
  type CanonicalCommitmentRecord,
  type HeadlineDuplicateState,
  type RecoveryCoverageSource,
  type RecoveryObservationRecord,
} from "@/lib/recovery/domain";
import {
  loadAutopilotHome,
  loadRecoveryEvidenceSources,
  lockAutopilotAuthorityGate,
  refreshAutopilotCandidates,
} from "@/lib/server/recovery-autopilot-store";
import { recordConsentedProductEvent } from "@/lib/server/product-event-store";
import { lockReceiptInboxAuthority } from "@/lib/server/recovery-inbound-store";
import {
  extractObservedReceipt,
  extractReceiptCandidates,
  splitReceiptSnippets,
  type ObservedReceipt,
  type ReceiptCandidate,
  type ReceiptCurrencyHint,
} from "@/lib/receipt-parser";
import { redactText } from "@/lib/redaction";
import {
  analyzeStatements,
  type Frequency,
  type ManualRecurringInput,
  type ParsedTransaction,
  type RecurringItem,
  type StatementSource,
} from "@/lib/recurring-audit";
import { recoveryEvidenceFingerprint } from "@/lib/recovery/evidence-fingerprint";
import { evaluateExpectedCharge, type ChargeObservation } from "@/lib/recovery/absence";
import { presentCommitmentMemory, presentExpectedVsObserved } from "@/lib/recovery/expected-observation";
import { senderTrustConfidenceCeiling } from "@/lib/recovery/sender-provenance";
import { isCoverageTrustworthy, type CommitmentCoverage, type SourceLivenessState } from "@/lib/recovery/source-liveness";
import {
  RecoveryCaptureNotReadyError,
  buildRecoveryIngestionEnvelope,
  type RecoveryIngestionEnvelope,
} from "@/lib/recovery/ingestion-envelope";
import { getDatabasePool } from "@/lib/server/database";
import {
  RecoveryMaterializationError,
  RecoveryServiceError,
  hashRecoveryRequest,
  normalizeForwardedEmailMaterializationRequest,
  type RecoveryMaterializationStage,
} from "@/lib/server/recovery-api";
import { scheduleRenewalAlertsForWorkspace } from "@/lib/server/renewal-alert-store";
import { encryptSecret } from "@/lib/server/token-vault";

const roleRank = { viewer: 1, member: 2, admin: 3, owner: 4 } as const;
type RecoveryRole = keyof typeof roleRank;

const frequencyToCadence: Record<Frequency, Cadence> = {
  weekly: "WEEKLY",
  biweekly: "BIWEEKLY",
  semimonthly: "SEMIMONTHLY",
  monthly: "MONTHLY",
  bimonthly: "BIMONTHLY",
  quarterly: "QUARTERLY",
  yearly: "YEARLY",
  irregular: "IRREGULAR",
};

const cadenceToFrequency: Record<Cadence, Frequency> = Object.fromEntries(
  Object.entries(frequencyToCadence).map(([frequency, cadence]) => [cadence, frequency]),
) as Record<Cadence, Frequency>;

type WorkspaceStateRow = {
  version: string;
  baseline_version: string | null;
  latest_changed_state: HomeChangedDto["state"];
  latest_from_version: string | null;
  latest_changed_version: string | null;
};

type MembershipRow = {
  workspace_id: string;
  workspace_name: string;
  role: RecoveryRole;
};

type CommitmentRow = {
  id: string;
  identity_key: string;
  version: string;
  base_status: CommitmentStatus;
  base_merchant: string;
  base_category: string;
  base_cadence: Cadence;
  base_currency: string;
  base_amount_minor: string;
  base_monthly_minor: string;
  base_next_expected_date: Date | string | null;
  effective_status: CommitmentStatus;
  effective_merchant: string;
  effective_cadence: Cadence;
  effective_amount_minor: string;
  effective_monthly_minor: string;
  effective_next_expected_date: Date | string | null;
  confidence_score: number;
  confidence_reasons: string[];
  recommended_decision: Decision;
  recommendation_reason: string;
  risk_tags: string[];
  first_detected_at: Date;
  updated_at: Date;
  decision: Decision | null;
  decided_at: Date | null;
  decision_updated_at: Date | null;
  evidence_ids: string[];
};

type SourceRow = {
  id: string;
  source_type: SourceType;
  client_ref: string;
  label: string;
  ingested_at: Date;
  coverage_start: Date | string | null;
  coverage_end: Date | string | null;
  evidence_count: string;
};

type EvidenceRow = {
  id: string;
  source_id: string;
  source_type: SourceType;
  source_label: string;
  source_ingested_at: Date;
  source_coverage_start: Date | string | null;
  source_coverage_end: Date | string | null;
  evidence_kind: "TRANSACTION" | "RECEIPT";
  row_number: number;
  observed_at: Date | null;
  excerpt: string;
  excerpt_truncated: boolean;
  merchant: string;
  normalized_merchant: string;
  category: string;
  amount_minor: string | null;
  currency: string | null;
  evidence_date: Date | string | null;
  direction: ParsedTransaction["direction"] | null;
  cadence_hint: Cadence | null;
  next_expected_date: Date | string | null;
  provenance_kind: EvidenceProvenanceKind;
  provenance_reference: string;
  sender_trust_tier: SenderProvenanceDto["tier"] | null;
  sender_from_domain: string | null;
  sender_trusted_authority: string | null;
  sender_trust_reasons: string[] | null;
  confidence_state: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  confidence_score: number | null;
  confidence_reasons: string[];
  created_at: Date;
  linked_at?: Date;
};

type CorrectionRow = {
  id: string;
  commitment_id: string;
  field: CorrectionPatch["field"];
  patch: CorrectionPatch;
  reason: string | null;
  status: "ACTIVE" | "REVERSED" | "SUPERSEDED";
  created_at: Date;
  reversed_at: Date | null;
  superseded_at: Date | null;
};

type ChangeRow = {
  id: string;
  commitment_id: string;
  kind: ChangeItemDto["kind"];
  merchant: string;
  before_value: unknown;
  after_value: unknown;
  provenance_kind: "EVIDENCE" | "CORRECTION" | "CORRECTION_REVERSAL";
  evidence_submission_id: string | null;
  correction_id: string | null;
  evidence_ids: string[];
  detected_at: Date;
};

type ExtractedEvidence = {
  id: string;
  sourceId: string;
  evidenceKind: "TRANSACTION" | "RECEIPT";
  rowNumber: number;
  observedAt: string | null;
  excerpt: string;
  excerptTruncated: boolean;
  merchant: string;
  normalizedMerchant: string;
  category: string;
  amountMinor: string;
  currency: string;
  evidenceDate: string;
  direction: ParsedTransaction["direction"] | null;
  cadenceHint: Cadence | null;
  nextExpectedDate: string | null;
  provenanceKind: EvidenceProvenanceKind;
  provenanceReference: string;
  confidenceScore: number;
  confidenceReasons: string[];
};

export async function getRecoveryCutoverStatus(input: {
  workspaceId: string;
  actorUserId: string;
}): Promise<RecoveryCutoverStatus> {
  return withRecoveryRead(async (client) => {
    await assertRecoveryRole(client, input.actorUserId, input.workspaceId, "viewer", { lock: false });
    const result = await client.query<{
      workspace_snapshots: number;
      recurring_items: number;
      evidence_links: number;
      decisions: number;
      transactions: number;
      data_sources: number;
      connector_evidence: number;
      connected_accounts: number;
    }>(
      `select
         (select count(*)::int from workspace_states where workspace_id = $1) as workspace_snapshots,
         (select count(*)::int from recurring_items where workspace_id = $1) as recurring_items,
         (select count(*)::int from evidence_links evidence
          join recurring_items item on item.id = evidence.recurring_item_id
          where item.workspace_id = $1) as evidence_links,
         (select count(*)::int from commitment_decisions where workspace_id = $1) as decisions,
         (select count(*)::int from transactions where workspace_id = $1) as transactions,
         (select count(*)::int from data_sources where workspace_id = $1) as data_sources,
         (select count(*)::int from connector_evidence where workspace_id = $1) as connector_evidence,
        (select count(*)::int
         from connected_accounts
         where workspace_id = $1
          and coalesce(metadata ->> 'ledgerAuthority', 'LEGACY') <> 'RECOVERY_V1') as connected_accounts`,
      [input.workspaceId],
    );
    const row = result.rows[0];
    const counts = {
      workspaceSnapshots: row?.workspace_snapshots ?? 0,
      recurringItems: row?.recurring_items ?? 0,
      evidenceLinks: row?.evidence_links ?? 0,
      decisions: row?.decisions ?? 0,
      transactions: row?.transactions ?? 0,
      dataSources: row?.data_sources ?? 0,
      connectorEvidence: row?.connector_evidence ?? 0,
      connectedAccounts: row?.connected_accounts ?? 0,
    };
    return {
      status: Object.values(counts).some((count) => count > 0) ? "LEGACY_DATA_REQUIRES_MIGRATION" : "CLEAR",
      counts,
    };
  });
}

export async function materializeForwardedEmailEvidence(input: {
  workspaceId: string;
  inboundEventId: string;
  providerEventId: string;
  expectedAttemptCount: number;
  currencyHint?: ReceiptCurrencyHint | null;
  historicalBackfillClientRefs?: readonly string[];
  request: ForwardedEmailMaterializationRequest;
  now?: Date;
  afterAuthorityInspection?: () => Promise<void>;
}): Promise<{
  submission: EvidenceSubmissionDto;
  commitmentTotal: number;
  workspaceVersion: number;
  replayed: boolean;
}> {
  const request = normalizeForwardedEmailMaterializationRequest(input.request);
  const operation = "recovery.materialize-forwarded-email";
  const idempotencyKey = `forwarded-email:${sha256(`RESEND\0${input.providerEventId}`)}`;
  const currencyHint = input.currencyHint ?? null;
  // Sender provenance is a derived assessment that can legitimately shift
  // between attempts, so it stays out of the replay identity of the evidence.
  const requestHash = hashRecoveryRequest({
    operation,
    providerEventId: input.providerEventId,
    currencyHint,
    request: {
      kind: request.kind,
      receipts: request.receipts.map((receipt) => ({ clientRef: receipt.clientRef, text: receipt.text })),
    },
  });
  const envelope = buildRecoveryIngestionEnvelope({
    workspaceId: input.workspaceId,
    sourceType: "FORWARDED_EMAIL",
    idempotencyKey,
    requestHash,
    capturedAt: (input.now ?? new Date()).toISOString(),
    consentReference: input.inboundEventId,
  });
  const client = await getDatabasePool().connect();
  const now = new Date(envelope.capturedAt);
  let stage: RecoveryMaterializationStage = "EVENT_VALIDATION";
  try {
    await client.query("begin");
    await lockAutopilotAuthorityGate(client);
    await lockRecoveryWorkspace(client, input.workspaceId);
    const inspectAuthority = async () => {
      const eventHint = await client.query<{ alias_id: string | null }>(
        `select alias_id
         from recovery_inbound_events
         where id = $1 and workspace_id = $2`,
        [input.inboundEventId, input.workspaceId],
      );
      if (!eventHint.rows[0]) throw new RecoveryServiceError("NOT_FOUND");
      return eventHint.rows[0].alias_id
        ? await lockReceiptInboxAuthority(client, {
          workspaceId: input.workspaceId,
          aliasId: eventHint.rows[0].alias_id,
        })
        : { live: false, aliasStatus: null };
    };
    let authority = await inspectAuthority();
    if (input.afterAuthorityInspection) {
      await client.query("rollback");
      await input.afterAuthorityInspection();
      await client.query("begin");
      await lockAutopilotAuthorityGate(client);
      await lockRecoveryWorkspace(client, input.workspaceId);
      authority = await inspectAuthority();
    }
    const event = await client.query<{
      status: string;
      svix_id: string;
      provider: string;
      attempt_count: number;
      alias_id: string | null;
    }>(
      `select status, svix_id, provider, attempt_count, alias_id
       from recovery_inbound_events
       where id = $1 and workspace_id = $2
       for update`,
      [input.inboundEventId, input.workspaceId],
    );
    const eventRow = event.rows[0];
    if (!eventRow || eventRow.provider !== "RESEND" || eventRow.svix_id !== input.providerEventId) {
      throw new RecoveryServiceError("NOT_FOUND");
    }
    const replay = await readIdempotent<{ submission: EvidenceSubmissionDto; commitmentTotal: number }>(
      client,
      envelope.workspaceId,
      envelope.idempotencyKey,
      operation,
      envelope.requestHash,
    );
    if (replay) {
      stage = "COMMIT";
      await client.query("commit");
      return { ...replay.response, workspaceVersion: replay.workspaceVersion, replayed: true };
    }
    if (eventRow.status !== "PROCESSING" || eventRow.attempt_count !== input.expectedAttemptCount) {
      throw new RecoveryServiceError("CONFLICT", "Receipt processing lease changed before materialization.");
    }
    if (!authority.live) {
      const ignored = await client.query(
        `update recovery_inbound_events
           set status = 'IGNORED', processing_started_at = null,
             processed_at = $3, error_code = 'ALIAS_REVOKED'
         where id = $1 and workspace_id = $2
           and status = 'PROCESSING' and attempt_count = $4`,
        [input.inboundEventId, input.workspaceId, now, input.expectedAttemptCount],
      );
      if (ignored.rowCount !== 1) {
        throw new RecoveryServiceError("CONFLICT", "Receipt processing lease changed before revocation.");
      }
      stage = "COMMIT";
      await client.query("commit");
      return {
        submission: {
          id: input.inboundEventId,
          type: "FORWARDED_EMAIL",
          ingestedAt: now.toISOString(),
          acceptedEvidenceCount: 0,
          results: [],
        },
        commitmentTotal: 0,
        workspaceVersion: 0,
        replayed: false,
      };
    }

    const workspace = await client.query(`select 1 from workspaces where id = $1 for share`, [input.workspaceId]);
    if (!workspace.rows[0]) throw new RecoveryServiceError("NOT_FOUND");
    const state = await ensureWorkspaceState(client, input.workspaceId);
    stage = "SUBMISSION";
    const submission = await client.query<{ id: string; ingested_at: Date }>(
      `insert into recovery_submissions (
         workspace_id, submitted_by_user_id, source_type, inbound_event_id, ingested_at
       ) values ($1, null, $2, $3, $4)
       returning id, ingested_at`,
      [envelope.workspaceId, envelope.sourceType, envelope.consentReference, envelope.capturedAt],
    );
    const submissionRow = submission.rows[0];
    if (!submissionRow) throw new RecoveryServiceError("SAVE_FAILED");

    stage = "SOURCE_PERSISTENCE";
    const materialized = await persistSubmissionSources(client, {
      workspaceId: envelope.workspaceId,
      submissionId: submissionRow.id,
      inboundEventId: input.inboundEventId,
      request,
      envelope,
      currencyHint,
    });
    await client.query(
      `update recovery_submissions
       set accepted_evidence_count = $3, results = $4::jsonb
       where workspace_id = $1 and id = $2`,
      [input.workspaceId, submissionRow.id, materialized.acceptedEvidenceCount, JSON.stringify(materialized.results)],
    );

    let workspaceVersion = Number(state.version);
    if (materialized.acceptedSourceIds.length) {
      const before = await loadCommitmentRecords(client, input.workspaceId);
      stage = "REANALYSIS";
      const audit = await analyzePersistedEvidence(client, input.workspaceId, now);
      stage = "COMMITMENT_UPSERT";
      await upsertCanonicalCommitments(client, input.workspaceId, audit.recurringItems);
      stage = "EVIDENCE_LINKING";
      await linkCanonicalEvidence(client, input.workspaceId, audit.recurringItems);
      const after = await loadCommitmentRecords(client, input.workspaceId);
      const nextVersion = workspaceVersion + 1;
      stage = "CHANGE_PERSISTENCE";
      const changes = state.baseline_version === null
        ? []
        : await persistChanges(client, input.workspaceId, workspaceVersion, nextVersion, before, after, {
            kind: "EVIDENCE",
            submissionId: submissionRow.id,
            sourceIds: materialized.acceptedSourceIds,
          }, now);
      stage = "VERSION_ADVANCE";
      workspaceVersion = await advanceWorkspaceVersion(client, {
        workspaceId: input.workspaceId,
        actorUserId: null,
        currentState: state,
        mutationKind: "EVIDENCE",
        changes,
      });
      stage = "ALERT_SCHEDULING";
      await scheduleRenewalAlertsForWorkspace(input.workspaceId, client);
    }

    await refreshAutopilotCandidates(client, input.workspaceId);

    const submissionDto: EvidenceSubmissionDto = {
      id: submissionRow.id,
      type: envelope.sourceType,
      ingestedAt: submissionRow.ingested_at.toISOString(),
      acceptedEvidenceCount: materialized.acceptedEvidenceCount,
      results: materialized.results,
    };
    const commitmentTotal = Number((await client.query<{ total: string }>(
      `select count(*)::text as total from recovery_commitments where workspace_id = $1`,
      [input.workspaceId],
    )).rows[0]?.total ?? 0);
    const response = { submission: submissionDto, commitmentTotal };
    stage = "IDEMPOTENCY";
    await writeIdempotent(client, envelope.workspaceId, envelope.idempotencyKey, operation, envelope.requestHash, response, workspaceVersion);
    const accepted = materialized.acceptedEvidenceCount > 0;
    stage = "EVENT_COMPLETION";
    const completedEvent = await client.query(
      `update recovery_inbound_events
         set status = $3, processing_started_at = null,
           processed_at = $4, error_code = $5
       where id = $1 and workspace_id = $2
         and status = 'PROCESSING' and attempt_count = $6`,
      [input.inboundEventId, input.workspaceId, accepted ? "PROCESSED" : "TERMINAL_FAILED", now, accepted ? null : "PARSE_FAILED", input.expectedAttemptCount],
    );
    if (completedEvent.rowCount !== 1) {
      throw new RecoveryServiceError("CONFLICT", "Receipt processing lease changed before completion.");
    }
    if (accepted && eventRow.alias_id) {
      const acceptedBackfillRefs = new Set(
        (input.historicalBackfillClientRefs ?? []).map((clientRef) => `client-${sha256(clientRef).slice(0, 16)}`),
      );
      const acceptedBackfillCount = materialized.results.filter((result) => (
        result.status === "ACCEPTED" && acceptedBackfillRefs.has(result.clientRef)
      )).length;
      const milestones = await client.query<{
        setup_completed_at: Date;
        forwarding_verified_at: Date | null;
        backfill_completed_at: Date | null;
        created_at: Date;
      }>(
        `update recovery_inbound_aliases
         set setup_completed_at = coalesce(setup_completed_at, greatest($3, created_at)),
             forwarding_verified_at = case
               when gmail_verification_received_at is not null
                 then coalesce(forwarding_verified_at, greatest($3, created_at))
               else forwarding_verified_at
             end,
             backfill_completed_at = case
               when $4::int > 0 then coalesce(backfill_completed_at, greatest($3, created_at))
               else backfill_completed_at
             end,
             gmail_verification_code = case when gmail_verification_received_at is not null then null else gmail_verification_code end,
             gmail_verification_url = case when gmail_verification_received_at is not null then null else gmail_verification_url end,
             gmail_verification_received_at = case when gmail_verification_received_at is not null then null else gmail_verification_received_at end
         where workspace_id = $1 and id = $2 and status = 'ACTIVE'
         returning setup_completed_at, forwarding_verified_at, backfill_completed_at, created_at`,
        [input.workspaceId, eventRow.alias_id, now, acceptedBackfillCount],
      );
      const milestone = milestones.rows[0];
      if (milestone) {
        const setupDurationMs = Math.min(
          86_400_000,
          Math.max(0, milestone.setup_completed_at.getTime() - milestone.created_at.getTime()),
        );
        await recordConsentedProductEvent({
          workspaceId: input.workspaceId,
          eventName: "receipt_setup.completed",
          occurredAt: milestone.setup_completed_at.toISOString(),
          source: "workspace-api",
          status: "succeeded",
          durationMs: setupDurationMs,
        }, client);
        if (milestone.forwarding_verified_at) {
          await recordConsentedProductEvent({
            workspaceId: input.workspaceId,
            eventName: "receipt_forwarding.verified",
            occurredAt: milestone.forwarding_verified_at.toISOString(),
            source: "workspace-api",
            status: "succeeded",
          }, client);
        }
        if (milestone.backfill_completed_at) {
          await recordConsentedProductEvent({
            workspaceId: input.workspaceId,
            eventName: "receipt_backfill.completed",
            occurredAt: milestone.backfill_completed_at.toISOString(),
            source: "workspace-api",
            status: "succeeded",
            metrics: { recordsSeen: acceptedBackfillCount },
          }, client);
        }
      }
      if (commitmentTotal > 0) {
        await recordConsentedProductEvent({
          workspaceId: input.workspaceId,
          eventName: "commitments.detected",
          occurredAt: now.toISOString(),
          source: "workspace-api",
          status: "succeeded",
          metrics: { commitmentsDetected: commitmentTotal },
        }, client);
      }
    }
    stage = "AUDIT";
    await writeRecoveryAudit(client, input.workspaceId, null, "recovery.forwarded-email.materialized", submissionRow.id, {
      actorKind: "system",
      provider: "resend",
      acceptedEvidenceCount: materialized.acceptedEvidenceCount,
      workspaceVersion,
    });
    stage = "COMMIT";
    await client.query("commit");
    return { ...response, workspaceVersion, replayed: false };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw new RecoveryMaterializationError(stage, normalizeStoreError(error));
  } finally {
    client.release();
  }
}

export async function getRecoveryHome(input: {
  workspaceId: string;
  actorUserId: string;
  generatedAt?: Date;
}) {
  return withRecoveryRead(async (client) => {
    const membership = await assertRecoveryRole(client, input.actorUserId, input.workspaceId, "viewer", { lock: false });
    return await loadHome(client, membership, input.generatedAt ?? new Date());
  });
}

export async function listRecoveryCommitments(input: {
  workspaceId: string;
  actorUserId: string;
  limit?: number;
  cursor?: string;
}) {
  return withRecoveryRead(async (client) => {
    await assertRecoveryRole(client, input.actorUserId, input.workspaceId, "viewer", { lock: false });
    const state = await readWorkspaceState(client, input.workspaceId);
    const limit = boundedPageSize(input.limit, 25, 50);
    const cursor = decodeCursor(input.cursor);
    const result = await client.query<CommitmentRow>(
      `${commitmentSelect}
       where commitment.workspace_id = $1
         and ($2::timestamptz is null or (commitment.updated_at, commitment.id) < ($2::timestamptz, $3::uuid))
       group by commitment.id, decision.decision, decision.decided_at, decision.updated_at
       order by commitment.updated_at desc, commitment.id desc
       limit $4`,
      [input.workspaceId, cursor?.at ?? null, cursor?.id ?? null, limit + 1],
    );
    const count = await client.query<{ total: string }>(
      `select count(*)::text as total from recovery_commitments where workspace_id = $1`,
      [input.workspaceId],
    );
    const page = result.rows.slice(0, limit);
    return {
      items: page.map(toCommitmentSummary),
      total: Number(count.rows[0]?.total ?? 0),
      nextCursor: result.rows.length > limit && page.length
        ? encodeCursor(page.at(-1)!.updated_at, page.at(-1)!.id)
        : null,
      workspaceVersion: Number(state?.version ?? 0),
    };
  });
}

export async function getRecoveryCommitment(input: {
  workspaceId: string;
  actorUserId: string;
  commitmentId: string;
  evidenceLimit?: number;
  evidenceCursor?: string;
}) {
  return withRecoveryRead(async (client) => {
    await assertRecoveryRole(client, input.actorUserId, input.workspaceId, "viewer", { lock: false });
    const state = await readWorkspaceState(client, input.workspaceId);
    const commitment = await getCommitmentRow(client, input.workspaceId, input.commitmentId);
    if (!commitment) throw new RecoveryServiceError("NOT_FOUND");
    return {
      commitment: await buildCommitmentDetail(client, input.workspaceId, commitment, input.evidenceLimit, input.evidenceCursor),
      workspaceVersion: Number(state?.version ?? 0),
    };
  });
}

export async function getRecoveryEvidence(input: {
  workspaceId: string;
  actorUserId: string;
  evidenceId: string;
}) {
  return withRecoveryRead(async (client) => {
    await assertRecoveryRole(client, input.actorUserId, input.workspaceId, "viewer", { lock: false });
    const state = await readWorkspaceState(client, input.workspaceId);
    const result = await client.query<EvidenceRow>(
      `select evidence.id, evidence.source_id, source.source_type,
              source.label as source_label, source.ingested_at as source_ingested_at,
              source.coverage_start as source_coverage_start,
              source.coverage_end as source_coverage_end,
              evidence.evidence_kind, evidence.row_number, evidence.observed_at,
              evidence.excerpt, evidence.excerpt_truncated, evidence.merchant,
              evidence.normalized_merchant, evidence.category, evidence.amount_minor,
              evidence.currency, evidence.evidence_date, evidence.direction,
              evidence.cadence_hint, evidence.next_expected_date,
              evidence.provenance_kind, evidence.provenance_reference,
              sender_assessment.trust_tier as sender_trust_tier,
              sender_assessment.from_domain as sender_from_domain,
              sender_assessment.trusted_authority as sender_trusted_authority,
              sender_assessment.reasons as sender_trust_reasons,
              evidence.confidence_state, evidence.confidence_score,
              evidence.confidence_reasons, evidence.created_at
       from recovery_evidence evidence
       join recovery_sources source
         on source.workspace_id = evidence.workspace_id and source.id = evidence.source_id
       left join lateral (
         select assessment.trust_tier, assessment.from_domain,
                assessment.trusted_authority, assessment.reasons
         from recovery_inbound_sender_assessments assessment
         where assessment.workspace_id = evidence.workspace_id
           and assessment.source_id = evidence.source_id
         order by assessment.assessed_at desc, assessment.id desc
         limit 1
       ) sender_assessment on true
       where evidence.workspace_id = $1 and evidence.id = $2
       limit 1`,
      [input.workspaceId, input.evidenceId],
    );
    const evidence = result.rows[0];
    if (!evidence) throw new RecoveryServiceError("NOT_FOUND");
    return { evidence: toEvidenceDto(evidence), workspaceVersion: Number(state?.version ?? 0) };
  });
}

export async function listRecoveryDecisions(input: {
  workspaceId: string;
  actorUserId: string;
}) {
  return withRecoveryRead(async (client) => {
    await assertRecoveryRole(client, input.actorUserId, input.workspaceId, "viewer", { lock: false });
    const state = await readWorkspaceState(client, input.workspaceId);
    const result = await client.query<{
      commitment_id: string;
      decision: Decision;
      decided_at: Date;
      updated_at: Date;
    }>(
      `select commitment_id, decision, decided_at, updated_at
       from recovery_decisions
       where workspace_id = $1
       order by updated_at desc, commitment_id asc`,
      [input.workspaceId],
    );
    return {
      decisions: result.rows.map((row) => ({
        commitmentId: row.commitment_id,
        value: row.decision,
        decidedAt: row.decided_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      })),
      workspaceVersion: Number(state?.version ?? 0),
    };
  });
}

export async function submitRecoveryEvidence(input: {
  workspaceId: string;
  actorUserId: string;
  expectedVersion: number;
  idempotencyKey: string;
  request: EvidenceIngestRequest;
  now?: Date;
}): Promise<{ data: SubmitEvidenceResponse["data"]; workspaceVersion: number; replayed: boolean }> {
  const operation = "recovery.submit-evidence";
  const requestHash = hashRecoveryRequest({ operation, request: input.request });
  const envelope = buildRecoveryIngestionEnvelope({
    workspaceId: input.workspaceId,
    sourceType: input.request.kind,
    idempotencyKey: input.idempotencyKey,
    requestHash,
    capturedAt: (input.now ?? new Date()).toISOString(),
  });
  const client = await getDatabasePool().connect();
  const now = new Date(envelope.capturedAt);
  try {
    await client.query("begin");
    await lockAutopilotAuthorityGate(client);
    await lockRecoveryWorkspace(client, input.workspaceId);
    const membership = await assertRecoveryRole(client, input.actorUserId, input.workspaceId, "member");
    const replay = await readIdempotent<SubmitEvidenceResponse["data"]>(client, envelope.workspaceId, envelope.idempotencyKey, operation, envelope.requestHash);
    if (replay) {
      await client.query("commit");
      return { data: replay.response, workspaceVersion: replay.workspaceVersion, replayed: true };
    }
    const state = await ensureWorkspaceState(client, input.workspaceId);
    assertWorkspaceVersion(state, input.expectedVersion);

    const submission = await client.query<{ id: string; ingested_at: Date }>(
      `insert into recovery_submissions (workspace_id, submitted_by_user_id, source_type, ingested_at)
       values ($1, $2, $3, $4)
       returning id, ingested_at`,
      [envelope.workspaceId, input.actorUserId, envelope.sourceType, envelope.capturedAt],
    );
    const submissionRow = submission.rows[0];
    if (!submissionRow) throw new RecoveryServiceError("SAVE_FAILED");

    const materialized = await persistSubmissionSources(client, {
      workspaceId: envelope.workspaceId,
      submissionId: submissionRow.id,
      request: input.request,
      envelope,
    });
    await client.query(
      `update recovery_submissions
       set accepted_evidence_count = $3, results = $4::jsonb
       where workspace_id = $1 and id = $2`,
      [input.workspaceId, submissionRow.id, materialized.acceptedEvidenceCount, JSON.stringify(materialized.results)],
    );

    let workspaceVersion = Number(state.version);
    if (materialized.acceptedSourceIds.length) {
      const before = await loadCommitmentRecords(client, input.workspaceId);
      const audit = await analyzePersistedEvidence(client, input.workspaceId, now);
      await upsertCanonicalCommitments(client, input.workspaceId, audit.recurringItems);
      await linkCanonicalEvidence(client, input.workspaceId, audit.recurringItems);
      const after = await loadCommitmentRecords(client, input.workspaceId);
      const nextVersion = workspaceVersion + 1;
      const firstBaseline = state.baseline_version === null;
      const changes = firstBaseline
        ? []
        : await persistChanges(client, input.workspaceId, workspaceVersion, nextVersion, before, after, {
            kind: "EVIDENCE",
            submissionId: submissionRow.id,
            sourceIds: materialized.acceptedSourceIds,
          }, now);
      workspaceVersion = await advanceWorkspaceVersion(client, {
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        currentState: state,
        mutationKind: "EVIDENCE",
        changes,
      });
      await scheduleRenewalAlertsForWorkspace(input.workspaceId, client);
    }

    await refreshAutopilotCandidates(client, input.workspaceId);
    const currentState = await readWorkspaceState(client, input.workspaceId);
    const home = await loadHome(client, membership, now, currentState ?? state);
    const commitments = (await loadCommitmentRows(client, input.workspaceId)).map(toCommitmentSummary);
    const data: SubmitEvidenceResponse["data"] = {
      submission: {
        id: submissionRow.id,
        type: envelope.sourceType,
        ingestedAt: submissionRow.ingested_at.toISOString(),
        acceptedEvidenceCount: materialized.acceptedEvidenceCount,
        results: materialized.results,
      },
      home,
      commitments,
      commitmentTotal: commitments.length,
    };
    await writeIdempotent(client, envelope.workspaceId, envelope.idempotencyKey, operation, envelope.requestHash, data, workspaceVersion);
    await writeRecoveryAudit(client, envelope.workspaceId, input.actorUserId, "recovery.evidence.submitted", submissionRow.id, {
      sourceType: envelope.sourceType,
      acceptedEvidenceCount: materialized.acceptedEvidenceCount,
      rejectedCount: materialized.results.filter((result) => result.status === "REJECTED").length,
      workspaceVersion,
    });
    await client.query("commit");
    return { data, workspaceVersion, replayed: false };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw normalizeStoreError(error);
  } finally {
    client.release();
  }
}

export async function createRecoveryCorrection(input: {
  workspaceId: string;
  actorUserId: string;
  commitmentId: string;
  expectedVersion: number;
  idempotencyKey: string;
  request: CreateCorrectionRequest;
  now?: Date;
}) {
  return mutateCorrection({ ...input, reverseCorrectionId: null });
}

export async function reverseRecoveryCorrection(input: {
  workspaceId: string;
  actorUserId: string;
  commitmentId: string;
  correctionId: string;
  expectedVersion: number;
  idempotencyKey: string;
  now?: Date;
}) {
  return mutateCorrection({
    ...input,
    request: null,
    reverseCorrectionId: input.correctionId,
  });
}

export async function putRecoveryDecision(input: {
  workspaceId: string;
  actorUserId: string;
  expectedVersion: number;
  idempotencyKey: string;
  request: PutDecisionRequest;
  now?: Date;
}) {
  const client = await getDatabasePool().connect();
  const operation = "recovery.put-decision";
  const requestHash = hashRecoveryRequest({ operation, request: input.request });
  const now = input.now ?? new Date();
  try {
    await client.query("begin");
    await lockAutopilotAuthorityGate(client);
    await lockRecoveryWorkspace(client, input.workspaceId);
    const membership = await assertRecoveryRole(client, input.actorUserId, input.workspaceId, "member");
    const replay = await readIdempotent<PutDecisionMutationData>(client, input.workspaceId, input.idempotencyKey, operation, requestHash);
    if (replay) {
      await client.query("commit");
      return { data: replay.response, workspaceVersion: replay.workspaceVersion, replayed: true };
    }
    const state = await ensureWorkspaceState(client, input.workspaceId);
    assertWorkspaceVersion(state, input.expectedVersion);
    const commitment = await getCommitmentRow(client, input.workspaceId, input.request.commitmentId);
    if (!commitment) throw new RecoveryServiceError("NOT_FOUND");
    const decision = await client.query<{ decision: Decision; decided_at: Date; updated_at: Date }>(
      `insert into recovery_decisions (workspace_id, commitment_id, decided_by_user_id, decision, decided_at, updated_at)
       values ($1, $2, $3, $4, $5, $5)
       on conflict (workspace_id, commitment_id)
       do update set decision = excluded.decision,
                     decided_by_user_id = excluded.decided_by_user_id,
                     updated_at = excluded.updated_at
       returning decision, decided_at, updated_at`,
      [input.workspaceId, input.request.commitmentId, input.actorUserId, input.request.decision, now],
    );
    const workspaceVersion = await advanceWorkspaceVersion(client, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      currentState: state,
      mutationKind: "DECISION",
      changes: [],
    });
    await scheduleRenewalAlertsForWorkspace(input.workspaceId, client);
    await refreshAutopilotCandidates(client, input.workspaceId);
    const updated = await getCommitmentRow(client, input.workspaceId, input.request.commitmentId);
    if (!updated || !decision.rows[0]) throw new RecoveryServiceError("SAVE_FAILED");
    const data: PutDecisionMutationData = {
      decision: {
        value: decision.rows[0].decision,
        decidedAt: decision.rows[0].decided_at.toISOString(),
        updatedAt: decision.rows[0].updated_at.toISOString(),
      },
      commitment: toCommitmentSummary(updated),
      home: await loadHome(client, membership, now),
    };
    await writeIdempotent(client, input.workspaceId, input.idempotencyKey, operation, requestHash, data, workspaceVersion);
    await writeRecoveryAudit(client, input.workspaceId, input.actorUserId, "recovery.decision.saved", input.request.commitmentId, {
      decision: input.request.decision,
      workspaceVersion,
    });
    await client.query("commit");
    return { data, workspaceVersion, replayed: false };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw normalizeStoreError(error);
  } finally {
    client.release();
  }
}

type PutDecisionMutationData = {
  decision: { value: Decision; decidedAt: string; updatedAt: string };
  commitment: CommitmentSummaryDto;
  home: HomeProjectionDto;
};

type CorrectionMutationData = {
  correction: CorrectionDto;
  commitment: CommitmentDetailDto;
  home: HomeProjectionDto;
};

async function mutateCorrection(input: {
  workspaceId: string;
  actorUserId: string;
  commitmentId: string;
  expectedVersion: number;
  idempotencyKey: string;
  request: CreateCorrectionRequest | null;
  reverseCorrectionId: string | null;
  now?: Date;
}) {
  const client = await getDatabasePool().connect();
  const operation = input.reverseCorrectionId ? "recovery.reverse-correction" : "recovery.create-correction";
  const requestHash = hashRecoveryRequest({
    operation,
    commitmentId: input.commitmentId,
    correctionId: input.reverseCorrectionId,
    request: input.request,
  });
  const now = input.now ?? new Date();
  try {
    await client.query("begin");
    await lockAutopilotAuthorityGate(client);
    await lockRecoveryWorkspace(client, input.workspaceId);
    const membership = await assertRecoveryRole(client, input.actorUserId, input.workspaceId, "member");
    const replay = await readIdempotent<CorrectionMutationData>(client, input.workspaceId, input.idempotencyKey, operation, requestHash);
    if (replay) {
      await client.query("commit");
      return { data: replay.response, workspaceVersion: replay.workspaceVersion, replayed: true };
    }
    const state = await ensureWorkspaceState(client, input.workspaceId);
    assertWorkspaceVersion(state, input.expectedVersion);
    const beforeRows = await loadCommitmentRecords(client, input.workspaceId);
    const target = beforeRows.find((commitment) => commitment.id === input.commitmentId);
    if (!target) throw new RecoveryServiceError("NOT_FOUND");

    let correctionRow: CorrectionRow | undefined;
    if (input.reverseCorrectionId) {
      const existing = await client.query<CorrectionRow>(
        `${correctionSelect}
         where correction.workspace_id = $1
           and correction.commitment_id = $2
           and correction.id = $3
         for update`,
        [input.workspaceId, input.commitmentId, input.reverseCorrectionId],
      );
      correctionRow = existing.rows[0];
      if (!correctionRow) throw new RecoveryServiceError("NOT_FOUND");
      if (correctionRow.status !== "ACTIVE") throw new RecoveryServiceError("CONFLICT", "Only an active correction can be reversed.");
      const reversed = await client.query<CorrectionRow>(
        `update recovery_corrections correction
         set status = 'REVERSED', reversed_at = $4
         where correction.workspace_id = $1
           and correction.commitment_id = $2
           and correction.id = $3
         returning correction.id, correction.commitment_id, correction.field,
                   correction.patch, correction.reason, correction.status,
                   correction.created_at, correction.reversed_at, correction.superseded_at`,
        [input.workspaceId, input.commitmentId, input.reverseCorrectionId, now],
      );
      correctionRow = reversed.rows[0];
    } else {
      if (!input.request) throw new RecoveryServiceError("INVALID_EVIDENCE");
      await client.query(
        `update recovery_corrections
         set status = 'SUPERSEDED', superseded_at = $4
         where workspace_id = $1
           and commitment_id = $2
           and field = $3
           and status = 'ACTIVE'`,
        [input.workspaceId, input.commitmentId, input.request.patch.field, now],
      );
      const inserted = await client.query<CorrectionRow>(
        `insert into recovery_corrections (
           workspace_id, commitment_id, created_by_user_id, field, patch, reason, created_at
         ) values ($1, $2, $3, $4, $5::jsonb, $6, $7)
         returning id, commitment_id, field, patch, reason, status,
                   created_at, reversed_at, superseded_at`,
        [
          input.workspaceId,
          input.commitmentId,
          input.actorUserId,
          input.request.patch.field,
          JSON.stringify(input.request.patch),
          input.request.reason?.trim() || null,
          now,
        ],
      );
      correctionRow = inserted.rows[0];
    }
    if (!correctionRow) throw new RecoveryServiceError("SAVE_FAILED");

    await recomputeEffectiveCommitment(client, input.workspaceId, input.commitmentId);
    const afterRows = await loadCommitmentRecords(client, input.workspaceId);
    const nextVersion = Number(state.version) + 1;
    const changes = await persistChanges(
      client,
      input.workspaceId,
      Number(state.version),
      nextVersion,
      beforeRows,
      afterRows,
      input.reverseCorrectionId
        ? { kind: "CORRECTION_REVERSAL", correctionId: correctionRow.id }
        : { kind: "CORRECTION", correctionId: correctionRow.id },
      now,
    );
    const workspaceVersion = await advanceWorkspaceVersion(client, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      currentState: state,
      mutationKind: input.reverseCorrectionId ? "CORRECTION_REVERSAL" : "CORRECTION",
      changes,
    });
    await scheduleRenewalAlertsForWorkspace(input.workspaceId, client);
    await refreshAutopilotCandidates(client, input.workspaceId);
    const updated = await getCommitmentRow(client, input.workspaceId, input.commitmentId);
    if (!updated) throw new RecoveryServiceError("SAVE_FAILED");
    const data: CorrectionMutationData = {
      correction: toCorrectionDto(correctionRow, updated.base_currency),
      commitment: await buildCommitmentDetail(client, input.workspaceId, updated),
      home: await loadHome(client, membership, now),
    };
    await writeIdempotent(client, input.workspaceId, input.idempotencyKey, operation, requestHash, data, workspaceVersion);
    await writeRecoveryAudit(
      client,
      input.workspaceId,
      input.actorUserId,
      input.reverseCorrectionId ? "recovery.correction.reversed" : "recovery.correction.created",
      correctionRow.id,
      { commitmentId: input.commitmentId, field: correctionRow.field, workspaceVersion },
    );
    if (!input.reverseCorrectionId) {
      await recordConsentedProductEvent({
        workspaceId: input.workspaceId,
        userId: input.actorUserId,
        eventName: "correction.recorded",
        occurredAt: correctionRow.created_at.toISOString(),
        source: "workspace-api",
        status: "succeeded",
        metrics: { correctionsRecorded: 1 },
      }, client);
    }
    await client.query("commit");
    return { data, workspaceVersion, replayed: false };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw normalizeStoreError(error);
  } finally {
    client.release();
  }
}

async function persistSubmissionSources(client: PoolClient, input: {
  workspaceId: string;
  submissionId: string;
  inboundEventId?: string | null;
  request: EvidenceIngestRequest | ForwardedEmailMaterializationRequest;
  envelope: RecoveryIngestionEnvelope;
  currencyHint?: ReceiptCurrencyHint | null;
}) {
  const capturedAt = new Date(input.envelope.capturedAt);
  const existingEvidence = await client.query<{ total: string }>(
    `select count(*)::text as total from recovery_evidence where workspace_id = $1`,
    [input.workspaceId],
  );
  let projectedEvidenceCount = Number(existingEvidence.rows[0]?.total ?? 0);
  if (projectedEvidenceCount > recoveryLimits.maxWorkspaceEvidenceRecords) throw new RecoveryServiceError("REQUEST_TOO_LARGE");
  const results: EvidenceSubmissionDto["results"][number][] = [];
  const acceptedSourceIds: string[] = [];
  let acceptedEvidenceCount = 0;
  const receiptSource = input.envelope.sourceType !== "CSV_IMPORT";
  const entries = input.envelope.sourceType === "CSV_IMPORT"
    ? (input.request as Extract<EvidenceIngestRequest, { kind: "CSV_IMPORT" }>).sources.map((source) => ({ clientRef: source.clientRef, text: storableText(source.text), provenance: undefined }))
    : (input.request as Exclude<EvidenceIngestRequest, { kind: "CSV_IMPORT" }> | ForwardedEmailMaterializationRequest).receipts.map((receipt) => ({
        clientRef: receipt.clientRef,
        text: storableText(receipt.text),
        // Only the forwarded-email path observes transport headers; a paste has none.
        provenance: input.envelope.sourceType === "FORWARDED_EMAIL"
          ? (receipt as ForwardedEmailMaterializationRequest["receipts"][number]).provenance
          : undefined,
      }));

  const inboundEventId = input.envelope.sourceType === "FORWARDED_EMAIL" ? input.inboundEventId ?? null : null;

  for (const entry of entries) {
    const storedClientRef = `client-${sha256(entry.clientRef).slice(0, 16)}`;
    const retainSenderAssessment = (sourceId: string | null) => recordSenderAssessment(client, {
      workspaceId: input.workspaceId,
      inboundEventId,
      clientRef: storedClientRef,
      sourceId,
      provenance: entry.provenance,
    });
    const contentHash = sha256(`${receiptSource ? "RECEIPT" : "CSV_IMPORT"}\0${entry.text}`);
    const duplicateHashes = receiptSource
      ? [contentHash, sha256(`RECEIPT_PASTE\0${entry.text}`), sha256(`FORWARDED_EMAIL\0${entry.text}`), sha256(`GMAIL_OAUTH\0${entry.text}`)]
      : [contentHash];
    const duplicate = await client.query(
      `select 1 from recovery_sources where workspace_id = $1 and content_hash = any($2::text[]) limit 1`,
      [input.workspaceId, duplicateHashes],
    );
    if (duplicate.rows[0]) {
      await retainSenderAssessment(null);
      results.push({
        clientRef: storedClientRef,
        status: "REJECTED",
        code: "DUPLICATE_EVIDENCE",
        message: "That exact evidence is already saved in this workspace.",
      });
      continue;
    }

    const sourceId = randomUUID();
    const storedLabel = input.envelope.sourceType === "RECEIPT_PASTE"
      ? "Pasted receipt"
      : input.envelope.sourceType === "FORWARDED_EMAIL"
        ? "Forwarded email"
        : "Imported statement";
    const sourceName = sourceEngineName(sourceId);
    const extracted = receiptSource
      ? extractReceiptEvidence(
          entry.text,
          sourceId,
          sourceName,
          input.submissionId,
          capturedAt,
          input.envelope.provenanceKind,
          input.envelope.sourceType === "FORWARDED_EMAIL" ? input.currencyHint ?? null : null,
        )
      : extractCsvEvidence(entry.text, sourceId, sourceName, input.submissionId, capturedAt);
    if (!extracted.length) {
      await retainSenderAssessment(null);
      results.push({
        clientRef: storedClientRef,
        status: "REJECTED",
        code: "PARSE_FAILED",
        message: "No bounded recurring evidence could be established.",
      });
      continue;
    }
    const novelEvidence = receiptSource
      ? await filterNovelReceiptEvidence(client, input.workspaceId, extracted)
      : extracted;
    if (!novelEvidence.length) {
      results.push({
        clientRef: storedClientRef,
        status: "REJECTED",
        code: "DUPLICATE_EVIDENCE",
        message: "A receipt with the same merchant, amount, and dates is already saved in this workspace.",
      });
      continue;
    }
    projectedEvidenceCount += novelEvidence.length;
    if (projectedEvidenceCount > recoveryLimits.maxWorkspaceEvidenceRecords) {
      throw new RecoveryServiceError("REQUEST_TOO_LARGE", "Recovery workspace evidence limit reached.");
    }

    const dates = novelEvidence.map((evidence) => evidence.evidenceDate).sort();
    const encrypted = encryptSecret(entry.text, recoveryRawAssociatedData(input.workspaceId, sourceId));
    await client.query(
      `insert into recovery_sources (
         id, workspace_id, submission_id, source_type, client_ref, label,
         content_hash, raw_evidence, coverage_start, coverage_end, ingested_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)`,
      [
        sourceId,
        input.workspaceId,
        input.submissionId,
        input.envelope.sourceType,
        storedClientRef,
        storedLabel,
        contentHash,
        JSON.stringify({ encrypted: true, payload: encrypted }),
        input.envelope.coverageStart ?? dates[0] ?? null,
        input.envelope.coverageEnd ?? dates.at(-1) ?? null,
        input.envelope.capturedAt,
      ],
    );
    await recordConsentedProductEvent({
      workspaceId: input.workspaceId,
      eventName: "source.connected",
      source: "workspace-api",
      status: "succeeded",
    }, client);
    for (const evidence of novelEvidence) {
      evidence.provenanceKind = input.envelope.provenanceKind;
      evidence.provenanceReference = evidenceProvenanceReference(
        input.envelope,
        input.submissionId,
        sourceId,
        evidence.rowNumber,
      );
      applySenderTrustCeiling(evidence, entry.provenance);
      await insertExtractedEvidence(client, input.workspaceId, evidence);
    }
    await retainSenderAssessment(sourceId);
    acceptedSourceIds.push(sourceId);
    acceptedEvidenceCount += novelEvidence.length;
    results.push({ clientRef: storedClientRef, status: "ACCEPTED", code: null, message: null });
  }
  return { results, acceptedSourceIds, acceptedEvidenceCount };
}

/**
 * PostgreSQL rejects U+0000 in text and jsonb. Real invoice PDFs decode unmapped
 * glyphs to it, so the character is marked unreadable rather than guessed at.
 */
function storableText(value: string) {
  return value.includes("\u0000") ? value.replaceAll("\u0000", "\uFFFD") : value;
}

function evidenceProvenanceReference(
  envelope: RecoveryIngestionEnvelope,
  submissionId: string,
  sourceId: string,
  rowNumber: number,
) {
  const base = `${submissionId}:${sourceId}:${rowNumber}`;
  return envelope.consentReference ? `${envelope.consentReference}:${base}` : base;
}

/**
 * How well the sender is established bounds what a single forwarded receipt may
 * assert. Weak transport provenance still keeps the evidence visible; it simply
 * cannot carry a trusted recurring-money claim on its own.
 */
function applySenderTrustCeiling(evidence: ExtractedEvidence, provenance: SenderProvenanceDto | undefined) {
  if (!provenance) return;
  const ceiling = senderTrustConfidenceCeiling(provenance.tier);
  if (evidence.confidenceScore <= ceiling) return;
  evidence.confidenceScore = ceiling;
  evidence.confidenceReasons = [...evidence.confidenceReasons, senderTrustCeilingReason(provenance)];
}

function senderTrustCeilingReason(provenance: SenderProvenanceDto) {
  const domain = provenance.fromDomain ?? "an unidentified domain";
  switch (provenance.tier) {
    case "VERIFIED_SENDER":
      return `Sender ${domain} passed authentication at ${provenance.trustedAuthority ?? "the forwarding provider"}.`;
    case "KNOWN_SENDER":
      return `Sender ${domain} is recognised but its mail was not independently authenticated.`;
    case "SUSPICIOUS_SENDER":
      return `Sender ${domain} failed or contradicted mail authentication, so this receipt is held below a trusted claim.`;
    case "UNVERIFIED_SENDER":
      return `Sender ${domain} could not be established, so this receipt cannot carry a trusted claim on its own.`;
  }
}

/**
 * Sender provenance is retained even when the receipt is rejected, so source
 * health can always explain what arrived. Only domain-level facts are stored.
 */
async function recordSenderAssessment(client: PoolClient, input: {
  workspaceId: string;
  inboundEventId: string | null;
  clientRef: string;
  sourceId: string | null;
  provenance: SenderProvenanceDto | undefined;
}) {
  if (!input.provenance) return;
  await client.query(
    `insert into recovery_inbound_sender_assessments (
       workspace_id, inbound_event_id, client_ref, source_id, trust_tier,
       from_domain, trusted_authority, assertions, signing_domains, reasons
     ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::text[], $10::jsonb)
     on conflict (workspace_id, inbound_event_id, client_ref) do nothing`,
    [
      input.workspaceId,
      input.inboundEventId,
      input.clientRef,
      input.sourceId,
      input.provenance.tier,
      input.provenance.fromDomain,
      input.provenance.trustedAuthority,
      JSON.stringify(input.provenance.assertions),
      input.provenance.signingDomains,
      JSON.stringify(input.provenance.reasons),
    ],
  );
}

/**
 * Sending domains this workspace has already accepted evidence from *and* that
 * were established by an independent signal. Repetition alone is not evidence,
 * so an unverified or suspicious domain can never promote itself by sending
 * again.
 */
export async function listKnownSenderDomains(workspaceId: string, limit = 200) {
  const result = await getDatabasePool().query<{ from_domain: string }>(
    `select distinct from_domain
     from recovery_inbound_sender_assessments
     where workspace_id = $1
       and source_id is not null
       and from_domain is not null
       and trust_tier in ('VERIFIED_SENDER', 'KNOWN_SENDER')
     limit $2`,
    [workspaceId, limit],
  );
  return result.rows.map((row) => row.from_domain);
}

async function filterNovelReceiptEvidence(client: PoolClient, workspaceId: string, evidenceRows: readonly ExtractedEvidence[]) {
  const novel: ExtractedEvidence[] = [];
  const seen = new Set<string>();
  for (const evidence of evidenceRows) {
    const fingerprint = evidenceFingerprint(evidence);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    const existing = await client.query(
      `select 1
       from recovery_evidence
       where workspace_id = $1
         and evidence_kind = 'RECEIPT'
         and (
           fingerprint = $2
           or (
             lower(normalized_merchant) = lower($3)
             and amount_minor is not distinct from $4::bigint
             and currency is not distinct from $5::char(3)
             and evidence_date is not distinct from $6::date
             and cadence_hint is not distinct from $7::text
             and next_expected_date is not distinct from $8::date
           )
         )
       limit 1`,
      [
        workspaceId,
        fingerprint,
        evidence.normalizedMerchant,
        evidence.amountMinor,
        evidence.currency,
        evidence.evidenceDate,
        evidence.cadenceHint,
        evidence.nextExpectedDate,
      ],
    );
    if (!existing.rows[0]) novel.push(evidence);
  }
  return novel;
}

function extractReceiptEvidence(
  text: string,
  sourceId: string,
  sourceName: string,
  submissionId: string,
  now: Date,
  provenanceKind: EvidenceProvenanceKind,
  currencyHint: ReceiptCurrencyHint | null,
): ExtractedEvidence[] {
  const declared: { candidate: ReceiptCandidate; normalizedSnippet: string }[] = [];
  const observed: ObservedReceipt[] = [];
  const redactedText = redactText(text).text;
  for (const snippet of splitReceiptSnippets(redactedText)) {
    const normalizedSnippet = snippet.replace(/\s+/g, " ").trim();
    const [candidate] = extractReceiptCandidates([snippet], currencyHint);
    if (candidate) {
      declared.push({ candidate, normalizedSnippet });
      continue;
    }
    const observation = extractObservedReceipt(snippet, currencyHint);
    if (observation) observed.push(observation);
  }
  const declaredEvidence = declared.flatMap(({ candidate, normalizedSnippet }, index) => {
    const item: ManualRecurringInput = {
      id: candidate.id,
      merchant: candidate.merchant,
      amount: candidate.amount,
      amountDecimal: candidate.amountDecimal,
      currency: candidate.currency,
      frequency: candidate.frequency,
      nextExpectedDate: candidate.nextExpectedDate,
      category: candidate.category,
      sourceName,
      evidenceDescription: candidate.evidenceText,
    };
    const audit = analyzeStatements([], [item], { today: now });
    const recurring = audit.recurringItems[0];
    if (!recurring) return [];
    const excerpt = (item.evidenceDescription || item.merchant).trim();
    return [{
      id: randomUUID(),
      sourceId,
      evidenceKind: "RECEIPT" as const,
      rowNumber: index + 1,
      observedAt: candidate.observedDate ? `${candidate.observedDate}T00:00:00.000Z` : null,
      excerpt,
      excerptTruncated: normalizedSnippet.length > excerpt.length,
      merchant: item.merchant,
      normalizedMerchant: recurring.normalizedMerchant,
      category: item.category || recurring.category,
      amountMinor: decimalToMinorUnits(candidate.amountDecimal, recurring.currency),
      currency: recurring.currency,
      evidenceDate: candidate.observedDate ?? item.nextExpectedDate,
      direction: null,
      cadenceHint: frequencyToCadence[item.frequency],
      nextExpectedDate: item.nextExpectedDate,
      provenanceKind,
      provenanceReference: `${submissionId}:${sourceId}:${index + 1}`,
      confidenceScore: recurring.confidenceScore,
      confidenceReasons: [recurring.recommendationReason],
    }];
  });
  return [
    ...declaredEvidence,
    ...extractObservedReceiptEvidence(observed, sourceId, sourceName, submissionId, now, provenanceKind, declaredEvidence.length),
  ];
}

function extractObservedReceiptEvidence(
  observed: readonly ObservedReceipt[],
  sourceId: string,
  sourceName: string,
  submissionId: string,
  now: Date,
  provenanceKind: EvidenceProvenanceKind,
  rowOffset: number,
): ExtractedEvidence[] {
  if (!observed.length) return [];
  return observed.flatMap((item, index) => {
    const lines = [
      "Date,Description,Debit,Credit,Currency",
      [item.observedDate, csvCell(item.merchant), item.amountDecimal, "", item.currency].join(","),
    ];
    const transaction = analyzeStatements([{ name: sourceName, text: `${lines.join("\n")}\n` }], [], { today: now }).transactions[0];
    if (!transaction) return [];
    return [{
      id: randomUUID(),
      sourceId,
      evidenceKind: "TRANSACTION" as const,
      rowNumber: rowOffset + index + 1,
      observedAt: `${transaction.date}T00:00:00.000Z`,
      excerpt: item.evidenceText,
      excerptTruncated: item.evidenceText.replace(/\s+/g, " ").trim().length > recoveryLimits.maxEvidenceExcerptCharacters,
      merchant: item.merchant,
      normalizedMerchant: transaction.normalizedMerchant,
      category: item.category,
      amountMinor: decimalToMinorUnits(transaction.amountDecimal, transaction.currency),
      currency: transaction.currency,
      evidenceDate: transaction.date,
      direction: transaction.direction,
      cadenceHint: null,
      nextExpectedDate: null,
      provenanceKind,
      provenanceReference: `${submissionId}:${sourceId}:${rowOffset + index + 1}`,
      confidenceScore: 55,
      confidenceReasons: ["Parsed deterministically from a receipt that proved a charge but stated no renewal date."],
    }];
  });
}

function extractCsvEvidence(
  text: string,
  sourceId: string,
  sourceName: string,
  submissionId: string,
  now: Date,
): ExtractedEvidence[] {
  const audit = analyzeStatements([{ name: sourceName, text }], [], { today: now });
  return audit.transactions.map((transaction) => ({
    id: randomUUID(),
    sourceId,
    evidenceKind: "TRANSACTION",
    rowNumber: transaction.rowNumber,
    observedAt: `${transaction.date}T00:00:00.000Z`,
    excerpt: transaction.description,
    excerptTruncated: transaction.description.replace(/\s+/g, " ").trim().length > recoveryLimits.maxEvidenceExcerptCharacters,
    merchant: transaction.normalizedMerchant,
    normalizedMerchant: transaction.normalizedMerchant,
    category: transaction.category,
    amountMinor: decimalToMinorUnits(transaction.amountDecimal, transaction.currency),
    currency: transaction.currency,
    evidenceDate: transaction.date,
    direction: transaction.direction,
    cadenceHint: null,
    nextExpectedDate: null,
    provenanceKind: "USER_SUBMITTED",
    provenanceReference: `${submissionId}:${sourceId}:${transaction.rowNumber}`,
    confidenceScore: 55,
    confidenceReasons: ["Parsed deterministically from a user-submitted CSV row."],
  }));
}

async function insertExtractedEvidence(client: PoolClient, workspaceId: string, evidence: ExtractedEvidence) {
  const excerpt = redactText(evidence.excerpt.replace(/\s+/g, " ").trim()).text;
  const boundedExcerpt = excerpt.slice(0, recoveryLimits.maxEvidenceExcerptCharacters);
  const merchant = redactText(evidence.merchant).text.slice(0, 240);
  const normalizedMerchant = redactText(evidence.normalizedMerchant).text.slice(0, 240);
  const fingerprint = evidenceFingerprint(evidence);
  await client.query(
    `insert into recovery_evidence (
       id, workspace_id, source_id, fingerprint, evidence_kind, row_number,
       observed_at, excerpt, excerpt_truncated, merchant, normalized_merchant,
       category, amount_minor, currency, evidence_date, direction, cadence_hint,
       next_expected_date, provenance_kind, provenance_reference, confidence_state,
       confidence_score, confidence_reasons
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
       $15, $16, $17, $18, $19, $20, $21, $22, $23::jsonb
     )`,
    [
      evidence.id,
      workspaceId,
      evidence.sourceId,
      fingerprint,
      evidence.evidenceKind,
      evidence.rowNumber,
      evidence.observedAt,
      boundedExcerpt,
      evidence.excerptTruncated || boundedExcerpt.length < excerpt.length,
      merchant,
      normalizedMerchant,
      evidence.category.slice(0, 120),
      evidence.amountMinor,
      evidence.currency,
      evidence.evidenceDate,
      evidence.direction,
      evidence.cadenceHint,
      evidence.nextExpectedDate,
      evidence.provenanceKind,
      evidence.provenanceReference,
      confidenceState(evidence.confidenceScore),
      evidence.confidenceScore,
      JSON.stringify(evidence.confidenceReasons),
    ],
  );
}

function evidenceFingerprint(evidence: ExtractedEvidence) {
  return recoveryEvidenceFingerprint({
    sourceId: evidence.sourceId,
    evidenceKind: evidence.evidenceKind,
    rowNumber: evidence.rowNumber,
    normalizedMerchant: evidence.normalizedMerchant,
    amountMinor: evidence.amountMinor,
    currency: evidence.currency,
    evidenceDate: evidence.evidenceDate,
    direction: evidence.direction,
    cadenceHint: evidence.cadenceHint,
    nextExpectedDate: evidence.nextExpectedDate,
  });
}

async function analyzePersistedEvidence(client: PoolClient, workspaceId: string, today: Date) {
  const evidence = await loadAllEvidenceRows(client, workspaceId);
  const transactions = new Map<string, EvidenceRow[]>();
  const manualItems: ManualRecurringInput[] = [];
  for (const row of evidence) {
    if (row.evidence_kind === "TRANSACTION") {
      transactions.set(row.source_id, [...(transactions.get(row.source_id) ?? []), row]);
      continue;
    }
    if (!row.amount_minor || !row.currency || !row.cadence_hint || !row.next_expected_date) continue;
    const amountDecimal = minorUnitsToDecimal(row.amount_minor, currencyExponent(row.currency));
    manualItems.push({
      id: `recovery-evidence-${row.id}`,
      merchant: row.merchant,
      amount: toEngineAmount(amountDecimal),
      amountDecimal,
      currency: row.currency,
      frequency: cadenceToFrequency[row.cadence_hint],
      nextExpectedDate: toDateOnly(row.next_expected_date)!,
      category: row.category,
      sourceName: sourceEngineName(row.source_id),
      evidenceDescription: row.excerpt,
    });
  }
  const sources: StatementSource[] = [...transactions.entries()].map(([sourceId, rows]) => ({
    name: sourceEngineName(sourceId),
    text: buildSyntheticCsv(rows),
  }));
  const audit = analyzeStatements(sources, manualItems, { today });
  const sourceLabels = new Map(evidence.map((row) => [sourceEngineName(row.source_id), row.source_label]));
  return {
    ...audit,
    recurringItems: audit.recurringItems.map((item) => ({
      ...item,
      recommendationReason: publishRecoverySourceLabels(item.recommendationReason, sourceLabels),
      sourceNames: item.sourceNames.map((name) => sourceLabels.get(name) ?? name),
    })),
  };
}

function publishRecoverySourceLabels(value: string, sourceLabels: ReadonlyMap<string, string>) {
  let published = value;
  for (const [internalName, label] of sourceLabels) published = published.replaceAll(internalName, label);
  return published;
}

function buildSyntheticCsv(rows: EvidenceRow[]) {
  const lines = ["Date,Description,Debit,Credit,Currency"];
  for (const row of [...rows].sort((left, right) => left.row_number - right.row_number)) {
    if (!row.evidence_date || !row.amount_minor || !row.currency || row.direction === "credit") continue;
    const amountDecimal = minorUnitsToDecimal(row.amount_minor, currencyExponent(row.currency));
    // Receipt prose often says "subscription" even when it proves only one
    // charge. Preserve that prose as inspectable evidence, but classify the
    // synthetic transaction by merchant so the recurring engine requires a
    // repeated observation. Statement imports keep their original description
    // because singleton hints there are an established engine behavior.
    const description = transactionAnalysisDescription(row);
    lines.push([
      toDateOnly(row.evidence_date),
      csvCell(description),
      amountDecimal,
      "",
      row.currency,
    ].join(","));
  }
  return `${lines.join("\n")}\n`;
}

function transactionAnalysisDescription(row: EvidenceRow) {
  return row.evidence_kind === "TRANSACTION" && row.source_type !== "CSV_IMPORT"
    ? row.normalized_merchant
    : row.excerpt;
}

async function upsertCanonicalCommitments(client: PoolClient, workspaceId: string, items: readonly RecurringItem[]) {
  const existing = new Map((await loadCommitmentRows(client, workspaceId)).map((row) => [row.identity_key, row]));
  const corrections = await loadActiveCorrectionMap(client, workspaceId);
  for (const item of items) {
    const current = existing.get(item.identityKey);
    const base = baseTruthFromRecurring(item);
    const effective = applyCorrectionTruth(base, corrections.get(current?.id ?? "") ?? []);
    if (!current) {
      const inserted = await client.query<{ id: string }>(
        `insert into recovery_commitments (
           workspace_id, identity_key, base_status, base_merchant, base_category,
           base_cadence, base_currency, base_amount_minor, base_monthly_minor,
           base_next_expected_date, effective_status, effective_merchant,
           effective_cadence, effective_amount_minor, effective_monthly_minor,
           effective_next_expected_date, confidence_score, confidence_reasons,
           recommended_decision, recommendation_reason, risk_tags
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $3, $4, $6, $8, $9, $10,
           $11, $12::jsonb, $13, $14, $15
         ) returning id`,
        [
          workspaceId,
          item.identityKey,
          base.status,
          base.merchant,
          base.category,
          base.cadence,
          base.currency,
          base.amountMinor.toString(),
          base.monthlyMinor.toString(),
          base.nextExpectedDate,
          item.confidenceScore,
          JSON.stringify([item.recommendationReason]),
          recommendationDecision(item.recommendationType),
          item.recommendationReason,
          item.riskTags,
        ],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new RecoveryServiceError("SAVE_FAILED");
      existing.set(item.identityKey, (await getCommitmentRow(client, workspaceId, id))!);
      continue;
    }

    const changed = !sameEffectiveTruth(current, effective);
    await client.query(
      `update recovery_commitments
       set base_status = $3,
           base_merchant = $4,
           base_category = $5,
           base_cadence = $6,
           base_currency = $7,
           base_amount_minor = $8,
           base_monthly_minor = $9,
           base_next_expected_date = $10,
           effective_status = $11,
           effective_merchant = $12,
           effective_cadence = $13,
           effective_amount_minor = $14,
           effective_monthly_minor = $15,
           effective_next_expected_date = $16,
           confidence_score = $17,
           confidence_reasons = $18::jsonb,
           recommended_decision = $19,
           recommendation_reason = $20,
           risk_tags = $21,
           version = version + case when $22 then 1 else 0 end,
           updated_at = now()
       where workspace_id = $1 and id = $2`,
      [
        workspaceId,
        current.id,
        base.status,
        base.merchant,
        base.category,
        base.cadence,
        base.currency,
        base.amountMinor.toString(),
        base.monthlyMinor.toString(),
        base.nextExpectedDate,
        effective.status,
        effective.merchant,
        effective.cadence,
        effective.amountMinor.toString(),
        effective.monthlyMinor.toString(),
        effective.nextExpectedDate,
        item.confidenceScore,
        JSON.stringify([item.recommendationReason]),
        recommendationDecision(item.recommendationType),
        item.recommendationReason,
        item.riskTags,
        changed,
      ],
    );
  }
}

async function recomputeEffectiveCommitment(client: PoolClient, workspaceId: string, commitmentId: string) {
  const row = await getCommitmentRow(client, workspaceId, commitmentId);
  if (!row) throw new RecoveryServiceError("NOT_FOUND");
  const corrections = await client.query<CorrectionRow>(
    `${correctionSelect}
     where correction.workspace_id = $1
       and correction.commitment_id = $2
       and correction.status = 'ACTIVE'
     order by correction.created_at asc`,
    [workspaceId, commitmentId],
  );
  const base: EffectiveTruth = {
    status: row.base_status,
    merchant: row.base_merchant,
    category: row.base_category,
    cadence: row.base_cadence,
    currency: row.base_currency,
    amountMinor: BigInt(normalizeMinorUnits(row.base_amount_minor)),
    monthlyMinor: BigInt(normalizeMinorUnits(row.base_monthly_minor)),
    nextExpectedDate: toDateOnly(row.base_next_expected_date),
  };
  const effective = applyCorrectionTruth(base, corrections.rows);
  const changed = !sameEffectiveTruth(row, effective);
  await client.query(
    `update recovery_commitments
     set effective_status = $3,
         effective_merchant = $4,
         effective_cadence = $5,
         effective_amount_minor = $6,
         effective_monthly_minor = $7,
         effective_next_expected_date = $8,
         version = version + case when $9 then 1 else 0 end,
         updated_at = now()
     where workspace_id = $1 and id = $2`,
    [
      workspaceId,
      commitmentId,
      effective.status,
      effective.merchant,
      effective.cadence,
      effective.amountMinor.toString(),
      effective.monthlyMinor.toString(),
      effective.nextExpectedDate,
      changed,
    ],
  );
}

type EffectiveTruth = {
  status: CommitmentStatus;
  merchant: string;
  category: string;
  cadence: Cadence;
  currency: string;
  amountMinor: bigint;
  monthlyMinor: bigint;
  nextExpectedDate: string | null;
};

function baseTruthFromRecurring(item: RecurringItem): EffectiveTruth {
  const exactAmounts = item.evidence.map((evidence) => {
    if (!evidence.amountDecimal) throw new RecoveryServiceError("INVALID_EVIDENCE", "Recovery evidence lost its exact decimal amount.");
    return BigInt(decimalToMinorUnits(evidence.amountDecimal, item.currency));
  });
  const amountMinor = averageMinor(exactAmounts);
  return {
    status: "ACTIVE",
    merchant: item.merchant.slice(0, 240),
    category: item.category.slice(0, 120),
    cadence: frequencyToCadence[item.frequency],
    currency: item.currency,
    amountMinor,
    monthlyMinor: projectCadenceMonthlyMinor(amountMinor, frequencyToCadence[item.frequency]),
    nextExpectedDate: item.nextExpectedDate || null,
  };
}

function applyCorrectionTruth(base: EffectiveTruth, corrections: readonly CorrectionRow[]) {
  const effective = { ...base };
  for (const correction of corrections) {
    const patch = correction.patch;
    if (patch.field === "MERCHANT") effective.merchant = patch.value.merchant;
    if (patch.field === "AMOUNT") effective.amountMinor = BigInt(normalizeMinorUnits(patch.value.amountMinor));
    if (patch.field === "NEXT_EXPECTED_DATE") effective.nextExpectedDate = patch.value.date;
    if (patch.field === "CADENCE") effective.cadence = patch.value.cadence;
    if (patch.field === "IS_RECURRING") effective.status = patch.value.isRecurring ? "ACTIVE" : "NOT_RECURRING";
  }
  effective.monthlyMinor = projectCadenceMonthlyMinor(effective.amountMinor, effective.cadence);
  return effective;
}

function sameEffectiveTruth(row: CommitmentRow, effective: EffectiveTruth) {
  return row.effective_status === effective.status
    && row.effective_merchant === effective.merchant
    && row.effective_cadence === effective.cadence
    && BigInt(row.effective_amount_minor) === effective.amountMinor
    && BigInt(row.effective_monthly_minor) === effective.monthlyMinor
    && toDateOnly(row.effective_next_expected_date) === effective.nextExpectedDate;
}

async function loadActiveCorrectionMap(client: PoolClient, workspaceId: string) {
  const result = await client.query<CorrectionRow>(
    `${correctionSelect}
     where correction.workspace_id = $1 and correction.status = 'ACTIVE'
     order by correction.created_at asc`,
    [workspaceId],
  );
  const grouped = new Map<string, CorrectionRow[]>();
  for (const row of result.rows) grouped.set(row.commitment_id, [...(grouped.get(row.commitment_id) ?? []), row]);
  return grouped;
}

async function linkCanonicalEvidence(client: PoolClient, workspaceId: string, items: readonly RecurringItem[]) {
  const evidence = await loadAllEvidenceRows(client, workspaceId);
  const byKey = new Map<string, EvidenceRow[]>();
  for (const row of evidence) {
    const key = evidenceMatchKey(
      sourceEngineName(row.source_id),
      row.evidence_kind === "RECEIPT" ? toDateOnly(row.next_expected_date) : toDateOnly(row.evidence_date),
      row.amount_minor,
      transactionAnalysisDescription(row),
    );
    byKey.set(key, [...(byKey.get(key) ?? []), row]);
  }
  const commitments = new Map((await loadCommitmentRows(client, workspaceId)).map((row) => [row.identity_key, row]));
  for (const item of items) {
    const commitment = commitments.get(item.identityKey);
    if (!commitment) continue;
    for (const link of item.evidence) {
      if (!link.amountDecimal) throw new RecoveryServiceError("INVALID_EVIDENCE", "Recovery evidence lost its exact decimal amount.");
      const matches = byKey.get(evidenceMatchKey(
        link.source,
        link.date,
        decimalToMinorUnits(link.amountDecimal, item.currency),
        link.description,
      )) ?? [];
      for (const evidenceRow of matches) {
        await client.query(
          `insert into recovery_commitment_evidence (workspace_id, commitment_id, evidence_id)
           values ($1, $2, $3)
           on conflict (workspace_id, commitment_id, evidence_id) do nothing`,
          [workspaceId, commitment.id, evidenceRow.id],
        );
      }
    }
  }
}

async function persistChanges(
  client: PoolClient,
  workspaceId: string,
  fromVersion: number,
  toVersion: number,
  before: readonly CanonicalCommitmentRecord[],
  after: readonly CanonicalCommitmentRecord[],
  provenance:
    | { kind: "EVIDENCE"; submissionId: string; sourceIds: readonly string[] }
    | { kind: "CORRECTION" | "CORRECTION_REVERSAL"; correctionId: string },
  detectedAt: Date,
) {
  const beforeById = new Map(before.map((commitment) => [commitment.id, commitment]));
  const supporting = provenance.kind === "EVIDENCE"
    ? await loadSupportingEvidence(client, workspaceId, provenance.sourceIds)
    : null;
  const changes: ChangeItemDto[] = [];
  for (const current of after) {
    const previous = beforeById.get(current.id);
    const evidenceIds = supporting?.get(current.id) ?? [];
    if (provenance.kind === "EVIDENCE" && !evidenceIds.length) continue;
    const changeProvenance: ChangeItemDto["provenance"] = provenance.kind === "EVIDENCE"
      ? { kind: "EVIDENCE", submissionId: provenance.submissionId, evidenceIds: asNonEmpty(evidenceIds) }
      : { kind: provenance.kind, correctionId: provenance.correctionId, evidenceIds: [] };
    const common = {
      commitmentId: current.id,
      merchant: current.merchant,
      detectedAt: detectedAt.toISOString(),
      provenance: changeProvenance,
    };
    if (!previous) {
      changes.push({
        ...common,
        id: "",
        kind: "ADDED",
        before: null,
        after: {
          merchant: current.merchant,
          amount: toMoneyDto(current.amountMinor, current.currency),
          date: current.nextExpectedDate,
          cadence: current.cadence,
        },
      });
      continue;
    }
    if (previous.merchant !== current.merchant) changes.push({ ...common, id: "", kind: "MERCHANT", before: previous.merchant, after: current.merchant });
    if (previous.amountMinor !== current.amountMinor) changes.push({
      ...common,
      id: "",
      kind: "AMOUNT",
      before: toMoneyDto(previous.amountMinor, previous.currency),
      after: toMoneyDto(current.amountMinor, current.currency),
    });
    if (previous.nextExpectedDate !== current.nextExpectedDate) changes.push({ ...common, id: "", kind: "DATE", before: previous.nextExpectedDate, after: current.nextExpectedDate });
    if (previous.cadence !== current.cadence) changes.push({ ...common, id: "", kind: "CADENCE", before: previous.cadence, after: current.cadence });
    if (previous.status !== current.status) changes.push({ ...common, id: "", kind: "RECURRING_CLASSIFICATION", before: previous.status, after: current.status });
  }

  for (const change of changes) {
    const result = await client.query<{ id: string }>(
      `insert into recovery_changes (
         workspace_id, commitment_id, from_version, to_version, kind, merchant,
         before_value, after_value, provenance_kind, evidence_submission_id,
         correction_id, evidence_ids, detected_at
       ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12::uuid[], $13)
       returning id`,
      [
        workspaceId,
        change.commitmentId,
        fromVersion,
        toVersion,
        change.kind,
        change.merchant,
        change.before === null ? null : JSON.stringify(change.before),
        JSON.stringify(change.after),
        change.provenance.kind,
        change.provenance.kind === "EVIDENCE" ? change.provenance.submissionId : null,
        change.provenance.kind === "EVIDENCE" ? null : change.provenance.correctionId,
        change.provenance.evidenceIds,
        detectedAt,
      ],
    );
    change.id = result.rows[0]?.id ?? "";
    if (!change.id) throw new RecoveryServiceError("SAVE_FAILED");
  }
  return changes;
}

async function loadSupportingEvidence(client: PoolClient, workspaceId: string, sourceIds: readonly string[]) {
  const result = await client.query<{ commitment_id: string; evidence_ids: string[] }>(
    `select link.commitment_id,
            array_agg(link.evidence_id order by evidence.created_at, link.evidence_id) as evidence_ids
     from recovery_commitment_evidence link
     join recovery_evidence evidence
       on evidence.workspace_id = link.workspace_id and evidence.id = link.evidence_id
     where link.workspace_id = $1
      and evidence.source_id = any($2::uuid[])
     group by link.commitment_id`,
    [workspaceId, sourceIds],
  );
  return new Map(result.rows.map((row) => [row.commitment_id, row.evidence_ids]));
}

async function advanceWorkspaceVersion(client: PoolClient, input: {
  workspaceId: string;
  actorUserId: string | null;
  currentState: WorkspaceStateRow;
  mutationKind: "EVIDENCE" | "CORRECTION" | "CORRECTION_REVERSAL" | "DECISION";
  changes: readonly ChangeItemDto[];
}) {
  const currentVersion = Number(input.currentState.version);
  const nextVersion = currentVersion + 1;
  const firstBaseline = input.currentState.baseline_version === null;
  const advancesComparison = firstBaseline || input.mutationKind === "EVIDENCE" || input.changes.length > 0;
  const changedState = firstBaseline
    ? "NO_PRIOR_BASELINE" as const
    : advancesComparison
      ? "COMPARED" as const
      : input.currentState.latest_changed_state;
  const fromVersion = firstBaseline
    ? null
    : advancesComparison
      ? currentVersion
      : input.currentState.latest_from_version === null ? null : Number(input.currentState.latest_from_version);
  const changedVersion = firstBaseline
    ? null
    : advancesComparison
      ? nextVersion
      : input.currentState.latest_changed_version === null ? null : Number(input.currentState.latest_changed_version);
  const snapshot = {
    version: nextVersion,
    commitments: (await loadCommitmentRecords(client, input.workspaceId)).map((commitment) => ({
      id: commitment.id,
      version: commitment.version,
      status: commitment.status,
      merchant: commitment.merchant,
      category: commitment.category,
      cadence: commitment.cadence,
      currency: commitment.currency,
      amountMinor: commitment.amountMinor.toString(),
      monthlyEquivalentMinor: commitment.monthlyEquivalentMinor.toString(),
      nextExpectedDate: commitment.nextExpectedDate,
      evidenceIds: commitment.evidenceIds,
    })),
    changeIds: input.changes.map((change) => change.id),
  };
  await client.query(
    `update recovery_workspace_states
     set version = $2,
         baseline_version = coalesce(baseline_version, $2),
         latest_changed_state = $3,
         latest_from_version = $4,
            latest_changed_version = $5,
         updated_at = now()
     where workspace_id = $1`,
          [input.workspaceId, nextVersion, changedState, fromVersion, changedVersion],
  );
  await client.query(
    `insert into recovery_workspace_versions (
       workspace_id, version, actor_user_id, mutation_kind, changed_state,
       from_version, snapshot
     ) values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [input.workspaceId, nextVersion, input.actorUserId, input.mutationKind, changedState, fromVersion, JSON.stringify(snapshot)],
  );
  return nextVersion;
}

async function loadHome(
  client: PoolClient,
  membership: MembershipRow,
  generatedAt: Date,
  suppliedState?: WorkspaceStateRow,
) {
  const state = suppliedState ?? await readWorkspaceState(client, membership.workspace_id);
  const version = Number(state?.version ?? 0);
  const changed = await loadChanged(client, membership.workspace_id, state, version);
  const commitments = await loadCommitmentRecords(client, membership.workspace_id);
  const observations = await loadRecentObservationRecords(client, membership.workspace_id);
  const sources = await loadCoverageSources(client, membership.workspace_id);
  const duplicateState = await loadHeadlineDuplicateState(client, membership.workspace_id);
  const home = buildHomeProjection({
    workspace: {
      id: membership.workspace_id,
      name: membership.workspace_name,
      role: membership.role,
      version,
    },
    generatedAt,
    commitments,
    observations,
    sources,
    changed,
    duplicateState,
  });
  return {
    ...home,
    evidenceSources: await loadRecoveryEvidenceSources(client, membership.workspace_id),
    autopilot: await loadAutopilotHome(client, membership.workspace_id),
  };
}

async function loadHeadlineDuplicateState(client: PoolClient, workspaceId: string): Promise<HeadlineDuplicateState> {
  const openSignals = await client.query<{ dedupe_key: string }>(
    `select dedupe_key from recovery_change_signals
     where workspace_id = $1
       and kind = 'DUPLICATE_SUSPECTED'
       and state in ('OPEN', 'ACKNOWLEDGED')`,
    [workspaceId],
  );
  const unresolvedCommitmentIds = [...new Set(openSignals.rows.flatMap((row) => {
    if (!row.dedupe_key.startsWith("DUPLICATE_SUSPECTED:")) return [];
    const parts = row.dedupe_key.slice("DUPLICATE_SUSPECTED:".length).split(":");
    return parts.length === 2 && parts[0] && parts[1] ? [parts[0], parts[1]] : [];
  }))];

  const links = await client.query<{ merchant_id: string; commitment_id: string }>(
    `select merchant_id, commitment_id from recovery_merchant_links
     where workspace_id = $1 and reversed_at is null`,
    [workspaceId],
  );
  const byMerchant = new Map<string, string[]>();
  for (const row of links.rows) {
    byMerchant.set(row.merchant_id, [...(byMerchant.get(row.merchant_id) ?? []), row.commitment_id]);
  }
  const confirmedSameGroups = [...byMerchant.values()].filter((group) => group.length > 1);
  return { unresolvedCommitmentIds, confirmedSameGroups };
}

async function loadRecentObservationRecords(client: PoolClient, workspaceId: string): Promise<RecoveryObservationRecord[]> {
  const result = await client.query<Pick<EvidenceRow, "id" | "merchant" | "amount_minor" | "currency" | "observed_at">>(
    `select evidence.id, evidence.merchant, evidence.amount_minor,
            evidence.currency, evidence.observed_at
     from recovery_evidence evidence
     where evidence.workspace_id = $1
       and evidence.observed_at is not null
     order by evidence.created_at desc, evidence.id desc
     limit 3`,
    [workspaceId],
  );
  return result.rows.map((row) => ({
    evidenceId: row.id,
    merchant: row.merchant || null,
    amountMinor: row.amount_minor === null ? null : BigInt(normalizeMinorUnits(row.amount_minor)),
    currency: row.currency,
    date: toDateOnly(row.observed_at),
  }));
}

async function loadChanged(
  client: PoolClient,
  workspaceId: string,
  state: WorkspaceStateRow | null,
  version: number,
): Promise<HomeChangedDto> {
  if (!state || state.latest_changed_state === "NO_PRIOR_BASELINE") {
    return { state: "NO_PRIOR_BASELINE", fromVersion: null, toVersion: version, items: [] };
  }
  const changedVersion = Number(state.latest_changed_version ?? version);
  const result = await client.query<ChangeRow>(
    `select id, commitment_id, kind, merchant, before_value, after_value,
            provenance_kind, evidence_submission_id, correction_id,
            evidence_ids, detected_at
     from recovery_changes
     where workspace_id = $1 and to_version = $2
     order by detected_at asc, id asc`,
    [workspaceId, changedVersion],
  );
  return {
    state: "COMPARED",
    fromVersion: Number(state.latest_from_version ?? Math.max(0, version - 1)),
    toVersion: changedVersion,
    items: result.rows.map(toChangeDto),
  };
}

async function loadCommitmentRecords(client: PoolClient, workspaceId: string): Promise<CanonicalCommitmentRecord[]> {
  const rows = await loadCommitmentRows(client, workspaceId);
  const correctionMap = await loadActiveCorrectionMap(client, workspaceId);
  return rows.map((row) => {
    const evidenceIds = asNonEmpty(row.evidence_ids);
    return {
      id: row.id,
      version: Number(row.version),
      status: row.effective_status,
      merchant: row.effective_merchant,
      category: row.base_category,
      cadence: row.effective_cadence,
      currency: row.base_currency,
      amountMinor: BigInt(normalizeMinorUnits(row.effective_amount_minor)),
      monthlyEquivalentMinor: BigInt(normalizeMinorUnits(row.effective_monthly_minor)),
      nextExpectedDate: toDateOnly(row.effective_next_expected_date),
      confidenceScore: row.confidence_score,
      confidenceReasons: row.confidence_reasons,
      recommendedDecision: row.recommended_decision,
      recommendationReason: row.recommendation_reason,
      riskTags: row.risk_tags,
      decision: row.decision && row.decided_at && row.decision_updated_at ? {
        value: row.decision,
        decidedAt: row.decided_at.toISOString(),
        updatedAt: row.decision_updated_at.toISOString(),
      } : null,
      evidenceIds,
      factCorrections: (correctionMap.get(row.id) ?? [])
        .filter((correction) => correction.field !== "MERCHANT")
        .map((correction) => ({ id: correction.id, field: correction.field, status: correction.status })),
      updatedAt: row.updated_at.toISOString(),
    };
  });
}

async function loadCommitmentRows(client: PoolClient, workspaceId: string) {
  const result = await client.query<CommitmentRow>(
    `${commitmentSelect}
     where commitment.workspace_id = $1
     group by commitment.id, decision.decision, decision.decided_at, decision.updated_at
     order by commitment.updated_at desc, commitment.id desc`,
    [workspaceId],
  );
  return result.rows;
}

async function getCommitmentRow(client: PoolClient, workspaceId: string, commitmentId: string) {
  const result = await client.query<CommitmentRow>(
    `${commitmentSelect}
     where commitment.workspace_id = $1 and commitment.id = $2
     group by commitment.id, decision.decision, decision.decided_at, decision.updated_at
     limit 1`,
    [workspaceId, commitmentId],
  );
  return result.rows[0] ?? null;
}

async function loadCoverageSources(client: PoolClient, workspaceId: string): Promise<RecoveryCoverageSource[]> {
  const result = await client.query<SourceRow>(
    `select source.id, source.source_type, source.client_ref, source.label,
            source.ingested_at, source.coverage_start, source.coverage_end,
            count(evidence.id)::text as evidence_count
     from recovery_sources source
     left join recovery_evidence evidence
       on evidence.workspace_id = source.workspace_id and evidence.source_id = source.id
     where source.workspace_id = $1
     group by source.id
     order by source.ingested_at asc, source.id asc`,
    [workspaceId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    ingestedAt: row.ingested_at.toISOString(),
    coverageStart: toDateOnly(row.coverage_start),
    coverageEnd: toDateOnly(row.coverage_end),
    evidenceCount: Number(row.evidence_count),
  }));
}

async function buildCommitmentDetail(
  client: PoolClient,
  workspaceId: string,
  commitment: CommitmentRow,
  requestedLimit?: number,
  requestedCursor?: string,
): Promise<CommitmentDetailDto> {
  const limit = boundedPageSize(requestedLimit, 25, recoveryLimits.maxCommitmentEvidencePageSize);
  const cursor = decodeCursor(requestedCursor);
  const evidence = await client.query<EvidenceRow>(
      `select evidence.id, evidence.source_id, source.source_type,
              source.label as source_label, source.ingested_at as source_ingested_at,
              source.coverage_start as source_coverage_start,
              source.coverage_end as source_coverage_end,
              evidence.evidence_kind, evidence.row_number, evidence.observed_at,
              evidence.excerpt, evidence.excerpt_truncated, evidence.merchant,
              evidence.normalized_merchant, evidence.category, evidence.amount_minor,
              evidence.currency, evidence.evidence_date, evidence.direction,
              evidence.cadence_hint, evidence.next_expected_date,
              evidence.provenance_kind, evidence.provenance_reference,
              sender_assessment.trust_tier as sender_trust_tier,
              sender_assessment.from_domain as sender_from_domain,
              sender_assessment.trusted_authority as sender_trusted_authority,
              sender_assessment.reasons as sender_trust_reasons,
              evidence.confidence_state, evidence.confidence_score,
              evidence.confidence_reasons, evidence.created_at, link.linked_at
       from recovery_commitment_evidence link
       join recovery_evidence evidence
         on evidence.workspace_id = link.workspace_id and evidence.id = link.evidence_id
       join recovery_sources source
         on source.workspace_id = evidence.workspace_id and source.id = evidence.source_id
       left join lateral (
         select assessment.trust_tier, assessment.from_domain,
                assessment.trusted_authority, assessment.reasons
         from recovery_inbound_sender_assessments assessment
         where assessment.workspace_id = evidence.workspace_id
           and assessment.source_id = evidence.source_id
         order by assessment.assessed_at desc, assessment.id desc
         limit 1
       ) sender_assessment on true
       where link.workspace_id = $1 and link.commitment_id = $2
         and ($3::timestamptz is null or (link.linked_at, link.evidence_id) < ($3::timestamptz, $4::uuid))
       order by link.linked_at desc, link.evidence_id desc
       limit $5`,
      [workspaceId, commitment.id, cursor?.at ?? null, cursor?.id ?? null, limit + 1],
    );
  const count = await client.query<{ total: string }>(
      `select count(*)::text as total
       from recovery_commitment_evidence
       where workspace_id = $1 and commitment_id = $2`,
      [workspaceId, commitment.id],
    );
  const corrections = await client.query<CorrectionRow>(
      `${correctionSelect}
       where correction.workspace_id = $1 and correction.commitment_id = $2
       order by correction.created_at desc, correction.id desc`,
      [workspaceId, commitment.id],
    );
  const page = evidence.rows.slice(0, limit);
  const truth = await loadCommitmentTruth(client, workspaceId, commitment);
  return {
    ...toCommitmentSummary(commitment),
    recommendationReason: commitment.recommendation_reason,
    riskTags: commitment.risk_tags,
    evidence: {
      items: page.map(toEvidenceDto),
      total: Number(count.rows[0]?.total ?? 0),
      nextCursor: evidence.rows.length > limit && page.length
        ? encodeCursor(page.at(-1)!.linked_at ?? page.at(-1)!.created_at, page.at(-1)!.id)
        : null,
    },
    corrections: corrections.rows.map((correction) => toCorrectionDto(correction, commitment.base_currency)),
    ...truth,
  };
}

async function loadCommitmentTruth(
  client: PoolClient,
  workspaceId: string,
  commitment: CommitmentRow,
): Promise<Pick<CommitmentDetailDto, "expectation" | "memory" | "belief" | "because">> {
  const memoryRows = await client.query<{
    id: string;
    evidence_date: Date | string;
    amount_minor: string;
    currency: string;
    source_type: SourceType;
  }>(
    `select evidence.id, evidence.evidence_date, evidence.amount_minor::text as amount_minor,
            evidence.currency, source.source_type
     from recovery_commitment_evidence link
     join recovery_evidence evidence
       on evidence.workspace_id = link.workspace_id and evidence.id = link.evidence_id
     join recovery_sources source
       on source.workspace_id = evidence.workspace_id and source.id = evidence.source_id
     where link.workspace_id = $1 and link.commitment_id = $2
       and evidence.evidence_date is not null
       and evidence.amount_minor is not null
       and evidence.currency is not null
     order by evidence.evidence_date asc, evidence.id asc
     limit 24`,
    [workspaceId, commitment.id],
  );

  const memoryObservations = memoryRows.rows.flatMap((row) => {
    const date = toDateOnly(row.evidence_date);
    if (!date) return [];
    return [{
      date,
      amountMinor: BigInt(normalizeMinorUnits(row.amount_minor)),
      currency: row.currency,
      sourceType: row.source_type,
      evidenceId: row.id,
    }];
  });

  const state = await client.query<{
    coverage_state: SourceLivenessState;
    belief: string;
    because: string[];
    coverage_source_ids: string[];
  }>(
    `select coverage_state, belief, because, coverage_source_ids
     from recovery_commitment_states
     where workspace_id = $1 and commitment_id = $2`,
    [workspaceId, commitment.id],
  );
  const stored = state.rows[0];
  const coverage: CommitmentCoverage = stored
    ? {
        state: stored.coverage_state,
        trustworthy: isCoverageTrustworthy(stored.coverage_state),
        citedSourceIds: stored.coverage_source_ids,
        brokenSourceIds: stored.coverage_state === "BROKEN" ? stored.coverage_source_ids : [],
        staleSourceIds: stored.coverage_state === "STALE" ? stored.coverage_source_ids : [],
        limitations: [],
      }
    : {
        state: "NO_EVIDENCE",
        trustworthy: false,
        citedSourceIds: [],
        brokenSourceIds: [],
        staleSourceIds: [],
        limitations: ["Coverage for this commitment has not been assessed yet."],
      };

  const currency = commitment.base_currency;
  const observations: ChargeObservation[] = memoryObservations
    .filter((row) => row.currency.trim().toUpperCase() === currency)
    .map((row) => ({
      evidenceId: row.evidenceId,
      date: row.date,
      amountMinor: row.amountMinor,
      currency: row.currency,
    }));
  const expectedDate = toDateOnly(commitment.effective_next_expected_date);
  const expectedAmountMinor = BigInt(normalizeMinorUnits(commitment.effective_amount_minor));
  const evaluation = evaluateExpectedCharge({
    evaluatedOn: new Date().toISOString().slice(0, 10),
    expectedDate,
    cadence: commitment.effective_cadence,
    currency,
    expectedAmountMinor,
    coverage,
    observations,
    cancellationClaimed: false,
  });

  return {
    expectation: presentExpectedVsObserved({
      evaluation,
      expectedDate,
      expectedAmountMinor,
      currency,
      cadence: commitment.effective_cadence,
    }),
    memory: presentCommitmentMemory(memoryObservations),
    belief: stored?.belief ?? null,
    because: stored?.because ?? [],
  };
}

async function loadAllEvidenceRows(client: PoolClient, workspaceId: string) {
  const result = await client.query<EvidenceRow>(
    `select evidence.id, evidence.source_id, source.source_type,
            source.label as source_label, source.ingested_at as source_ingested_at,
            source.coverage_start as source_coverage_start,
            source.coverage_end as source_coverage_end,
            evidence.evidence_kind, evidence.row_number, evidence.observed_at,
            evidence.excerpt, evidence.excerpt_truncated, evidence.merchant,
            evidence.normalized_merchant, evidence.category, evidence.amount_minor,
            evidence.currency, evidence.evidence_date, evidence.direction,
            evidence.cadence_hint, evidence.next_expected_date,
            evidence.provenance_kind, evidence.provenance_reference,
            sender_assessment.trust_tier as sender_trust_tier,
            sender_assessment.from_domain as sender_from_domain,
            sender_assessment.trusted_authority as sender_trusted_authority,
            sender_assessment.reasons as sender_trust_reasons,
            evidence.confidence_state, evidence.confidence_score,
            evidence.confidence_reasons, evidence.created_at
     from recovery_evidence evidence
     join recovery_sources source
       on source.workspace_id = evidence.workspace_id and source.id = evidence.source_id
     left join lateral (
       select assessment.trust_tier, assessment.from_domain,
              assessment.trusted_authority, assessment.reasons
       from recovery_inbound_sender_assessments assessment
       where assessment.workspace_id = evidence.workspace_id
         and assessment.source_id = evidence.source_id
       order by assessment.assessed_at desc, assessment.id desc
       limit 1
     ) sender_assessment on true
     where evidence.workspace_id = $1
     order by evidence.created_at asc, evidence.id asc`,
    [workspaceId],
  );
  return result.rows;
}

function toCommitmentSummary(row: CommitmentRow): CommitmentSummaryDto {
  return {
    id: row.id,
    version: Number(row.version),
    status: row.effective_status,
    merchant: row.effective_merchant,
    category: row.base_category,
    cadence: row.effective_cadence,
    amount: toMoneyDto(row.effective_amount_minor, row.base_currency),
    monthlyEquivalent: toMoneyDto(row.effective_monthly_minor, row.base_currency),
    nextExpectedDate: toDateOnly(row.effective_next_expected_date),
    confidence: {
      state: confidenceState(row.confidence_score),
      score: row.confidence_score || null,
      scale: "PERCENT_0_100",
      reasons: row.confidence_reasons,
    },
    recommendedDecision: row.recommended_decision,
    decision: row.decision && row.decided_at && row.decision_updated_at ? {
      value: row.decision,
      decidedAt: row.decided_at.toISOString(),
      updatedAt: row.decision_updated_at.toISOString(),
    } : null,
    evidenceCount: row.evidence_ids.length,
    updatedAt: row.updated_at.toISOString(),
  };
}

function toEvidenceDto(row: EvidenceRow): EvidenceDto {
  return {
    id: row.id,
    source: {
      id: row.source_id,
      type: row.source_type,
      label: row.source_label,
      ingestedAt: row.source_ingested_at.toISOString(),
      coverageStart: toDateOnly(row.source_coverage_start),
      coverageEnd: toDateOnly(row.source_coverage_end),
    },
    immutable: true,
    observedAt: row.observed_at?.toISOString() ?? null,
    excerpt: row.excerpt,
    excerptTruncated: row.excerpt_truncated,
    amount: row.amount_minor !== null && row.currency ? toMoneyDto(row.amount_minor, row.currency) : null,
    date: toDateOnly(row.evidence_date),
    provenance: { kind: row.provenance_kind, reference: row.provenance_reference },
    senderTrust: row.sender_trust_tier ? {
      tier: row.sender_trust_tier,
      fromDomain: row.sender_from_domain,
      trustedAuthority: row.sender_trusted_authority,
      reasons: row.sender_trust_reasons ?? [],
    } : null,
    confidence: {
      state: row.confidence_state,
      score: row.confidence_score,
      scale: "PERCENT_0_100",
      reasons: row.confidence_reasons,
    },
  };
}

function toCorrectionDto(row: CorrectionRow, currency: string): CorrectionDto {
  const base = {
    id: row.id,
    commitmentId: row.commitment_id,
    patch: row.patch,
    authoritativeAmount: row.patch.field === "AMOUNT" ? toMoneyDto(row.patch.value.amountMinor, currency) : null,
    reason: row.reason,
    createdAt: row.created_at.toISOString(),
  };
  if (row.status === "REVERSED") return { ...base, status: "REVERSED", reversedAt: row.reversed_at!.toISOString(), supersededAt: null };
  if (row.status === "SUPERSEDED") return { ...base, status: "SUPERSEDED", reversedAt: null, supersededAt: row.superseded_at!.toISOString() };
  return { ...base, status: "ACTIVE", reversedAt: null, supersededAt: null };
}

function toChangeDto(row: ChangeRow): ChangeItemDto {
  const provenance: ChangeItemDto["provenance"] = row.provenance_kind === "EVIDENCE"
    ? {
        kind: "EVIDENCE",
        submissionId: requiredReference(row.evidence_submission_id),
        evidenceIds: asNonEmpty(row.evidence_ids),
      }
    : {
        kind: row.provenance_kind,
        correctionId: requiredReference(row.correction_id),
        evidenceIds: [],
      };
  const common = {
    id: row.id,
    commitmentId: row.commitment_id,
    merchant: row.merchant,
    detectedAt: row.detected_at.toISOString(),
    provenance,
  };
  if (row.kind === "ADDED") return { ...common, kind: "ADDED", before: null, after: row.after_value as Extract<ChangeItemDto, { kind: "ADDED" }>["after"] };
  if (row.kind === "MERCHANT") return { ...common, kind: "MERCHANT", before: String(row.before_value), after: String(row.after_value) };
  if (row.kind === "AMOUNT") return { ...common, kind: "AMOUNT", before: row.before_value as Extract<ChangeItemDto, { kind: "AMOUNT" }>["before"], after: row.after_value as Extract<ChangeItemDto, { kind: "AMOUNT" }>["after"] };
  if (row.kind === "DATE") return { ...common, kind: "DATE", before: nullableString(row.before_value), after: nullableString(row.after_value) };
  if (row.kind === "CADENCE") return { ...common, kind: "CADENCE", before: row.before_value as Cadence, after: row.after_value as Cadence };
  return { ...common, kind: "RECURRING_CLASSIFICATION", before: row.before_value as CommitmentStatus, after: row.after_value as CommitmentStatus };
}

async function assertRecoveryRole(
  client: PoolClient,
  userId: string,
  workspaceId: string,
  minimumRole: RecoveryRole,
  options: { lock?: boolean } = {},
) {
  const lockClause = options.lock === false ? "" : "for share of member, workspace, actor";
  const result = await client.query<MembershipRow>(
    `select workspace.id as workspace_id, workspace.name as workspace_name, member.role
     from workspace_members member
     join workspaces workspace on workspace.id = member.workspace_id
     join users actor on actor.id = member.user_id and actor.deleted_at is null
     where member.user_id = $1 and member.workspace_id = $2
     ${lockClause}`,
    [userId, workspaceId],
  );
  const row = result.rows[0];
  if (!row) throw new RecoveryServiceError("FORBIDDEN");
  if (roleRank[row.role] < roleRank[minimumRole]) throw new RecoveryServiceError("FORBIDDEN");
  return row;
}

async function withRecoveryRead<T>(read: (client: PoolClient) => Promise<T>) {
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

async function ensureWorkspaceState(client: PoolClient, workspaceId: string) {
  await client.query(
    `insert into recovery_workspace_states (workspace_id) values ($1)
     on conflict (workspace_id) do nothing`,
    [workspaceId],
  );
  const state = await client.query<WorkspaceStateRow>(
        `select version::text, baseline_version::text, latest_changed_state,
          latest_from_version::text, latest_changed_version::text
     from recovery_workspace_states where workspace_id = $1 for update`,
    [workspaceId],
  );
  if (!state.rows[0]) throw new RecoveryServiceError("SAVE_FAILED");
  return state.rows[0];
}

async function readWorkspaceState(client: PoolClient, workspaceId: string) {
  const result = await client.query<WorkspaceStateRow>(
        `select version::text, baseline_version::text, latest_changed_state,
          latest_from_version::text, latest_changed_version::text
     from recovery_workspace_states where workspace_id = $1`,
    [workspaceId],
  );
  return result.rows[0] ?? null;
}

function assertWorkspaceVersion(state: WorkspaceStateRow, expectedVersion: number) {
  const currentVersion = Number(state.version);
  if (currentVersion !== expectedVersion) {
    throw new RecoveryServiceError("STALE_STATE", undefined, { currentVersion });
  }
}

async function lockRecoveryWorkspace(client: PoolClient, workspaceId: string) {
  await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`recovery:${workspaceId}`]);
}

async function readIdempotent<T>(
  client: PoolClient,
  workspaceId: string,
  idempotencyKey: string,
  operation: string,
  requestHash: string,
) {
  const result = await client.query<{
    operation: string;
    request_hash: string;
    response_payload: T;
    workspace_version: string;
  }>(
    `select operation, request_hash, response_payload, workspace_version::text
     from recovery_idempotency_keys
     where workspace_id = $1 and idempotency_key = $2`,
    [workspaceId, idempotencyKey],
  );
  const row = result.rows[0];
  if (!row) return null;
  if (row.operation !== operation || row.request_hash !== requestHash) {
    throw new RecoveryServiceError("CONFLICT", "Idempotency-Key was already used for a different Recovery request.");
  }
  return { response: row.response_payload, workspaceVersion: Number(row.workspace_version) };
}

async function writeIdempotent(
  client: PoolClient,
  workspaceId: string,
  idempotencyKey: string,
  operation: string,
  requestHash: string,
  response: unknown,
  workspaceVersion: number,
) {
  await client.query(
    `insert into recovery_idempotency_keys (
       workspace_id, idempotency_key, operation, request_hash,
       response_payload, workspace_version
     ) values ($1, $2, $3, $4, $5::jsonb, $6)`,
    [workspaceId, idempotencyKey, operation, requestHash, JSON.stringify(response), workspaceVersion],
  );
}

async function writeRecoveryAudit(
  client: PoolClient,
  workspaceId: string,
  userId: string | null,
  action: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  await client.query(
    `insert into audit_log (workspace_id, user_id, action, entity_type, entity_id, metadata)
     values ($1, $2, $3, 'recovery', $4, $5::jsonb)`,
    [workspaceId, userId, action, entityId, JSON.stringify(metadata)],
  );
}

function normalizeStoreError(error: unknown) {
  if (error instanceof RecoveryServiceError) return error;
  if (error instanceof RecoveryCaptureNotReadyError) {
    return new RecoveryServiceError("FEATURE_UNAVAILABLE", error.message);
  }
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (["ECONNREFUSED", "57P01", "57P02", "57P03", "08001", "08006"].includes(code)) {
    return new RecoveryServiceError("DATABASE_UNAVAILABLE", undefined, { retryable: true });
  }
  if (code === "23505") return new RecoveryServiceError("CONFLICT");
  return new RecoveryServiceError("SAVE_FAILED");
}

function recommendationDecision(value: RecurringItem["recommendationType"]): Decision {
  if (value === "keep") return "KEEP";
  if (value === "watch") return "MONITOR";
  if (value === "downgrade") return "DOWNGRADE";
  if (value === "cancel") return "CANCEL";
  return "INVESTIGATE";
}

function confidenceState(score: number) {
  return score >= 85 ? "HIGH" as const : score >= 65 ? "MEDIUM" as const : score > 0 ? "LOW" as const : "UNKNOWN" as const;
}

function evidenceMatchKey(source: string, date: string | null, amountMinor: string | null, description: string) {
  return [
    source,
    date ?? "",
    amountMinor ?? "",
    description.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim().slice(0, recoveryLimits.maxEvidenceExcerptCharacters),
  ].join("|");
}

function sourceEngineName(sourceId: string) {
  return `recovery-source:${sourceId}`;
}

function recoveryRawAssociatedData(workspaceId: string, sourceId: string) {
  return `vognary-recovery-evidence:${workspaceId}:${sourceId}`;
}

function boundedPageSize(value: number | undefined, fallback: number, maximum: number) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new RecoveryServiceError("INVALID_EVIDENCE");
  return value;
}

function encodeCursor(at: Date, id: string) {
  return Buffer.from(JSON.stringify({ at: at.toISOString(), id }), "utf8").toString("base64url");
}

function decodeCursor(value: string | undefined) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { at?: string; id?: string };
    if (!parsed.at || !parsed.id || !Number.isFinite(new Date(parsed.at).getTime()) || !isUuid(parsed.id)) throw new Error();
    return { at: parsed.at, id: parsed.id };
  } catch {
    throw new RecoveryServiceError("INVALID_EVIDENCE", "Pagination cursor is invalid.");
  }
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function toEngineAmount(decimal: string) {
  const amount = Number(decimal);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(Math.trunc(amount))) {
    throw new RecoveryServiceError("INVALID_EVIDENCE", "Evidence amount exceeds the deterministic engine range.");
  }
  return amount;
}

function averageMinor(values: readonly bigint[]) {
  if (!values.length) throw new RecoveryServiceError("INVALID_EVIDENCE", "Recovery commitment has no exact amount evidence.");
  const total = values.reduce((sum, value) => sum + value, BigInt(0));
  const divisor = BigInt(values.length);
  const quotient = total / divisor;
  const rounded = total % divisor * BigInt(2) >= divisor ? quotient + BigInt(1) : quotient;
  return BigInt(normalizeMinorUnits(rounded.toString()));
}

function toDateOnly(value: Date | string | null) {
  if (!value) return null;
  // node-postgres materializes PostgreSQL DATE at local midnight. Formatting
  // that instant as UTC moves the calendar day backwards in India (and other
  // positive offsets), so preserve its local calendar fields explicitly.
  if (value instanceof Date) {
    return [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, "0"),
      String(value.getDate()).padStart(2, "0"),
    ].join("-");
  }
  return String(value).slice(0, 10);
}

function nullableString(value: unknown) {
  return value === null ? null : String(value);
}

function requiredReference(value: string | null) {
  if (!value) throw new RecoveryServiceError("SAVE_FAILED", "A Recovery change has incomplete provenance.");
  return value;
}

function asNonEmpty(values: readonly string[]): readonly [string, ...string[]] {
  const [first, ...rest] = [...new Set(values)];
  if (!first) throw new RecoveryServiceError("SAVE_FAILED", "Canonical commitment has no persisted evidence.");
  return [first, ...rest];
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

const commitmentSelect = `
  select commitment.id, commitment.identity_key, commitment.version::text,
         commitment.base_status, commitment.base_merchant, commitment.base_category,
         commitment.base_cadence, commitment.base_currency,
         commitment.base_amount_minor::text, commitment.base_monthly_minor::text,
         commitment.base_next_expected_date, commitment.effective_status,
         commitment.effective_merchant, commitment.effective_cadence,
         commitment.effective_amount_minor::text, commitment.effective_monthly_minor::text,
         commitment.effective_next_expected_date, commitment.confidence_score,
         commitment.confidence_reasons, commitment.recommended_decision,
         commitment.recommendation_reason, commitment.risk_tags,
         commitment.first_detected_at, commitment.updated_at,
         decision.decision, decision.decided_at, decision.updated_at as decision_updated_at,
         coalesce(
           array_agg(link.evidence_id order by link.linked_at, link.evidence_id)
             filter (where link.evidence_id is not null),
           '{}'::uuid[]
         ) as evidence_ids
  from recovery_commitments commitment
  left join recovery_decisions decision
    on decision.workspace_id = commitment.workspace_id
   and decision.commitment_id = commitment.id
  left join recovery_commitment_evidence link
    on link.workspace_id = commitment.workspace_id
   and link.commitment_id = commitment.id`;

const correctionSelect = `
  select correction.id, correction.commitment_id, correction.field,
         correction.patch, correction.reason, correction.status,
         correction.created_at, correction.reversed_at, correction.superseded_at
  from recovery_corrections correction`;
