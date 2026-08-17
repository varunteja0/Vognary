import "server-only";

import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { getDatabasePool } from "@/lib/server/database";
import { hashRecoveryRequest, RecoveryServiceError } from "@/lib/server/recovery-api";
import { recordProductEvent } from "@/lib/server/product-event-store";
import { canDeliverAutopilotNotice, isAutopilotExecutionEnabled, isAutopilotNoticeChannelReady, isAutopilotNoticeEnabled } from "@/lib/recovery/autopilot-switch";
import { evaluateEligibility } from "@/lib/recovery/eligibility";
import { canTransitionCandidate, terminalCandidateStatuses, type CandidateStatus } from "@/lib/recovery/candidate-machine";
import { evaluateCoveredWindowProof, debitObservationWindow } from "@/lib/recovery/covered-window";
import { billingYearStart, feePeriodCrossesBillingAnniversary } from "@/lib/recovery/billing-year";
import {
  autopilotNoticePayloadVersion,
  candidateClockAuthorizes,
  freezeAutopilotNotice,
  frozenAutopilotNoticeFromPersistence,
  hashAutopilotNoticeProviderPayload,
  hashLegacyAutopilotNoticeProviderPayload,
  noticeClockMayStart,
  resendIdempotencyWindowOpen,
  unboundNoticeEventRetentionMs,
} from "@/lib/recovery/notice-payload";
import {
  computeCumulativeFirstYearCharge,
  computeFirstYearCharge,
  invoiceReplayDecision,
  monitoringFeeMinor,
} from "@/lib/recovery/fee-ledger";
import { recordConsentGrant } from "@/lib/server/consent-store";
import {
  countsAsEligibleCandidate,
  countsAsProtectedLeakage,
  evaluateShadowGate,
  executionMayProceedPastShadowGate,
  type ShadowGateSnapshot,
} from "@/lib/recovery/shadow-gate";
import { executionBlockReason } from "@/lib/recovery/execution-gate";
import { toMoneyDto } from "@/lib/recovery/domain";
import { deriveNextDebit } from "@/lib/recovery/next-debit";
import { receiptNextDateIsExplicit } from "@/lib/receipt-parser";
import { bindExecutionIdempotency, executionOperationKey, resolveExecutionReplay } from "@/lib/recovery/execution-idempotency";
import { applyNoticeDeliveryEvent, noticeAuthorizesClock, productionVetoHours, vetoDeadlineFromDelivery, type NoticeDeliveryState, type NoticeDeliveryStatus, type NoticeProviderEventType } from "@/lib/recovery/notice-delivery";
import { presentAutopilotNotice } from "@/lib/recovery/notice-presentation";
import { describeAutopilotNoticeReadiness } from "@/lib/recovery/notice-readiness";
import { classifyCommitment, isProtectedCommitmentClass } from "@/lib/commitment-policy";
import {
  standingMandateSignedText,
  standingMandateTermsVersion,
  standingMandateTextHash,
  standingMandateVetoHours,
  defaultPerActionCeilingMinor,
  defaultRolling30dCeilingMinor,
} from "@/lib/recovery/standing-mandate";
import {
  isProviderExecutable,
  isProviderRouteProven,
  lookupCatalogProviderById,
  lookupSupportedProviderById,
} from "@/lib/recovery/provider-registry";
import { canQueueDeliverableAutopilotNotice, sendAutopilotNotice, autopilotVetoTokenSecret, autopilotNoticeFromEmail, autopilotNoticeWebhookSecret } from "@/lib/server/autopilot-mailer";
import { verifyVetoToken } from "@/lib/recovery/veto-token";
import type { Cadence } from "@/lib/recovery/contracts";
import type {
  AutopilotAttemptDto,
  AutopilotCandidateDto,
  AutopilotFeeDto,
  AutopilotHomeDto,
  AutopilotWindowDto,
  MoneyDto,
  RecoveryEvidenceSourceDto,
  RecoverySourceDisconnectionDto,
  SourceType,
  StandingMandateDto,
} from "@/lib/recovery/contracts";
import {
  candidateClassificationCurrentSql,
  candidateCitedSourcesCurrentSql,
  currentSourceNotDisconnectedSql,
  currentlyConnectedSourceSql,
  standingMandateConsentExistsSql,
  standingMandateConsentPurpose,
} from "@/lib/recovery/autopilot-funnel";

type MandateRow = {
  id: string;
  version: number;
  status: "ACTIVE" | "REVOKED";
  terms_version: string;
  signed_text: string;
  signed_text_hash: string;
  currency: string;
  per_action_ceiling_minor: string;
  rolling_30d_ceiling_minor: string;
  veto_window_hours: number;
  signed_at: Date;
  revoked_at: Date | null;
};

type CandidateRow = {
  id: string;
  commitment_id: string;
  merchant: string;
  eligibility: AutopilotCandidateDto["eligibility"];
  status: string;
  ineligible_reasons: string[];
  provider_id: string | null;
  amount_minor: string;
  currency: string;
  notice_delivered_at: Date | null;
  veto_deadline_at: Date | null;
  exception_code: string | null;
  delivery_status?: NoticeDeliveryStatus | null;
  token_coverage_invalid?: boolean;
};

const roleRank = { viewer: 1, member: 2, admin: 3, owner: 4 } as const;

function liveNoticeAuthorization(row: {
  deliveryStatus?: string | null;
  noticeDeliveredAt?: Date | null;
  vetoDeadlineAt?: Date | null;
  noticeMessageId?: string | null;
}): { noticeDelivered: boolean; vetoDeadline: Date | null } {
  return candidateClockAuthorizes({
    noticeStatus: row.deliveryStatus,
    providerMessageId: row.noticeMessageId,
    noticeDeliveredAt: row.noticeDeliveredAt,
    vetoDeadlineAt: row.vetoDeadlineAt,
  });
}

async function lockAutopilotShadowGate(client: PoolClient) {
  await client.query("select pg_advisory_xact_lock(hashtextextended('autopilot-shadow-gate', 0))");
}

export async function lockAutopilotAuthorityGate(client: PoolClient) {
  await lockAutopilotShadowGate(client);
}

async function lockAutopilotNoticeSendGate(client: PoolClient) {
  await client.query("select pg_advisory_lock(hashtextextended('autopilot-shadow-gate', 0))");
}

async function unlockAutopilotNoticeSendGate(client: PoolClient) {
  const result = await client.query<{ unlocked: boolean }>(
    "select pg_advisory_unlock(hashtextextended('autopilot-shadow-gate', 0)) as unlocked",
  );
  if (result.rows[0]?.unlocked !== true) throw new Error("Autopilot notice-send authority lock was not released.");
}

async function lockWorkspace(client: PoolClient, workspaceId: string) {
  await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`recovery:${workspaceId}`]);
}

async function assertRole(client: PoolClient, userId: string, workspaceId: string, minimum: keyof typeof roleRank) {
  const result = await client.query<{ role: keyof typeof roleRank }>(
    `select member.role
     from workspace_members member
     join users actor on actor.id = member.user_id and actor.deleted_at is null
     where member.user_id = $1 and member.workspace_id = $2`,
    [userId, workspaceId],
  );
  const row = result.rows[0];
  if (!row || roleRank[row.role] < roleRank[minimum]) throw new RecoveryServiceError("FORBIDDEN");
}

async function bumpVersion(client: PoolClient, workspaceId: string, actorUserId: string | null, mutationKind: "MANDATE" | "CANDIDATE") {
  await client.query(
    `insert into recovery_workspace_states (workspace_id) values ($1)
     on conflict (workspace_id) do nothing`,
    [workspaceId],
  );
  const state = await client.query<{ version: string }>(
    `select version::text from recovery_workspace_states where workspace_id = $1 for update`,
    [workspaceId],
  );
  const current = Number(state.rows[0]?.version ?? 0);
  const next = current + 1;
  const changedState = current === 0 ? "NO_PRIOR_BASELINE" : "COMPARED";
  const fromVersion = current === 0 ? null : current;
  await client.query(
    `update recovery_workspace_states set version = $2, updated_at = now() where workspace_id = $1`,
    [workspaceId, next],
  );
  await client.query(
    `insert into recovery_workspace_versions (
       workspace_id, version, actor_user_id, mutation_kind, changed_state, from_version, snapshot
     ) values ($1, $2, $3, $4, $5, $6, '{}'::jsonb)`,
    [workspaceId, next, actorUserId, mutationKind, changedState, fromVersion],
  );
  return next;
}

function toMandateDto(row: MandateRow): StandingMandateDto {
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    termsVersion: row.terms_version,
    signedText: row.signed_text,
    signedTextHash: row.signed_text_hash,
    currency: row.currency,
    perActionCeilingMinor: row.per_action_ceiling_minor,
    rolling30dCeilingMinor: row.rolling_30d_ceiling_minor,
    vetoWindowHours: 48,
    signedAt: row.signed_at.toISOString(),
    revokedAt: row.revoked_at?.toISOString() ?? null,
  };
}

function toCandidateDto(row: CandidateRow): AutopilotCandidateDto {
  const noticeDeliveredAt = row.notice_delivered_at?.toISOString() ?? null;
  const vetoDeadlineAt = row.veto_deadline_at?.toISOString() ?? null;
  const noticeDeliveryStatus = row.delivery_status ?? (row.status === "NOTICE_QUEUED" ? "QUEUED" : null);
  const tokenCoverageInvalid = row.token_coverage_invalid ?? false;
  return {
    id: row.id,
    commitmentId: row.commitment_id,
    merchant: row.merchant,
    eligibility: row.eligibility,
    status: row.status,
    reasons: row.ineligible_reasons,
    providerId: row.provider_id,
    amount: toMoneyDto(BigInt(row.amount_minor), row.currency),
    noticeDeliveredAt,
    vetoDeadlineAt,
    noticeDeliveryStatus,
    tokenCoverageInvalid,
    noticePresentation: presentAutopilotNotice({
      deliveryStatus: noticeDeliveryStatus,
      noticeDeliveredAt,
      vetoDeadlineAt,
      tokenCoverageInvalid,
    }),
    exceptionCode: row.exception_code,
  };
}

function requireMoneyDto(minor: string, currency: string | null | undefined, label: string): MoneyDto {
  if (!currency?.trim()) throw new RecoveryServiceError("INVALID_EVIDENCE", `${label} is missing currency.`);
  return toMoneyDto(minor, currency);
}

function optionalSavingDto(minor: string | null, currency: string | null | undefined): MoneyDto | null {
  if (minor === null) return null;
  return requireMoneyDto(minor, currency, "Covered-window saving");
}

function currentNoticeReadiness() {
  const testAdapter = process.env.AUTOPILOT_TEST_ADAPTER === "true" && process.env.NODE_ENV !== "production";
  return describeAutopilotNoticeReadiness({
    featureSwitch: isAutopilotNoticeEnabled(),
    channelReady: isAutopilotNoticeChannelReady(),
    credentialsPresent: Boolean(autopilotVetoTokenSecret())
      && (testAdapter || Boolean(process.env.RESEND_API_KEY?.trim() && autopilotNoticeFromEmail())),
    webhookReady: testAdapter || Boolean(autopilotNoticeWebhookSecret()),
    deliveryProven: false,
  });
}

export type AutopilotNoticeSendInterleavePhase = "after-select" | "after-freeze" | "after-authority";

type NoticeSendInterleave = (
  phase: AutopilotNoticeSendInterleavePhase,
  input: { workspaceId: string; candidateId: string },
) => Promise<void>;

let noticeSendInterleaveForTests: NoticeSendInterleave | null = null;

export function setAutopilotNoticeSendInterleaveForTests(hook: NoticeSendInterleave | null) {
  if (process.env.NODE_ENV === "production") return;
  noticeSendInterleaveForTests = hook;
}

async function runNoticeSendInterleave(
  phase: AutopilotNoticeSendInterleavePhase,
  workspaceId: string,
  candidateId: string,
) {
  if (process.env.NODE_ENV === "production" || !noticeSendInterleaveForTests) return;
  await noticeSendInterleaveForTests(phase, { workspaceId, candidateId });
}

async function noticeAuthorityStillValid(
  workspaceId: string,
  candidateId: string,
  queryable: Pick<PoolClient, "query"> = getDatabasePool(),
) {
  const result = await queryable.query<{
    status: string;
    eligibility: string;
    candidate_class: string;
    snapshot_class: string;
    provider_id: string | null;
    notice_delivery_status: string;
    candidate_currency: string;
    mandate_currency: string;
    mandate_status: string;
    consent_current: boolean;
    sources_current: boolean;
    classification_current: boolean;
    provider_disabled: boolean;
    cited_category: string;
    cited_merchant: string | null;
    protected_override: boolean;
  }>(
        `select candidate.status, candidate.eligibility,
          candidate.commitment_class as candidate_class,
          snapshot.commitment_class as snapshot_class,
            candidate.provider_id, notice.delivery_status as notice_delivery_status,
            candidate.currency as candidate_currency,
          mandate.currency as mandate_currency, mandate.status as mandate_status,
            (${standingMandateConsentExistsSql}) as consent_current,
            (${candidateCitedSourcesCurrentSql}) as sources_current,
            (${candidateClassificationCurrentSql}) as classification_current,
            coalesce(disable.disabled, false) as provider_disabled,
            snapshot.cited_category, snapshot.cited_merchant, snapshot.protected_override
     from recovery_action_candidates candidate
     join recovery_standing_mandates mandate
       on mandate.workspace_id = candidate.workspace_id and mandate.id = candidate.mandate_id
     join recovery_classification_snapshots snapshot
       on snapshot.workspace_id = candidate.workspace_id
      and snapshot.commitment_id = candidate.commitment_id
      and snapshot.id = candidate.classification_snapshot_id
     join recovery_veto_notices notice
       on notice.workspace_id = candidate.workspace_id and notice.candidate_id = candidate.id
     join workspaces workspace on workspace.id = candidate.workspace_id
     left join recovery_provider_disables disable on disable.provider_id = candidate.provider_id
     where candidate.workspace_id = $1 and candidate.id = $2`,
    [workspaceId, candidateId],
  );
  const row = result.rows[0];
  if (!row) return false;
  if (row.status !== "NOTICE_QUEUED" || row.eligibility !== "ELIGIBLE") return false;
  if (row.notice_delivery_status !== "QUEUED") return false;
  if (row.candidate_class !== "discretionary-subscription" || row.snapshot_class !== "discretionary-subscription") return false;
  if (row.candidate_currency !== row.mandate_currency) return false;
  if (row.mandate_status !== "ACTIVE" || !row.consent_current) return false;
  if (!row.sources_current || !row.classification_current || row.provider_disabled) return false;
  const citedClass = classifyCommitment(row.cited_category, row.cited_merchant ?? "");
  if (row.protected_override || citedClass !== "discretionary-subscription" || isProtectedCommitmentClass(citedClass)) return false;
  const provider = row.provider_id ? lookupSupportedProviderById(row.provider_id) : null;
  if (!provider || !isProviderRouteProven(provider)) return false;
  return true;
}

export async function getStandingMandate(input: { workspaceId: string; actorUserId: string }) {
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin isolation level repeatable read read only");
    await assertRole(client, input.actorUserId, input.workspaceId, "viewer");
    const mandate = await readActiveOrLatestMandate(client, input.workspaceId);
    const version = await readVersion(client, input.workspaceId);
    await client.query("commit");
    return { mandate, workspaceVersion: version };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function signStandingMandate(input: {
  workspaceId: string;
  actorUserId: string;
  expectedVersion: number;
  idempotencyKey: string;
}) {
  const client = await getDatabasePool().connect();
  const operation = "recovery.sign-standing-mandate";
  const requestHash = hashRecoveryRequest({ operation, accepted: true });
  try {
    await client.query("begin");
    await lockAutopilotShadowGate(client);
    await lockWorkspace(client, input.workspaceId);
    await assertRole(client, input.actorUserId, input.workspaceId, "owner");
    const replay = await readIdempotent<StandingMandateDto>(client, input.workspaceId, input.idempotencyKey, operation, requestHash);
    if (replay) {
      await client.query("commit");
      return { mandate: replay.response, workspaceVersion: replay.workspaceVersion, replayed: true };
    }
    await assertExpectedVersion(client, input.workspaceId, input.expectedVersion);
    const existing = await client.query<{ id: string }>(
      `select id from recovery_standing_mandates where workspace_id = $1 and status = 'ACTIVE'`,
      [input.workspaceId],
    );
    if (existing.rows[0]) throw new RecoveryServiceError("CONFLICT", "An active standing mandate already exists.");
    const versionRow = await client.query<{ version: string }>(
      `select coalesce(max(version), 0)::text as version from recovery_standing_mandates where workspace_id = $1`,
      [input.workspaceId],
    );
    const nextMandateVersion = Number(versionRow.rows[0]?.version ?? 0) + 1;
    const inserted = await client.query<MandateRow>(
      `insert into recovery_standing_mandates (
         workspace_id, version, status, terms_version, signed_text, signed_text_hash,
         per_action_ceiling_minor, rolling_30d_ceiling_minor, veto_window_hours,
         signed_by_user_id
       ) values ($1, $2, 'ACTIVE', $3, $4, $5, $6, $7, $8, $9)
       returning id, version, status, terms_version, signed_text, signed_text_hash, currency,
                 per_action_ceiling_minor::text, rolling_30d_ceiling_minor::text, veto_window_hours,
                 signed_at, revoked_at`,
      [
        input.workspaceId,
        nextMandateVersion,
        standingMandateTermsVersion,
        standingMandateSignedText,
        standingMandateTextHash(),
        defaultPerActionCeilingMinor.toString(),
        defaultRolling30dCeilingMinor.toString(),
        standingMandateVetoHours,
        input.actorUserId,
      ],
    );
    const mandate = inserted.rows[0];
    if (!mandate) throw new RecoveryServiceError("SAVE_FAILED");
    await client.query(
      `insert into recovery_billing_year_anchors (workspace_id, anchor_date)
       values ($1, $2::date)
       on conflict (workspace_id) do nothing`,
      [input.workspaceId, mandate.signed_at],
    );
    await client.query(
      `insert into recovery_standing_mandate_events (workspace_id, mandate_id, kind, actor_user_id)
       values ($1, $2, 'SIGNED', $3)`,
      [input.workspaceId, mandate.id, input.actorUserId],
    );
    const actor = await client.query<{ email: string }>(
      `select email from users where id = $1`,
      [input.actorUserId],
    );
    await recordConsentGrant({
      workspaceId: input.workspaceId,
      userId: input.actorUserId,
      subjectEmail: actor.rows[0]?.email ?? null,
      purpose: standingMandateConsentPurpose,
      noticeVersion: standingMandateTermsVersion,
      source: "standing-mandate-sign",
      scopes: ["standing-mandate"],
      resourceKey: mandate.id,
    }, client);
    await refreshCandidates(client, input.workspaceId, mandate);
    const workspaceVersion = await bumpVersion(client, input.workspaceId, input.actorUserId, "MANDATE");
    const dto = toMandateDto(mandate);
    await writeIdempotent(client, input.workspaceId, input.idempotencyKey, operation, requestHash, dto, workspaceVersion);
    await recordProductEvent({
      workspaceId: input.workspaceId,
      userId: input.actorUserId,
      eventName: "mandate.signed",
      source: "workspace-api",
      status: "succeeded",
    }, client);
    await client.query("commit");
    return { mandate: dto, workspaceVersion, replayed: false };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeStandingMandate(input: {
  workspaceId: string;
  actorUserId: string;
  expectedVersion: number;
  idempotencyKey: string;
}) {
  const client = await getDatabasePool().connect();
  const operation = "recovery.revoke-standing-mandate";
  const requestHash = hashRecoveryRequest({ operation });
  try {
    await client.query("begin");
    await lockAutopilotShadowGate(client);
    await lockWorkspace(client, input.workspaceId);
    await assertRole(client, input.actorUserId, input.workspaceId, "owner");
    const replay = await readIdempotent<StandingMandateDto>(client, input.workspaceId, input.idempotencyKey, operation, requestHash);
    if (replay) {
      await client.query("commit");
      return { mandate: replay.response, workspaceVersion: replay.workspaceVersion, replayed: true };
    }
    await assertExpectedVersion(client, input.workspaceId, input.expectedVersion);
    const updated = await client.query<MandateRow>(
      `update recovery_standing_mandates
       set status = 'REVOKED', revoked_at = now(), revoked_by_user_id = $2
       where workspace_id = $1 and status = 'ACTIVE'
       returning id, version, status, terms_version, signed_text, signed_text_hash, currency,
                 per_action_ceiling_minor::text, rolling_30d_ceiling_minor::text, veto_window_hours,
                 signed_at, revoked_at`,
      [input.workspaceId, input.actorUserId],
    );
    const mandate = updated.rows[0];
    if (!mandate) throw new RecoveryServiceError("NOT_FOUND", "No active standing mandate exists.");
    await client.query(
      `insert into recovery_standing_mandate_events (workspace_id, mandate_id, kind, actor_user_id)
       values ($1, $2, 'REVOKED', $3)`,
      [input.workspaceId, mandate.id, input.actorUserId],
    );
    await client.query(
      `update recovery_action_candidates
       set status = 'REVOKED', updated_at = now()
       where workspace_id = $1 and mandate_id = $2
         and status not in ('VERIFIED', 'EXECUTED', 'REVOKED', 'VETOED', 'WITHDRAWN')`,
      [input.workspaceId, mandate.id],
    );
    await client.query(
      `update consent_grants
       set withdrawn_at = coalesce(withdrawn_at, now())
       where workspace_id = $1 and purpose = $2 and withdrawn_at is null`,
      [input.workspaceId, standingMandateConsentPurpose],
    );
    const workspaceVersion = await bumpVersion(client, input.workspaceId, input.actorUserId, "MANDATE");
    const dto = toMandateDto(mandate);
    await writeIdempotent(client, input.workspaceId, input.idempotencyKey, operation, requestHash, dto, workspaceVersion);
    await recordProductEvent({
      workspaceId: input.workspaceId,
      userId: input.actorUserId,
      eventName: "mandate.revoked",
      source: "workspace-api",
      status: "succeeded",
    }, client);
    await client.query("commit");
    return { mandate: dto, workspaceVersion, replayed: false };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const queuedDisconnectStatuses = ["SHADOW", "NOTICE_QUEUED", "AUTHORIZED_BY_RULE"] as const;

async function withdrawQueuedCandidatesForMissingSource(
  client: PoolClient,
  workspaceId: string,
  actorUserId: string,
) {
  const queued = await client.query<{ id: string; status: string }>(
    `select candidate.id, candidate.status
     from recovery_action_candidates candidate
     join recovery_classification_snapshots snapshot
       on snapshot.id = candidate.classification_snapshot_id
     where candidate.workspace_id = $1
       and candidate.status = any($2::text[])
       and not (${candidateCitedSourcesCurrentSql})
     for update of candidate`,
    [workspaceId, queuedDisconnectStatuses],
  );
  const withdrawnIds: string[] = [];
  for (const row of queued.rows) {
    await client.query(
      `update recovery_action_candidates
       set status = 'WITHDRAWN', notice_delivered_at = null, veto_deadline_at = null, updated_at = now()
       where workspace_id = $1 and id = $2`,
      [workspaceId, row.id],
    );
    await client.query(
      `insert into recovery_candidate_events (workspace_id, candidate_id, previous_status, status, actor_kind, actor_user_id, reason_code)
       values ($1, $2, $3, 'WITHDRAWN', 'CUSTOMER', $4, 'source-disconnected')`,
      [workspaceId, row.id, row.status, actorUserId],
    );
    withdrawnIds.push(row.id);
  }
  return withdrawnIds;
}

async function restoreCandidatesAfterSourceReconnect(
  client: PoolClient,
  workspaceId: string,
  actorUserId: string,
) {
  const events = await client.query<{ candidate_id: string }>(
    `select distinct on (event.candidate_id) event.candidate_id
     from recovery_candidate_events event
     join recovery_action_candidates candidate
       on candidate.workspace_id = event.workspace_id and candidate.id = event.candidate_id
     join recovery_classification_snapshots snapshot
       on snapshot.id = candidate.classification_snapshot_id
     where event.workspace_id = $1
       and event.status = 'WITHDRAWN'
       and event.reason_code = 'source-disconnected'
       and candidate.status = 'WITHDRAWN'
       and ${candidateCitedSourcesCurrentSql}
       and ${candidateClassificationCurrentSql}
       and candidate.eligibility = 'ELIGIBLE'
     order by event.candidate_id, event.created_at desc`,
    [workspaceId],
  );
  const restoredIds: string[] = [];
  for (const row of events.rows) {
    // Reconnection restores evidence availability, not prior notice authority.
    // A fresh evaluator/queue pass must establish every state beyond SHADOW.
    const nextStatus = "SHADOW";
    await client.query(
      `update recovery_action_candidates
       set status = $3, notice_delivered_at = null, veto_deadline_at = null, updated_at = now()
       where workspace_id = $1 and id = $2 and status = 'WITHDRAWN'`,
      [workspaceId, row.candidate_id, nextStatus],
    );
    await client.query(
      `insert into recovery_candidate_events (workspace_id, candidate_id, previous_status, status, actor_kind, actor_user_id, reason_code)
       values ($1, $2, 'WITHDRAWN', $3, 'CUSTOMER', $4, 'source-reconnected')`,
      [workspaceId, row.candidate_id, nextStatus, actorUserId],
    );
    restoredIds.push(row.candidate_id);
  }
  return restoredIds;
}

function toSourceDisconnectionDto(row: {
  source_id: string;
  disconnected_at: Date;
  reconnected_at: Date | null;
}, withdrawnCandidateIds: readonly string[]): RecoverySourceDisconnectionDto {
  return {
    sourceId: row.source_id,
    disconnectedAt: row.disconnected_at.toISOString(),
    reconnectedAt: row.reconnected_at?.toISOString() ?? null,
    withdrawnCandidateIds,
  };
}

export async function revokeActiveStandingMandateForConsentWithdrawal(
  client: PoolClient,
  input: { workspaceId: string; actorUserId: string; consentId: string; resourceKey: string | null },
) {
  await lockAutopilotAuthorityGate(client);
  await lockWorkspace(client, input.workspaceId);
  await client.query(`select id from consent_grants where id = $1 for update`, [input.consentId]);
  const active = await client.query<{ id: string }>(
    `select id from recovery_standing_mandates
     where workspace_id = $1 and status = 'ACTIVE'
     for update`,
    [input.workspaceId],
  );
  const mandate = active.rows[0];
  if (!mandate) return;
  if (input.resourceKey && input.resourceKey !== mandate.id) return;
  await client.query(
    `update recovery_standing_mandates
     set status = 'REVOKED', revoked_at = now(), revoked_by_user_id = $2
     where workspace_id = $1 and id = $3 and status = 'ACTIVE'`,
    [input.workspaceId, input.actorUserId, mandate.id],
  );
  await client.query(
    `insert into recovery_standing_mandate_events (workspace_id, mandate_id, kind, actor_user_id)
     values ($1, $2, 'REVOKED', $3)`,
    [input.workspaceId, mandate.id, input.actorUserId],
  );
  await client.query(
    `update recovery_action_candidates
     set status = 'REVOKED', updated_at = now()
     where workspace_id = $1 and mandate_id = $2
       and status not in ('VERIFIED', 'EXECUTED', 'REVOKED', 'VETOED', 'WITHDRAWN')`,
    [input.workspaceId, mandate.id],
  );
  await bumpVersion(client, input.workspaceId, input.actorUserId, "MANDATE");
  await recordProductEvent({
    workspaceId: input.workspaceId,
    userId: input.actorUserId,
    eventName: "mandate.revoked",
    source: "workspace-api",
    status: "succeeded",
  }, client);
}

export async function disconnectRecoverySource(input: {
  workspaceId: string;
  actorUserId: string;
  sourceId: string;
  expectedVersion: number;
  idempotencyKey: string;
}) {
  const client = await getDatabasePool().connect();
  const operation = "recovery.disconnect-source";
  const requestHash = hashRecoveryRequest({ operation, sourceId: input.sourceId });
  try {
    await client.query("begin");
    await lockAutopilotShadowGate(client);
    await lockWorkspace(client, input.workspaceId);
    await assertRole(client, input.actorUserId, input.workspaceId, "admin");
    const replay = await readIdempotent<RecoverySourceDisconnectionDto>(
      client,
      input.workspaceId,
      input.idempotencyKey,
      operation,
      requestHash,
    );
    if (replay) {
      await client.query("commit");
      return { disconnection: replay.response, workspaceVersion: replay.workspaceVersion, replayed: true };
    }
    await assertExpectedVersion(client, input.workspaceId, input.expectedVersion);
    const source = await client.query<{ id: string }>(
      `select id from recovery_sources where workspace_id = $1 and id = $2`,
      [input.workspaceId, input.sourceId],
    );
    if (!source.rows[0]) throw new RecoveryServiceError("NOT_FOUND", "Recovery source was not found.");
    const upserted = await client.query<{
      source_id: string;
      disconnected_at: Date;
      reconnected_at: Date | null;
    }>(
      `insert into recovery_source_disconnections (workspace_id, source_id, disconnected_at, reconnected_at)
       values ($1, $2, now(), null)
       on conflict (workspace_id, source_id) do update
         set disconnected_at = case
           when recovery_source_disconnections.reconnected_at is null
           then recovery_source_disconnections.disconnected_at
           else now()
         end,
         reconnected_at = null
       returning source_id, disconnected_at, reconnected_at`,
      [input.workspaceId, input.sourceId],
    );
    const row = upserted.rows[0];
    if (!row) throw new RecoveryServiceError("SAVE_FAILED");
    const withdrawnCandidateIds = await withdrawQueuedCandidatesForMissingSource(
      client,
      input.workspaceId,
      input.actorUserId,
    );
    const dto = toSourceDisconnectionDto(row, withdrawnCandidateIds);
    const workspaceVersion = await bumpVersion(client, input.workspaceId, input.actorUserId, "CANDIDATE");
    await writeIdempotent(client, input.workspaceId, input.idempotencyKey, operation, requestHash, dto, workspaceVersion);
    await client.query("commit");
    return { disconnection: dto, workspaceVersion, replayed: false };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function reconnectRecoverySource(input: {
  workspaceId: string;
  actorUserId: string;
  sourceId: string;
  expectedVersion: number;
  idempotencyKey: string;
}) {
  const client = await getDatabasePool().connect();
  const operation = "recovery.reconnect-source";
  const requestHash = hashRecoveryRequest({ operation, sourceId: input.sourceId });
  try {
    await client.query("begin");
    await lockAutopilotShadowGate(client);
    await lockWorkspace(client, input.workspaceId);
    await assertRole(client, input.actorUserId, input.workspaceId, "admin");
    const replay = await readIdempotent<RecoverySourceDisconnectionDto>(
      client,
      input.workspaceId,
      input.idempotencyKey,
      operation,
      requestHash,
    );
    if (replay) {
      await client.query("commit");
      return { disconnection: replay.response, workspaceVersion: replay.workspaceVersion, replayed: true };
    }
    await assertExpectedVersion(client, input.workspaceId, input.expectedVersion);
    const updated = await client.query<{
      source_id: string;
      disconnected_at: Date;
      reconnected_at: Date | null;
    }>(
      `update recovery_source_disconnections
       set reconnected_at = coalesce(reconnected_at, now())
       where workspace_id = $1 and source_id = $2 and reconnected_at is null
       returning source_id, disconnected_at, reconnected_at`,
      [input.workspaceId, input.sourceId],
    );
    const row = updated.rows[0];
    if (!row) throw new RecoveryServiceError("NOT_FOUND", "No current source disconnection exists.");
    const mandate = await readActiveMandate(client, input.workspaceId);
    if (mandate) await refreshCandidates(client, input.workspaceId, mandate);
    await restoreCandidatesAfterSourceReconnect(client, input.workspaceId, input.actorUserId);
    const dto = toSourceDisconnectionDto(row, []);
    const workspaceVersion = await bumpVersion(client, input.workspaceId, input.actorUserId, "CANDIDATE");
    await writeIdempotent(client, input.workspaceId, input.idempotencyKey, operation, requestHash, dto, workspaceVersion);
    await client.query("commit");
    return { disconnection: dto, workspaceVersion, replayed: false };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function listAutopilotCandidates(input: { workspaceId: string; actorUserId: string }) {
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin isolation level repeatable read read only");
    await assertRole(client, input.actorUserId, input.workspaceId, "viewer");
    const items = await listCandidateDtos(client, input.workspaceId);
    const workspaceVersion = await readVersion(client, input.workspaceId);
    await client.query("commit");
    return { items, workspaceVersion };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function vetoAutopilotCandidate(input: {
  workspaceId: string;
  actorUserId: string;
  candidateId: string;
  expectedVersion: number;
  idempotencyKey: string;
}) {
  const client = await getDatabasePool().connect();
  const operation = "recovery.veto-candidate";
  const requestHash = hashRecoveryRequest({ operation, candidateId: input.candidateId });
  try {
    await client.query("begin");
    await lockAutopilotShadowGate(client);
    await lockWorkspace(client, input.workspaceId);
    await assertRole(client, input.actorUserId, input.workspaceId, "member");
    const replay = await readIdempotent<AutopilotCandidateDto>(client, input.workspaceId, input.idempotencyKey, operation, requestHash);
    if (replay) {
      await client.query("commit");
      return { candidate: replay.response, workspaceVersion: replay.workspaceVersion, replayed: true };
    }
    await assertExpectedVersion(client, input.workspaceId, input.expectedVersion);
    const current = await client.query<CandidateRow>(candidateSelect, [input.workspaceId, input.candidateId]);
    const row = current.rows[0];
    if (!row) throw new RecoveryServiceError("NOT_FOUND");
    if (!canTransitionCandidate(row.status as never, "VETOED", {
      executionEnabled: isAutopilotExecutionEnabled(),
      noticeDelivered: Boolean(row.notice_delivered_at),
      noticeEnabled: isAutopilotNoticeEnabled(),
      now: new Date(),
      vetoDeadline: row.veto_deadline_at,
      vetoed: true,
      revoked: false,
    }) && row.status !== "SHADOW" && row.status !== "NOTICE_QUEUED" && row.status !== "AUTHORIZED_BY_RULE") {
      throw new RecoveryServiceError("CONFLICT", "This case can no longer be vetoed.");
    }
    const updated = await client.query<CandidateRow>(
      `update recovery_action_candidates
       set status = 'VETOED', updated_at = now()
       where workspace_id = $1 and id = $2
         and status in ('SHADOW', 'NOTICE_QUEUED', 'AUTHORIZED_BY_RULE')
       returning ${candidateReturning}`,
      [input.workspaceId, input.candidateId],
    );
    const candidate = updated.rows[0];
    if (!candidate) throw new RecoveryServiceError("CONFLICT", "This case can no longer be vetoed.");
    await client.query(
      `insert into recovery_candidate_events (workspace_id, candidate_id, previous_status, status, actor_kind, actor_user_id, reason_code)
       values ($1, $2, $3, 'VETOED', 'CUSTOMER', $4, 'customer-veto')`,
      [input.workspaceId, input.candidateId, row.status, input.actorUserId],
    );
    const workspaceVersion = await bumpVersion(client, input.workspaceId, input.actorUserId, "CANDIDATE");
    const dto = toCandidateDto(candidate);
    await writeIdempotent(client, input.workspaceId, input.idempotencyKey, operation, requestHash, dto, workspaceVersion);
    await recordProductEvent({
      workspaceId: input.workspaceId,
      userId: input.actorUserId,
      eventName: "candidate.vetoed",
      source: "workspace-api",
      status: "succeeded",
    }, client);
    await client.query("commit");
    return { candidate: dto, workspaceVersion, replayed: false };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function refreshAutopilotCandidates(client: PoolClient, workspaceId: string) {
  const mandate = await readActiveMandate(client, workspaceId);
  if (!mandate) return;
  await refreshCandidates(client, workspaceId, mandate);
}

export async function loadAutopilotHome(client: PoolClient, workspaceId: string): Promise<AutopilotHomeDto> {
  const mandate = await readActiveOrLatestMandate(client, workspaceId);
  const items = await listCandidateDtos(client, workspaceId);
  const windows = await client.query<{
    candidate_id: string;
    status: AutopilotWindowDto["status"];
    expected_debit_date: string;
    saving_minor: string | null;
    currency: string;
  }>(
    `select candidate_id, status, expected_debit_date::text, saving_minor::text, currency
     from recovery_covered_windows where workspace_id = $1
     order by expected_debit_date desc`,
    [workspaceId],
  );
  const fee = await client.query<{
    currency: string;
    monitoring_minor: string;
    verified_saving_minor: string;
    outcome_fee_minor: string;
    retained_minor: string;
    refund_credit_minor: string;
    additional_charge_minor: string;
    razorpay_charge_status: AutopilotFeeDto["chargeStatus"];
  }>(
    `select distinct on (currency)
            currency, monitoring_minor::text, verified_saving_minor::text, outcome_fee_minor::text,
            retained_minor::text, refund_credit_minor::text, additional_charge_minor::text,
            razorpay_charge_status
     from recovery_fee_ledger where workspace_id = $1
     order by currency, period_end desc`,
    [workspaceId],
  );
  const attempts = await client.query<{
    attempt_no: number;
    operation_key: string;
    status: string;
    outcome: string | null;
    operator_minutes: string | null;
    proof_kind: string | null;
    failure_reason: string | null;
    created_at: Date;
  }>(
    `select attempt_no, operation_key, status, outcome, operator_minutes::text, proof_kind,
            failure_reason, created_at
     from recovery_execution_attempts
     where workspace_id = $1
     order by created_at desc
     limit 20`,
    [workspaceId],
  );
  const placed = new Set<string>();
  const take = (predicate: (item: AutopilotCandidateDto) => boolean) => {
    const selected = items.filter((item) => !placed.has(item.id) && predicate(item));
    for (const item of selected) placed.add(item.id);
    return selected;
  };
  const inVeto = take((item) => item.noticePresentation.kind === "veto-window");
  const awaitingDelivery = take((item) =>
    item.noticePresentation.kind === "queued"
    || item.noticePresentation.kind === "accepted"
    || item.noticePresentation.kind === "delayed"
  );
  const needsHelp = take((item) =>
    item.status === "EXCEPTION"
    || item.eligibility === "UNSUPPORTED_ROUTE"
    || item.noticePresentation.kind === "bounced"
    || item.noticePresentation.kind === "failed"
    || item.noticePresentation.kind === "complained"
    || item.noticePresentation.kind === "token-invalid"
  );
  const handled = take((item) => ["AUTHORIZED_BY_RULE", "IN_PROGRESS", "PROVIDER_PENDING", "EXECUTED", "VERIFYING", "VERIFIED"].includes(item.status));
  const watching = take((item) => item.status === "SHADOW");
  return {
    executionEnabled: isAutopilotExecutionEnabled(),
    noticeEnabled: isAutopilotNoticeEnabled(),
    noticeReadiness: currentNoticeReadiness(),
    mandate,
    watching,
    awaitingDelivery,
    inVeto,
    handled,
    needsHelp,
    proof: windows.rows.map((row) => ({
      candidateId: row.candidate_id,
      status: row.status,
      expectedDebitDate: row.expected_debit_date,
      currency: row.currency,
      saving: optionalSavingDto(row.saving_minor, row.currency),
    })),
    fees: fee.rows.map((row): AutopilotFeeDto => ({
      currency: row.currency,
      monitoring: requireMoneyDto(row.monitoring_minor, row.currency, "Fee monitoring"),
      verifiedSaving: requireMoneyDto(row.verified_saving_minor, row.currency, "Fee verified saving"),
      outcomeFee: requireMoneyDto(row.outcome_fee_minor, row.currency, "Fee outcome"),
      retained: requireMoneyDto(row.retained_minor, row.currency, "Fee retained"),
      refundCredit: requireMoneyDto(row.refund_credit_minor, row.currency, "Fee refund credit"),
      additionalCharge: requireMoneyDto(row.additional_charge_minor, row.currency, "Fee additional charge"),
      chargeStatus: row.razorpay_charge_status,
    })),
    attempts: attempts.rows.map((row): AutopilotAttemptDto => ({
      attemptNo: row.attempt_no,
      operationKey: row.operation_key,
      status: row.status,
      outcome: row.outcome,
      operatorMinutes: row.operator_minutes,
      proofKind: row.proof_kind,
      failureReason: row.failure_reason,
      createdAt: row.created_at.toISOString(),
    })),
  };
}

export async function loadRecoveryEvidenceSources(client: PoolClient, workspaceId: string): Promise<readonly RecoveryEvidenceSourceDto[]> {
  const result = await client.query<{
    id: string;
    kind: SourceType;
    label: string;
    cited: boolean;
    status: "CONNECTED" | "DISCONNECTED";
    disconnected_at: Date | null;
    reconnected_at: Date | null;
  }>(
    `select source.id::text, source.source_type as kind, source.label,
            exists (
              select 1
              from recovery_classification_snapshots snap
              where snap.workspace_id = source.workspace_id
                and snap.id = (
                  select latest.id from recovery_classification_snapshots latest
                  where latest.workspace_id = snap.workspace_id
                    and latest.commitment_id = snap.commitment_id
                  order by latest.created_at desc, latest.id desc
                  limit 1
                )
                and exists (
                  select 1 from unnest(snap.evidence_ids) as cited(id)
                  join recovery_evidence evidence
                    on evidence.workspace_id = snap.workspace_id and evidence.id = cited.id
                  where evidence.source_id = source.id
                )
            ) as cited,
            case
              when disconnect.disconnected_at is not null and disconnect.reconnected_at is null
              then 'DISCONNECTED'
              else 'CONNECTED'
            end as status,
            disconnect.disconnected_at, disconnect.reconnected_at
     from recovery_sources source
     left join recovery_source_disconnections disconnect
       on disconnect.workspace_id = source.workspace_id and disconnect.source_id = source.id
     where source.workspace_id = $1
     order by source.ingested_at asc, source.id asc`,
    [workspaceId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    label: row.label,
    cited: row.cited,
    status: row.status,
    disconnectedAt: row.disconnected_at?.toISOString() ?? null,
    reconnectedAt: row.reconnected_at?.toISOString() ?? null,
  }));
}

export async function runShadowEvaluator(workspaceId: string) {
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    await lockAutopilotShadowGate(client);
    await lockWorkspace(client, workspaceId);
    const mandate = await readActiveMandate(client, workspaceId);
    if (mandate) await refreshCandidates(client, workspaceId, mandate);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function queueDueNotices(now = new Date()) {
  if (!isAutopilotNoticeEnabled()) return { queued: 0, delivered: 0, accepted: 0 };
  const client = await getDatabasePool().connect();
  const horizonStart = new Date(now.getTime() + productionVetoHours() * 60 * 60 * 1000).toISOString().slice(0, 10);
  const horizonEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let queued = 0;
  try {
    await client.query("begin");
    await lockAutopilotShadowGate(client);
    const due = await client.query<{ id: string; workspace_id: string; status: string }>(
      `select candidate.id, candidate.workspace_id, candidate.status
       from recovery_action_candidates candidate
       join recovery_commitments commitment
         on commitment.workspace_id = candidate.workspace_id
        and commitment.id = candidate.commitment_id
       join recovery_standing_mandates mandate
         on mandate.workspace_id = candidate.workspace_id and mandate.id = candidate.mandate_id
       join workspaces workspace
         on workspace.id = candidate.workspace_id
       join recovery_classification_snapshots snapshot
         on snapshot.id = candidate.classification_snapshot_id
       where candidate.status = 'SHADOW'
         and candidate.eligibility = 'ELIGIBLE'
         and mandate.status = 'ACTIVE'
         and ${standingMandateConsentExistsSql}
         and ${candidateCitedSourcesCurrentSql}
         and ${candidateClassificationCurrentSql}
         and candidate.next_debit_date is not null
         and candidate.next_debit_date::text > $1
         and candidate.next_debit_date::text <= $2`,
      [horizonStart, horizonEnd],
    );
    for (const row of due.rows) {
      if (!canTransitionCandidate(row.status as CandidateStatus, "NOTICE_QUEUED", {
        executionEnabled: isAutopilotExecutionEnabled(),
        noticeDelivered: false,
        noticeEnabled: true,
        now,
        vetoDeadline: null,
        vetoed: false,
        revoked: false,
      })) continue;
      const inserted = await client.query(
        `insert into recovery_veto_notices (workspace_id, candidate_id, channel, delivery_status)
         values ($1, $2, 'EMAIL', 'QUEUED')
         on conflict (workspace_id, candidate_id) do nothing`,
        [row.workspace_id, row.id],
      );
      if ((inserted.rowCount ?? 0) === 0) continue;
      await client.query(
        `update recovery_action_candidates
         set status = 'NOTICE_QUEUED', updated_at = now()
         where workspace_id = $1 and id = $2 and status = 'SHADOW'`,
        [row.workspace_id, row.id],
      );
      await client.query(
        `insert into recovery_candidate_events (workspace_id, candidate_id, previous_status, status, actor_kind, reason_code)
         values ($1, $2, 'SHADOW', 'NOTICE_QUEUED', 'SYSTEM', 'notice-queued')`,
        [row.workspace_id, row.id],
      );
      await recordProductEvent({
        workspaceId: row.workspace_id,
        eventName: "notice.queued",
        source: "workspace-api",
        status: "started",
      }, client);
      queued += 1;
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  const accepted = await sendQueuedAutopilotNotices(now);
  return { queued, delivered: 0, accepted };
}

export async function sendQueuedAutopilotNotices(
  now = new Date(),
  scope?: { workspaceId?: string; candidateId?: string },
) {
  if (!canQueueDeliverableAutopilotNotice()) return 0;
  const secret = autopilotVetoTokenSecret();
  const pool = getDatabasePool();
  const queued = await pool.query<{
    workspace_id: string;
    candidate_id: string;
    email: string;
    merchant: string;
    notice_from_email: string | null;
    notice_to_email: string | null;
    notice_subject: string | null;
    notice_text: string | null;
    frozen_at: Date | null;
    veto_expires_at: Date | null;
    notice_body_hash: string | null;
    veto_token_hash: string | null;
  }>(
    `select notice.workspace_id, notice.candidate_id, users.email,
            commitment.effective_merchant as merchant,
            notice.notice_from_email, notice.notice_to_email, notice.notice_subject,
            notice.notice_text, notice.frozen_at, notice.veto_expires_at,
            notice.notice_body_hash, notice.veto_token_hash
     from recovery_veto_notices notice
     join recovery_action_candidates candidate
       on candidate.workspace_id = notice.workspace_id and candidate.id = notice.candidate_id
     join recovery_commitments commitment
       on commitment.workspace_id = candidate.workspace_id and commitment.id = candidate.commitment_id
     join workspaces workspace on workspace.id = notice.workspace_id
     join users on users.id = workspace.owner_user_id
     where notice.delivery_status = 'QUEUED' and candidate.status = 'NOTICE_QUEUED'
       and ($1::uuid is null or notice.workspace_id = $1)
       and ($2::uuid is null or notice.candidate_id = $2)
     order by notice.created_at asc
     limit 50`,
    [scope?.workspaceId ?? null, scope?.candidateId ?? null],
  );
  let accepted = 0;
  for (const row of queued.rows) {
    await runNoticeSendInterleave("after-select", row.workspace_id, row.candidate_id);
    if (!(await noticeAuthorityStillValid(row.workspace_id, row.candidate_id))) continue;
    if (row.frozen_at && !resendIdempotencyWindowOpen(row.frozen_at, now)) {
      await pool.query(
        `insert into recovery_autopilot_dead_letters (kind, workspace_id, candidate_id, payload_hash, last_error_code, attempt_count)
         select 'NOTICE', $1, $2, $3, 'IDEMPOTENCY_WINDOW_EXPIRED', 1
         where not exists (
           select 1 from recovery_autopilot_dead_letters
           where workspace_id = $1 and candidate_id = $2 and last_error_code = 'IDEMPOTENCY_WINDOW_EXPIRED'
         )`,
        [row.workspace_id, row.candidate_id, row.notice_body_hash ?? "0".repeat(64)],
      );
      continue;
    }
    const freezeClient = await pool.connect();
    let frozen: ReturnType<typeof freezeAutopilotNotice> | null = null;
    try {
      await freezeClient.query("begin");
      const locked = await freezeClient.query<{
        veto_expires_at: Date | null;
        notice_body_hash: string | null;
        veto_token_hash: string | null;
        notice_from_email: string | null;
        notice_to_email: string | null;
        notice_subject: string | null;
        notice_text: string | null;
        notice_tags: unknown;
        notice_payload_version: number | null;
        notice_hash_version: number | null;
        frozen_at: Date | null;
      }>(
        `select veto_expires_at, notice_body_hash, veto_token_hash, notice_from_email, notice_to_email,
                notice_subject, notice_text, notice_tags, notice_payload_version, notice_hash_version, frozen_at
         from recovery_veto_notices
         where workspace_id = $1 and candidate_id = $2 and delivery_status = 'QUEUED'
         for update`,
        [row.workspace_id, row.candidate_id],
      );
      const notice = locked.rows[0];
      if (!notice) {
        await freezeClient.query("rollback");
        continue;
      }
      if (notice.frozen_at && !resendIdempotencyWindowOpen(notice.frozen_at, now)) {
        await freezeClient.query("rollback");
        await pool.query(
          `insert into recovery_autopilot_dead_letters (kind, workspace_id, candidate_id, payload_hash, last_error_code, attempt_count)
           select 'NOTICE', $1, $2, $3, 'IDEMPOTENCY_WINDOW_EXPIRED', 1
           where not exists (
             select 1 from recovery_autopilot_dead_letters
             where workspace_id = $1 and candidate_id = $2 and last_error_code = 'IDEMPOTENCY_WINDOW_EXPIRED'
           )`,
          [row.workspace_id, row.candidate_id, notice.notice_body_hash ?? "0".repeat(64)],
        );
        continue;
      }
      if (
        notice.notice_from_email
        && notice.notice_to_email
        && notice.notice_subject
        && notice.notice_text
        && notice.notice_body_hash
        && notice.veto_token_hash
      ) {
        frozen = frozenAutopilotNoticeFromPersistence({
          workspaceId: row.workspace_id,
          candidateId: row.candidate_id,
          tokenHash: notice.veto_token_hash,
          from: notice.notice_from_email,
          to: notice.notice_to_email,
          subject: notice.notice_subject,
          text: notice.notice_text,
          tags: notice.notice_tags,
          payloadVersion: notice.notice_payload_version ?? autopilotNoticePayloadVersion,
          bodyHash: notice.notice_body_hash,
        });
        const expectedHash = hashAutopilotNoticeProviderPayload({
          from: frozen.from,
          to: frozen.to,
          subject: frozen.subject,
          text: frozen.text,
          tags: frozen.tags,
          payloadVersion: frozen.payloadVersion,
        });
        const legacyHash = hashLegacyAutopilotNoticeProviderPayload({
          from: frozen.from,
          to: frozen.to,
          subject: frozen.subject,
          text: frozen.text,
        });
        const hashMatches = notice.notice_hash_version === 1
          ? frozen.bodyHash === expectedHash || frozen.bodyHash === legacyHash
          : frozen.bodyHash === expectedHash;
        if (!hashMatches) {
          throw new RecoveryServiceError("CONFLICT", "Frozen notice payload hash does not match persisted from/to/subject/text/tags.");
        }
        await freezeClient.query("commit");
      } else {
        const from = notice.notice_from_email || autopilotNoticeFromEmail();
        const to = notice.notice_to_email || row.email;
        if (!from || !to) {
          throw new RecoveryServiceError("INVALID_EVIDENCE", "Frozen notice payload needs from and to.");
        }
        const expiresAt = notice.veto_expires_at
          ?? new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
        frozen = freezeAutopilotNotice({
          workspaceId: row.workspace_id,
          candidateId: row.candidate_id,
          expiresAt: expiresAt.toISOString(),
          appUrl: process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://vognary.com",
          secret,
          from,
          to,
        });
        if (notice.notice_body_hash && notice.notice_body_hash !== frozen.bodyHash) {
          throw new RecoveryServiceError("CONFLICT", "Frozen notice body changed under the same idempotency key.");
        }
        if (notice.veto_token_hash && notice.veto_token_hash !== frozen.tokenHash) {
          throw new RecoveryServiceError("CONFLICT", "Frozen veto token changed under the same idempotency key.");
        }
        await freezeClient.query(
          `update recovery_veto_notices
           set veto_expires_at = $3, notice_body_hash = $4, veto_token_hash = $5,
               notice_from_email = $6, notice_to_email = $7, notice_subject = $8, notice_text = $9,
               notice_tags = $10::jsonb, notice_payload_version = $11, notice_hash_version = 2,
               frozen_at = coalesce(frozen_at, $12)
           where workspace_id = $1 and candidate_id = $2 and delivery_status = 'QUEUED'`,
          [
            row.workspace_id,
            row.candidate_id,
            expiresAt.toISOString(),
            frozen.bodyHash,
            frozen.tokenHash,
            frozen.from,
            frozen.to,
            frozen.subject,
            frozen.text,
            JSON.stringify(frozen.tags),
            frozen.payloadVersion,
            now.toISOString(),
          ],
        );
        await freezeClient.query("commit");
      }
    } catch (error) {
      await freezeClient.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      freezeClient.release();
    }
    if (!frozen) continue;
    await runNoticeSendInterleave("after-freeze", row.workspace_id, row.candidate_id);
    const sendClient = await pool.connect();
    let sendGateLocked = false;
    let acceptedProviderMessageId: string | null = null;
    try {
      await lockAutopilotNoticeSendGate(sendClient);
      sendGateLocked = true;
      if (!(await noticeAuthorityStillValid(row.workspace_id, row.candidate_id, sendClient))) continue;
      await runNoticeSendInterleave("after-authority", row.workspace_id, row.candidate_id);
      const send = await sendAutopilotNotice({
        from: frozen.from,
        to: frozen.to,
        subject: frozen.subject,
        text: frozen.text,
        idempotencyKey: frozen.idempotencyKey,
        tags: frozen.tags,
      });
      if (
        process.env.NODE_ENV !== "production"
        && process.env.AUTOPILOT_TEST_ADAPTER === "true"
        && process.env.AUTOPILOT_TEST_NOTICE_PERSIST_CRASH === "true"
      ) {
        throw new Error("notice-persist-crash");
      }
      await sendClient.query("begin");
      if (send.status !== "accepted") {
        await sendClient.query(
          `insert into recovery_autopilot_dead_letters (kind, workspace_id, candidate_id, payload_hash, last_error_code, attempt_count)
           values ('NOTICE', $1, $2, $3, $4, 1)`,
          [
            row.workspace_id,
            row.candidate_id,
            frozen.bodyHash,
            send.status === "rejected" ? send.errorCode : send.reason,
          ],
        );
        await sendClient.query("commit");
        continue;
      }
      const updated = await sendClient.query(
        `update recovery_veto_notices
         set delivery_status = 'ACCEPTED', provider_message_id = $3
         where workspace_id = $1 and candidate_id = $2 and delivery_status = 'QUEUED'
           and notice_body_hash = $4 and veto_token_hash = $5
         returning id`,
        [row.workspace_id, row.candidate_id, send.providerMessageId, frozen.bodyHash, frozen.tokenHash],
      );
      await sendClient.query("commit");
      const acceptedRows = updated.rowCount ?? 0;
      accepted += acceptedRows;
      if (acceptedRows > 0) acceptedProviderMessageId = send.providerMessageId;
    } catch (error) {
      await sendClient.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      if (sendGateLocked) {
        try {
          await unlockAutopilotNoticeSendGate(sendClient);
        } catch (error) {
          sendClient.release(error instanceof Error ? error : true);
          throw error;
        }
      }
      sendClient.release();
    }
    await applyPendingNoticeEvents(acceptedProviderMessageId);
  }
  return accepted;
}

async function applyPendingNoticeEvents(providerMessageId: string | null) {
  if (!providerMessageId) return;
  const pool = getDatabasePool();
  const pending = await pool.query<{
    provider_event_id: string;
    event_type: NoticeProviderEventType;
    occurred_at: Date;
    payload_hash: string;
  }>(
    `select provider_event_id, event_type, occurred_at, payload_hash
     from recovery_notice_pending_events where provider_message_id = $1
     order by occurred_at asc`,
    [providerMessageId],
  );
  for (const event of pending.rows) {
    await applyAutopilotNoticeEvent({
      providerEventId: event.provider_event_id,
      type: event.event_type,
      providerMessageId,
      occurredAt: event.occurred_at.toISOString(),
      payloadHash: event.payload_hash,
      tagged: true,
    });
  }
}

export async function expireUnboundNoticeEvents(now = new Date()) {
  const cutoff = new Date(now.getTime() - unboundNoticeEventRetentionMs);
  const stale = await getDatabasePool().query<{
    provider_event_id: string;
    event_type: NoticeProviderEventType;
    provider_message_id: string;
    occurred_at: Date;
    payload_hash: string;
  }>(
    `select provider_event_id, event_type, provider_message_id, occurred_at, payload_hash
     from recovery_notice_pending_events
     where created_at <= $1
     order by created_at asc`,
    [cutoff],
  );
  let expired = 0;
  let reconciled = 0;
  for (const row of stale.rows) {
    const bound = await getDatabasePool().query<{ delivery_status: string }>(
      `select delivery_status
       from recovery_veto_notices
       where provider_message_id = $1
       limit 1`,
      [row.provider_message_id],
    );
    if (bound.rows[0]) {
      const applied = await applyAutopilotNoticeEvent({
        providerEventId: row.provider_event_id,
        type: row.event_type,
        providerMessageId: row.provider_message_id,
        occurredAt: row.occurred_at.toISOString(),
        payloadHash: row.payload_hash,
        tagged: true,
      });
      if (applied.status === "applied" || applied.status === "duplicate") {
        reconciled += 1;
        continue;
      }
    }
    const client = await getDatabasePool().connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into recovery_autopilot_dead_letters (kind, payload_hash, last_error_code, attempt_count)
         select 'WEBHOOK', $1, 'UNBOUND_NOTICE_EVENT', 1
         where not exists (
           select 1 from recovery_autopilot_dead_letters
           where payload_hash = $1 and last_error_code = 'UNBOUND_NOTICE_EVENT'
         )`,
        [row.payload_hash],
      );
      await client.query(
        `delete from recovery_notice_pending_events where provider_event_id = $1`,
        [row.provider_event_id],
      );
      await client.query("commit");
      expired += 1;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  return { expired, reconciled };
}

export async function applyAutopilotNoticeEvent(input: {
  providerEventId: string;
  type: NoticeProviderEventType;
  providerMessageId: string;
  occurredAt: string;
  payloadHash: string;
  workspaceId?: string;
  candidateId?: string;
  tagged?: boolean;
}) {
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    const matches = await client.query<{ workspace_id: string; candidate_id: string }>(
      `select workspace_id, candidate_id
       from recovery_veto_notices
       where provider_message_id = $1
         and ($2::uuid is null or workspace_id = $2)
         and ($3::uuid is null or candidate_id = $3)`,
      [input.providerMessageId, input.workspaceId ?? null, input.candidateId ?? null],
    );
    if (matches.rows.length > 1) {
      await client.query(
        `insert into recovery_autopilot_dead_letters (kind, payload_hash, last_error_code)
         values ('WEBHOOK', $1, 'AMBIGUOUS_NOTICE')`,
        [input.payloadHash],
      );
      await client.query("commit");
      return { status: "ignored" as const };
    }
    const inserted = await client.query(
      `insert into recovery_notice_delivery_events (
         workspace_id, candidate_id, provider_event_id, event_type, provider_message_id, occurred_at, payload_hash
       )
       select notice.workspace_id, notice.candidate_id, $1, $2, $3, $4, $5
       from recovery_veto_notices notice
       where notice.provider_message_id = $3
         and ($6::uuid is null or notice.workspace_id = $6)
         and ($7::uuid is null or notice.candidate_id = $7)
       on conflict (provider_event_id) do nothing
       returning workspace_id, candidate_id`,
      [
        input.providerEventId,
        input.type,
        input.providerMessageId,
        input.occurredAt,
        input.payloadHash,
        input.workspaceId ?? null,
        input.candidateId ?? null,
      ],
    );
    const row = inserted.rows[0] as { workspace_id: string; candidate_id: string } | undefined;
    if (!row) {
      const existing = await client.query(
        `select 1 from recovery_notice_delivery_events where provider_event_id = $1`,
        [input.providerEventId],
      );
      if ((existing.rowCount ?? 0) > 0) {
        await client.query(
          `delete from recovery_notice_pending_events where provider_event_id = $1`,
          [input.providerEventId],
        );
        await client.query("commit");
        return { status: "duplicate" as const };
      }
      if (!input.tagged) {
        await client.query("commit");
        return { status: "ignored" as const };
      }
      await client.query(
        `insert into recovery_notice_pending_events (
           provider_event_id, event_type, provider_message_id, occurred_at, payload_hash
         ) values ($1, $2, $3, $4, $5)
         on conflict (provider_event_id) do nothing`,
        [
          input.providerEventId,
          input.type,
          input.providerMessageId,
          input.occurredAt,
          input.payloadHash,
        ],
      );
      await client.query("commit");
      return { status: "pending" as const };
    }
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`recovery:${row.workspace_id}`]);
    const notice = await client.query<{
      delivery_status: NoticeDeliveryState["status"];
      provider_message_id: string | null;
      delivered_at: Date | null;
      provider_timestamp: Date | null;
      veto_deadline_at: Date | null;
      candidate_status: string;
      veto_expires_at: Date | null;
    }>(
      `select notice.delivery_status, notice.provider_message_id, notice.delivered_at,
              notice.provider_timestamp, candidate.veto_deadline_at, candidate.status as candidate_status,
              notice.veto_expires_at
       from recovery_veto_notices notice
       join recovery_action_candidates candidate
         on candidate.workspace_id = notice.workspace_id and candidate.id = notice.candidate_id
       where notice.workspace_id = $1 and notice.candidate_id = $2
       for update of notice, candidate`,
      [row.workspace_id, row.candidate_id],
    );
    const current = notice.rows[0];
    if (!current) {
      await client.query("commit");
      return { status: "ignored" as const };
    }
    const next = applyNoticeDeliveryEvent({
      status: current.delivery_status,
      providerMessageId: current.provider_message_id,
      deliveredAt: current.delivered_at?.toISOString() ?? null,
      vetoDeadlineAt: current.delivered_at
        ? vetoDeadlineFromDelivery(current.delivered_at).toISOString()
        : current.veto_deadline_at?.toISOString() ?? null,
      lastEventOccurredAt: current.provider_timestamp?.toISOString() ?? null,
    }, {
      type: input.type,
      providerMessageId: input.providerMessageId,
      occurredAt: input.occurredAt,
    });
    await client.query(
      `update recovery_veto_notices
       set delivery_status = $3, delivered_at = $4, provider_message_id = $5, provider_timestamp = $6
       where workspace_id = $1 and candidate_id = $2`,
      [
        row.workspace_id,
        row.candidate_id,
        next.status,
        next.deliveredAt,
        next.providerMessageId,
        next.lastEventOccurredAt ?? input.occurredAt,
      ],
    );
    const clockMayStart = Boolean(
      next.deliveredAt
      && current.veto_expires_at
      && noticeClockMayStart({
        tokenExpiresAt: current.veto_expires_at.toISOString(),
        deliveredAt: new Date(next.deliveredAt),
      }),
    );
    if (
      noticeAuthorizesClock(next)
      && clockMayStart
      && next.vetoDeadlineAt
      && current.candidate_status === "NOTICE_QUEUED"
    ) {
      await client.query(
        `update recovery_action_candidates
         set notice_delivered_at = $3, veto_deadline_at = $4, updated_at = now()
         where workspace_id = $1 and id = $2`,
        [row.workspace_id, row.candidate_id, next.deliveredAt, next.vetoDeadlineAt],
      );
      if (current.delivery_status !== "DELIVERED") {
        await recordProductEvent({
          workspaceId: row.workspace_id,
          eventName: "notice.delivered",
          source: "workspace-api",
          status: "succeeded",
        }, client);
      }
    } else if (
      next.status === "DELIVERED"
      && next.deliveredAt
      && current.veto_expires_at
      && !clockMayStart
    ) {
      await client.query(
        `insert into recovery_autopilot_dead_letters (kind, workspace_id, candidate_id, payload_hash, last_error_code, attempt_count)
         select 'WEBHOOK', $1, $2, $3, 'NOTICE_TOKEN_COVERAGE_INVALID', 1
         where not exists (
           select 1 from recovery_autopilot_dead_letters
           where workspace_id = $1 and candidate_id = $2 and last_error_code = 'NOTICE_TOKEN_COVERAGE_INVALID'
         )`,
        [row.workspace_id, row.candidate_id, input.payloadHash],
      );
    }
    if (!noticeAuthorizesClock(next)) {
      await client.query(
        `update recovery_action_candidates
         set notice_delivered_at = null, veto_deadline_at = null, updated_at = now()
         where workspace_id = $1 and id = $2
           and (notice_delivered_at is not null or veto_deadline_at is not null)`,
        [row.workspace_id, row.candidate_id],
      );
      if (current.candidate_status === "AUTHORIZED_BY_RULE") {
        await client.query(
          `update recovery_action_candidates
           set status = 'NOTICE_QUEUED', updated_at = now()
           where workspace_id = $1 and id = $2 and status = 'AUTHORIZED_BY_RULE'`,
          [row.workspace_id, row.candidate_id],
        );
        await client.query(
          `insert into recovery_candidate_events (workspace_id, candidate_id, previous_status, status, actor_kind, reason_code)
           values ($1, $2, 'AUTHORIZED_BY_RULE', 'NOTICE_QUEUED', 'SYSTEM', 'notice-revoked')`,
          [row.workspace_id, row.candidate_id],
        );
      }
    }
    if (
      (next.status === "BOUNCED" || next.status === "FAILED" || next.status === "COMPLAINED")
      && current.delivery_status !== next.status
    ) {
      await recordProductEvent({
        workspaceId: row.workspace_id,
        eventName: "notice.failed",
        source: "workspace-api",
        status: "failed",
      }, client);
    }
    await client.query(
      `delete from recovery_notice_pending_events where provider_event_id = $1`,
      [input.providerEventId],
    );
    await client.query("commit");
    return { status: "applied" as const, deliveryStatus: next.status };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function recordNoticeDelivery(input: {
  workspaceId: string;
  candidateId: string;
  providerMessageId: string;
  deliveredAt?: Date;
}) {
  const providerMessageId = input.providerMessageId.trim();
  if (providerMessageId.length < 8) {
    throw new RecoveryServiceError("INVALID_EVIDENCE", "Notice delivery needs a provider message id.");
  }
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    const bound = await client.query(
      `update recovery_veto_notices
       set provider_message_id = coalesce(provider_message_id, $3)
       where workspace_id = $1 and candidate_id = $2
         and (provider_message_id is null or provider_message_id = $3)
       returning provider_message_id`,
      [input.workspaceId, input.candidateId, providerMessageId],
    );
    if (!bound.rows[0]) throw new RecoveryServiceError("CONFLICT", "No queued notice exists for this case.");
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  const result = await applyAutopilotNoticeEvent({
    providerEventId: `delivered:${providerMessageId}:${input.workspaceId}:${input.candidateId}`,
    type: "email.delivered",
    providerMessageId,
    occurredAt: (input.deliveredAt ?? new Date()).toISOString(),
    payloadHash: createHash("sha256").update(`delivered:${providerMessageId}:${input.candidateId}`).digest("hex"),
    workspaceId: input.workspaceId,
    candidateId: input.candidateId,
  });
  if (result.status === "ignored") {
    throw new RecoveryServiceError("CONFLICT", "Only queued notices can be marked delivered.");
  }
  const live = await getDatabasePool().query<{ notice_delivered_at: Date | null; veto_deadline_at: Date | null }>(
    `select notice_delivered_at, veto_deadline_at
     from recovery_action_candidates
     where workspace_id = $1 and id = $2`,
    [input.workspaceId, input.candidateId],
  );
  const deliveredAt = live.rows[0]?.notice_delivered_at;
  const vetoDeadlineAt = live.rows[0]?.veto_deadline_at;
  if (!deliveredAt || !vetoDeadlineAt) {
    throw new RecoveryServiceError("SAVE_FAILED", "Delivered event did not start the 48-hour clock.");
  }
  return { deliveredAt, vetoDeadlineAt, replayed: result.status === "duplicate" };
}

export async function vetoAutopilotCandidateByToken(token: string, now = new Date()) {
  const secret = autopilotVetoTokenSecret();
  if (!secret) throw new RecoveryServiceError("FEATURE_UNAVAILABLE", "Signed veto is not configured.");
  const payload = verifyVetoToken(token, secret, now);
  if (!payload) throw new RecoveryServiceError("FORBIDDEN", "Veto link is invalid or expired.");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    await lockAutopilotShadowGate(client);
    await lockWorkspace(client, payload.workspaceId);
    const notice = await client.query<{ candidate_id: string }>(
      `select candidate_id from recovery_veto_notices
       where workspace_id = $1 and candidate_id = $2 and veto_token_hash = $3`,
      [payload.workspaceId, payload.candidateId, tokenHash],
    );
    if (!notice.rows[0]) throw new RecoveryServiceError("FORBIDDEN", "Veto link does not match a queued notice.");
    const current = await client.query<CandidateRow>(candidateSelect, [payload.workspaceId, payload.candidateId]);
    const row = current.rows[0];
    if (!row) throw new RecoveryServiceError("NOT_FOUND");
    if (row.status === "VETOED") {
      await client.query("commit");
      return { candidate: toCandidateDto(row), replayed: true };
    }
    const updated = await client.query<CandidateRow>(
      `update recovery_action_candidates
       set status = 'VETOED', updated_at = now()
       where workspace_id = $1 and id = $2
         and status in ('SHADOW', 'NOTICE_QUEUED', 'AUTHORIZED_BY_RULE')
       returning ${candidateReturning}`,
      [payload.workspaceId, payload.candidateId],
    );
    const candidate = updated.rows[0];
    if (!candidate) throw new RecoveryServiceError("CONFLICT", "This case can no longer be vetoed.");
    await client.query(
      `insert into recovery_candidate_events (workspace_id, candidate_id, previous_status, status, actor_kind, reason_code)
       values ($1, $2, $3, 'VETOED', 'CUSTOMER', 'signed-veto')`,
      [payload.workspaceId, payload.candidateId, row.status],
    );
    await bumpVersion(client, payload.workspaceId, null, "CANDIDATE");
    await recordProductEvent({
      workspaceId: payload.workspaceId,
      eventName: "candidate.vetoed",
      source: "workspace-api",
      status: "succeeded",
    }, client);
    await client.query("commit");
    return { candidate: toCandidateDto(candidate), replayed: false };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function authorizeSilentCases(now = new Date()) {
  if (!isAutopilotExecutionEnabled()) return { authorized: 0 };
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    await lockAutopilotShadowGate(client);
    const shadow = await measureShadowGateWithClient(client);
    if (!executionMayProceedPastShadowGate(shadow.passed)) {
      await client.query("commit");
      return { authorized: 0 };
    }
    const due = await client.query<{
      id: string;
      workspace_id: string;
      status: string;
      delivery_status: string | null;
      notice_message_id: string | null;
      notice_delivered_at: Date | null;
      veto_deadline_at: Date | null;
    }>(
      `select candidate.id, candidate.workspace_id, candidate.status,
              notice.delivery_status,
              notice.provider_message_id as notice_message_id,
              candidate.notice_delivered_at,
              candidate.veto_deadline_at
       from recovery_action_candidates candidate
       join recovery_standing_mandates mandate
         on mandate.workspace_id = candidate.workspace_id
        and mandate.id = candidate.mandate_id
       join workspaces workspace
         on workspace.id = candidate.workspace_id
       join recovery_veto_notices notice
         on notice.workspace_id = candidate.workspace_id and notice.candidate_id = candidate.id
       join recovery_classification_snapshots snapshot
         on snapshot.id = candidate.classification_snapshot_id
       where candidate.status = 'NOTICE_QUEUED'
         and candidate.eligibility = 'ELIGIBLE'
         and mandate.status = 'ACTIVE'
         and ${standingMandateConsentExistsSql}
         and notice.delivery_status = 'DELIVERED'
         and notice.provider_message_id is not null
         and candidate.notice_delivered_at is not null
         and candidate.veto_deadline_at is not null
         and candidate.veto_deadline_at <= $1
         and ${candidateCitedSourcesCurrentSql}
         and ${candidateClassificationCurrentSql}
       for update of candidate`,
      [now],
    );
    let authorized = 0;
    for (const row of due.rows) {
      const noticeClock = liveNoticeAuthorization({
        deliveryStatus: row.delivery_status,
        noticeDeliveredAt: row.notice_delivered_at,
        vetoDeadlineAt: row.veto_deadline_at,
        noticeMessageId: row.notice_message_id,
      });
      if (!canTransitionCandidate(row.status as CandidateStatus, "AUTHORIZED_BY_RULE", {
        executionEnabled: true,
        noticeDelivered: noticeClock.noticeDelivered,
        noticeEnabled: true,
        now,
        vetoDeadline: noticeClock.vetoDeadline,
        vetoed: false,
        revoked: false,
      })) continue;
      const updated = await client.query(
        `update recovery_action_candidates
         set status = 'AUTHORIZED_BY_RULE', updated_at = $3
         where workspace_id = $1 and id = $2 and status = 'NOTICE_QUEUED'
           and notice_delivered_at is not null
           and veto_deadline_at is not null
           and veto_deadline_at <= $3
           and exists (
             select 1 from recovery_veto_notices notice
             where notice.workspace_id = $1
               and notice.candidate_id = $2
               and notice.delivery_status = 'DELIVERED'
               and notice.provider_message_id is not null
           )`,
        [row.workspace_id, row.id, now],
      );
      if ((updated.rowCount ?? 0) !== 1) continue;
      await client.query(
        `insert into recovery_candidate_events (workspace_id, candidate_id, previous_status, status, actor_kind, reason_code)
         values ($1, $2, 'NOTICE_QUEUED', 'AUTHORIZED_BY_RULE', 'SYSTEM', 'silence-authorized')`,
        [row.workspace_id, row.id],
      );
      await recordProductEvent({
        workspaceId: row.workspace_id,
        eventName: "candidate.authorized",
        source: "workspace-api",
        status: "succeeded",
      }, client);
      authorized += 1;
    }
    await client.query("commit");
    return { authorized };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function recordOperatorExecution(input: {
  workspaceId: string;
  actorUserId: string;
  candidateId: string;
  minutes: number;
  outcome: "EXECUTED" | "EXCEPTION" | "FAILED";
  proofKind?: string;
  proofReference?: string;
  failureReason?: string;
  idempotencyKey: string;
  now?: Date;
}) {
  const idempotencyKey = input.idempotencyKey.trim();
  if (idempotencyKey.length < 8 || idempotencyKey.length > 160) {
    throw new RecoveryServiceError("INVALID_EVIDENCE", "Operator execution needs an Idempotency-Key.");
  }
  const now = input.now ?? new Date();
  const operation = "recovery.operator-execution";
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    await lockAutopilotShadowGate(client);
    await lockWorkspace(client, input.workspaceId);
    await assertRole(client, input.actorUserId, input.workspaceId, "admin");
    const current = await client.query<{
      status: string;
      provider_id: string | null;
      eligibility: string;
      mandate_id: string;
      notice_delivered_at: Date | null;
      veto_deadline_at: Date | null;
      notice_delivery_status: string | null;
      notice_message_id: string | null;
    }>(
      `select candidate.status, candidate.provider_id, candidate.eligibility, candidate.mandate_id,
              candidate.notice_delivered_at, candidate.veto_deadline_at,
              notice.delivery_status as notice_delivery_status,
              notice.provider_message_id as notice_message_id
       from recovery_action_candidates candidate
       left join recovery_veto_notices notice
         on notice.workspace_id = candidate.workspace_id and notice.candidate_id = candidate.id
       where candidate.workspace_id = $1 and candidate.id = $2
       for update of candidate`,
      [input.workspaceId, input.candidateId],
    );
    const row = current.rows[0];
    if (!row) throw new RecoveryServiceError("NOT_FOUND");
    const binding = bindExecutionIdempotency({
      workspaceId: input.workspaceId,
      candidateId: input.candidateId,
      actorUserId: input.actorUserId,
      outcome: input.outcome,
      providerId: row.provider_id ?? "",
      minutes: input.minutes,
      proofKind: input.proofKind ?? null,
      proofReference: input.proofReference ?? null,
      failureReason: input.failureReason ?? null,
    });
    const replay = await readIdempotent<{
      outcome: "EXECUTED" | "EXCEPTION" | "FAILED";
      attemptNo: number;
      operationKey: string;
    }>(client, input.workspaceId, idempotencyKey, operation, binding.requestHash);
    if (replay) {
      await client.query("commit");
      return { ...replay.response, replayed: true as const };
    }
    const candidateTruth = await client.query<{ cited_current: boolean; classification_current: boolean }>(
      `select ${candidateCitedSourcesCurrentSql} as cited_current,
              ${candidateClassificationCurrentSql} as classification_current
       from recovery_action_candidates candidate
       join recovery_classification_snapshots snapshot
         on snapshot.id = candidate.classification_snapshot_id
       where candidate.workspace_id = $1 and candidate.id = $2`,
      [input.workspaceId, input.candidateId],
    );
    if (input.outcome !== "EXCEPTION" && candidateTruth.rows[0]?.cited_current !== true) {
      throw new RecoveryServiceError("FORBIDDEN", "Execution blocked: SOURCE_DISCONNECTED.");
    }
    if (input.outcome !== "EXCEPTION" && candidateTruth.rows[0]?.classification_current !== true) {
      throw new RecoveryServiceError("FORBIDDEN", "Execution blocked: CLASSIFICATION_STALE.");
    }
    if (input.outcome !== "EXCEPTION" && (row.status === "SHADOW" || row.status === "NOTICE_QUEUED")) {
      throw new RecoveryServiceError("FORBIDDEN", "Execution blocked: STATUS_NOT_AUTHORIZED.");
    }
    const mandate = await client.query<{ status: string; consent_current: boolean }>(
      `select mandate.status, ${standingMandateConsentExistsSql} as consent_current
       from recovery_standing_mandates mandate
       join workspaces workspace on workspace.id = mandate.workspace_id
       where mandate.workspace_id = $1 and mandate.id = $2`,
      [input.workspaceId, row.mandate_id],
    );
    const disabled = row.provider_id
      ? await client.query<{ disabled: boolean }>(
        `select disabled from recovery_provider_disables where provider_id = $1`,
        [row.provider_id],
      )
      : { rows: [] as Array<{ disabled: boolean }> };
    const catalog = row.provider_id ? lookupCatalogProviderById(row.provider_id) : null;
    const executable = row.provider_id ? lookupSupportedProviderById(row.provider_id) : null;
    const noticeClock = liveNoticeAuthorization({
      deliveryStatus: row.notice_delivery_status,
      noticeDeliveredAt: row.notice_delivered_at,
      vetoDeadlineAt: row.veto_deadline_at,
      noticeMessageId: row.notice_message_id,
    });
    const shadow = await measureShadowGateWithClient(client);
    const blocked = executionBlockReason({
      executionEnabled: isAutopilotExecutionEnabled(),
      shadowGatePassed: executionMayProceedPastShadowGate(shadow.passed),
      mandateActive: mandate.rows[0]?.status === "ACTIVE" && mandate.rows[0]?.consent_current === true,
      eligibility: row.eligibility as "ELIGIBLE" | "INELIGIBLE" | "PROTECTED" | "UNSUPPORTED_ROUTE",
      status: row.status as CandidateStatus,
      noticeDelivered: noticeClock.noticeDelivered,
      vetoDeadline: noticeClock.vetoDeadline,
      now,
      vetoed: row.status === "VETOED",
      revoked: mandate.rows[0]?.status === "REVOKED" || row.status === "REVOKED",
      providerExecutable: Boolean(executable),
      providerDisabled: disabled.rows[0]?.disabled === true,
      outcome: input.outcome,
    });
    if (blocked) {
      throw new RecoveryServiceError("FORBIDDEN", `Execution blocked: ${blocked}.`);
    }
    if (input.outcome === "EXECUTED" && (!input.proofKind || !input.proofReference)) {
      throw new RecoveryServiceError("INVALID_EVIDENCE", "Executed cases need merchant confirmation proof.");
    }
    const provider = input.outcome === "EXCEPTION"
      ? (executable ?? catalog ?? { id: row.provider_id ?? "unsupported", cancellationRoute: "UNKNOWN" as const })
      : (executable ?? catalog);
    if (!provider) throw new RecoveryServiceError("FORBIDDEN", "Unknown providers cannot be executed.");
    const providerId = row.provider_id ?? (input.outcome === "EXCEPTION" ? "unsupported" : null);
    if (!providerId) throw new RecoveryServiceError("FORBIDDEN", "Unknown providers cannot be executed.");
    const latestAttempt = await client.query<{ attempt_no: number }>(
      `select coalesce(max(attempt_no), 0)::int as attempt_no
       from recovery_execution_attempts
       where workspace_id = $1 and candidate_id = $2`,
      [input.workspaceId, input.candidateId],
    );
    const attemptNo = Number(latestAttempt.rows[0]?.attempt_no ?? 0) + 1;
    const operationKey = executionOperationKey({ candidateId: input.candidateId, attemptNo });
    const proofHash = input.proofReference
      ? createHash("sha256").update(input.proofReference).digest("hex")
      : null;
    try {
      await client.query(
        `insert into recovery_execution_attempts (
           workspace_id, candidate_id, attempt_no, operation_key, idempotency_key, request_hash,
           actor_user_id, provider_id, outcome, status, proof_kind, proof_reference_hash,
           failure_reason, operator_minutes
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'AUTHORIZED', $10, $11, $12, $13)`,
        [
          input.workspaceId,
          input.candidateId,
          attemptNo,
          operationKey,
          idempotencyKey,
          binding.requestHash,
          input.actorUserId,
          providerId,
          input.outcome,
          input.proofKind ?? null,
          proofHash,
          input.failureReason ?? null,
          input.minutes,
        ],
      );
    } catch (error) {
      if (pgCode(error) !== "23505") throw error;
      const existing = await client.query<{
        status: string;
        request_hash: string;
        attempt_no: number;
        outcome: "EXECUTED" | "EXCEPTION" | "FAILED" | null;
      }>(
        `select status, request_hash, attempt_no, outcome
         from recovery_execution_attempts
         where operation_key = $1`,
        [operationKey],
      );
      const prior = existing.rows[0];
      if (prior && resolveExecutionReplay(prior.request_hash, binding.requestHash) === "REPLAY" && prior.status === "RECORDED") {
        const recorded = { outcome: prior.outcome ?? input.outcome, attemptNo: prior.attempt_no, operationKey };
        await client.query("commit");
        return { ...recorded, replayed: true as const };
      }
      throw new RecoveryServiceError("CONFLICT", "Idempotency-Key was already used for a different Recovery request.");
    }
    await recordProductEvent({
      workspaceId: input.workspaceId,
      userId: input.actorUserId,
      eventName: "execution.started",
      source: "workspace-api",
      status: "started",
    }, client);
    const reread = await client.query<{
      status: string;
      provider_id: string | null;
      eligibility: string;
      mandate_id: string;
      notice_delivered_at: Date | null;
      veto_deadline_at: Date | null;
      notice_delivery_status: string | null;
      notice_message_id: string | null;
    }>(
      `select candidate.status, candidate.provider_id, candidate.eligibility, candidate.mandate_id,
              candidate.notice_delivered_at, candidate.veto_deadline_at,
              notice.delivery_status as notice_delivery_status,
              notice.provider_message_id as notice_message_id
       from recovery_action_candidates candidate
       left join recovery_veto_notices notice
         on notice.workspace_id = candidate.workspace_id and notice.candidate_id = candidate.id
       where candidate.workspace_id = $1 and candidate.id = $2
       for update of candidate`,
      [input.workspaceId, input.candidateId],
    );
    const live = reread.rows[0];
    if (!live) throw new RecoveryServiceError("NOT_FOUND");
    const liveMandate = await client.query<{ status: string; consent_current: boolean }>(
      `select mandate.status, ${standingMandateConsentExistsSql} as consent_current
       from recovery_standing_mandates mandate
       join workspaces workspace on workspace.id = mandate.workspace_id
       where mandate.workspace_id = $1 and mandate.id = $2`,
      [input.workspaceId, live.mandate_id],
    );
    const liveDisabled = live.provider_id
      ? await client.query<{ disabled: boolean }>(
        `select disabled from recovery_provider_disables where provider_id = $1`,
        [live.provider_id],
      )
      : { rows: [] as Array<{ disabled: boolean }> };
    const liveExecutable = live.provider_id ? lookupSupportedProviderById(live.provider_id) : null;
    const liveNotice = liveNoticeAuthorization({
      deliveryStatus: live.notice_delivery_status,
      noticeDeliveredAt: live.notice_delivered_at,
      vetoDeadlineAt: live.veto_deadline_at,
      noticeMessageId: live.notice_message_id,
    });
    const liveBlocked = executionBlockReason({
      executionEnabled: isAutopilotExecutionEnabled(),
      shadowGatePassed: executionMayProceedPastShadowGate((await measureShadowGateWithClient(client)).passed),
      mandateActive: liveMandate.rows[0]?.status === "ACTIVE" && liveMandate.rows[0]?.consent_current === true,
      eligibility: live.eligibility as "ELIGIBLE" | "INELIGIBLE" | "PROTECTED" | "UNSUPPORTED_ROUTE",
      status: live.status as CandidateStatus,
      noticeDelivered: liveNotice.noticeDelivered,
      vetoDeadline: liveNotice.vetoDeadline,
      now,
      vetoed: live.status === "VETOED",
      revoked: liveMandate.rows[0]?.status === "REVOKED" || live.status === "REVOKED",
      providerExecutable: Boolean(liveExecutable),
      providerDisabled: liveDisabled.rows[0]?.disabled === true,
      outcome: input.outcome,
    });
    if (liveBlocked) {
      await client.query(
        `update recovery_execution_attempts
         set status = 'FAILED', failure_reason = $2
         where operation_key = $1`,
        [operationKey, `Execution blocked: ${liveBlocked}.`],
      );
      throw new RecoveryServiceError("FORBIDDEN", `Execution blocked: ${liveBlocked}.`);
    }
    await client.query(
      `update recovery_execution_attempts set status = 'PROVIDER_CALLED' where operation_key = $1`,
      [operationKey],
    );
    let fromStatus = row.status as CandidateStatus;
    if (input.outcome !== "EXCEPTION" && fromStatus === "AUTHORIZED_BY_RULE") {
      await client.query(
        `update recovery_action_candidates set status = 'IN_PROGRESS', updated_at = now()
         where workspace_id = $1 and id = $2`,
        [input.workspaceId, input.candidateId],
      );
      fromStatus = "IN_PROGRESS";
    }
    const nextStatus = input.outcome === "EXECUTED" ? "EXECUTED" : input.outcome === "EXCEPTION" ? "EXCEPTION" : "FAILED";
    const attemptId = await client.query<{ id: string }>(
      `select id from recovery_execution_attempts where operation_key = $1`,
      [operationKey],
    );
    await client.query(
      `insert into recovery_executions (
         workspace_id, candidate_id, provider_id, route, actor_kind, actor_user_id,
         operator_minutes, outcome, proof_kind, proof_reference, failure_reason,
         attempt_id, attempt_no, operation_key
       ) values ($1, $2, $3, $4, 'OPERATOR', $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        input.workspaceId,
        input.candidateId,
        providerId,
        provider.cancellationRoute,
        input.actorUserId,
        input.minutes,
        input.outcome,
        input.proofKind ?? null,
        input.proofReference ?? null,
        input.failureReason ?? null,
        attemptId.rows[0]?.id ?? null,
        attemptNo,
        operationKey,
      ],
    );
    await client.query(
      `update recovery_execution_attempts set status = 'RECORDED' where operation_key = $1`,
      [operationKey],
    );
    await client.query(
      `insert into recovery_operator_actions (workspace_id, candidate_id, actor_user_id, minutes, outcome, failure_reason)
       values ($1, $2, $3, $4, $5, $6)`,
      [input.workspaceId, input.candidateId, input.actorUserId, input.minutes, input.outcome, input.failureReason ?? null],
    );
    await client.query(
      `update recovery_action_candidates set status = $3, exception_code = $4, updated_at = now()
       where workspace_id = $1 and id = $2`,
      [input.workspaceId, input.candidateId, nextStatus, input.outcome === "EXCEPTION" ? honestExceptionCode(input.failureReason) : null],
    );
    await client.query(
      `insert into recovery_candidate_events (workspace_id, candidate_id, previous_status, status, actor_kind, actor_user_id, reason_code)
       values ($1, $2, $3, $4, 'OPERATOR', $5, $6)`,
      [input.workspaceId, input.candidateId, fromStatus, nextStatus, input.actorUserId, input.outcome],
    );
    await recordProductEvent({
      workspaceId: input.workspaceId,
      userId: input.actorUserId,
      eventName: input.outcome === "EXECUTED"
        ? "execution.completed"
        : input.outcome === "FAILED"
          ? "execution.failed"
          : "exception.opened",
      source: "workspace-api",
      status: input.outcome === "FAILED" ? "failed" : "succeeded",
    }, client);
    const response = { outcome: input.outcome, attemptNo, operationKey };
    await writeIdempotent(client, input.workspaceId, idempotencyKey, operation, binding.requestHash, response, await readVersion(client, input.workspaceId));
    await client.query("commit");
    return { ...response, replayed: false as const };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw mapAutopilotError(error);
  } finally {
    client.release();
  }
}

export async function listExecutionAttempts(input: { workspaceId: string; actorUserId: string; candidateId: string }) {
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin isolation level repeatable read read only");
    await assertRole(client, input.actorUserId, input.workspaceId, "admin");
    const attempts = await client.query<{
      attempt_no: number;
      operation_key: string;
      status: string;
      outcome: string | null;
      operator_minutes: string | null;
      proof_kind: string | null;
      failure_reason: string | null;
      created_at: Date;
    }>(
      `select attempt_no, operation_key, status, outcome, operator_minutes::text, proof_kind,
              failure_reason, created_at
       from recovery_execution_attempts
       where workspace_id = $1 and candidate_id = $2
       order by attempt_no asc`,
      [input.workspaceId, input.candidateId],
    );
    const workspaceVersion = await readVersion(client, input.workspaceId);
    await client.query("commit");
    return {
      workspaceVersion,
      items: attempts.rows.map((row) => ({
        attemptNo: row.attempt_no,
        operationKey: row.operation_key,
        status: row.status,
        outcome: row.outcome,
        operatorMinutes: row.operator_minutes,
        proofKind: row.proof_kind,
        failureReason: row.failure_reason,
        createdAt: row.created_at.toISOString(),
      })),
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function disableProviderEmergency(input: {
  providerId: string;
  reason: string;
  actorUserId?: string | null;
}) {
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    await lockAutopilotShadowGate(client);
    const catalog = lookupCatalogProviderById(input.providerId);
    if (!catalog) throw new RecoveryServiceError("NOT_FOUND", "Unknown provider.");
    await client.query(
      `insert into recovery_provider_disables (provider_id, disabled, reason)
       values ($1, true, $2)
       on conflict (provider_id) do update set disabled = true, reason = excluded.reason, updated_at = now()`,
      [catalog.id, input.reason.slice(0, 240)],
    );
    await client.query(
      `insert into audit_log (workspace_id, user_id, action, entity_type, metadata)
       values (null, $1, 'autopilot.provider.disabled', 'recovery_provider', jsonb_build_object('providerId', $2::text))`,
      [input.actorUserId ?? null, catalog.id],
    );
    await client.query("commit");
    return { providerId: catalog.id, disabled: true as const };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function listAutopilotDeadLetters(input: { workspaceId: string; actorUserId: string }) {
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin isolation level repeatable read read only");
    await assertRole(client, input.actorUserId, input.workspaceId, "admin");
    const rows = await client.query<{
      id: string;
      kind: "NOTICE" | "EXECUTION" | "WEBHOOK" | "INVOICE";
      candidate_id: string | null;
      last_error_code: string;
      attempt_count: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `select id::text, kind, candidate_id::text, last_error_code, attempt_count, created_at, updated_at
       from recovery_autopilot_dead_letters
       where workspace_id = $1
       order by created_at desc
       limit 50`,
      [input.workspaceId],
    );
    const workspaceVersion = await readVersion(client, input.workspaceId);
    await client.query("commit");
    return {
      workspaceVersion,
      items: rows.rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        candidateId: row.candidate_id,
        lastErrorCode: row.last_error_code,
        attemptCount: row.attempt_count,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      })),
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function replayAutopilotDeadLetter(input: {
  workspaceId: string;
  actorUserId: string;
  deadLetterId: string;
}) {
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    await assertRole(client, input.actorUserId, input.workspaceId, "admin");
    const row = await client.query<{
      id: string;
      kind: string;
      workspace_id: string | null;
      candidate_id: string | null;
    }>(
      `select id::text, kind, workspace_id::text, candidate_id::text
       from recovery_autopilot_dead_letters
       where id = $1
         and workspace_id = $2
       for update`,
      [input.deadLetterId, input.workspaceId],
    );
    const dead = row.rows[0];
    if (!dead) throw new RecoveryServiceError("NOT_FOUND");
    if (dead.kind !== "NOTICE") {
      const workspaceVersion = await readVersion(client, input.workspaceId);
      await client.query("commit");
      return { id: dead.id, replayed: false, reason: "KIND_NOT_REPLAYABLE", workspaceVersion };
    }
    await client.query(
      `update recovery_autopilot_dead_letters
       set attempt_count = attempt_count + 1, updated_at = now()
       where id = $1`,
      [dead.id],
    );
    await client.query(
      `insert into audit_log (workspace_id, user_id, action, entity_type, metadata)
       values ($1, $2, 'autopilot.dead-letter.replayed', 'recovery_dead_letter', jsonb_build_object('kind', $3::text))`,
      [input.workspaceId, input.actorUserId, dead.kind],
    );
    const workspaceVersion = await readVersion(client, input.workspaceId);
    await client.query("commit");
    await sendQueuedAutopilotNotices(new Date(), {
      workspaceId: input.workspaceId,
      candidateId: dead.candidate_id ?? undefined,
    });
    return { id: dead.id, replayed: true, workspaceVersion };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function readAutopilotOpsMetrics() {
  const pool = getDatabasePool();
  const result = await pool.query<{
    oldest_queued_notice_seconds: string | null;
    notices_failed_24h: string;
    notices_delivered_24h: string;
    pending_verifications: string;
    dead_letters: string;
    protected_leakage: string;
  }>(
    `select
       (select extract(epoch from (now() - min(created_at)))::int::text
        from recovery_veto_notices where delivery_status = 'QUEUED') as oldest_queued_notice_seconds,
       (select count(*)::text from recovery_veto_notices
        where delivery_status in ('BOUNCED', 'FAILED', 'COMPLAINED') and created_at >= now() - interval '24 hours') as notices_failed_24h,
       (select count(*)::text from recovery_veto_notices
        where delivery_status = 'DELIVERED' and delivered_at >= now() - interval '24 hours') as notices_delivered_24h,
       (select count(*)::text from recovery_covered_windows
        where status in ('PENDING', 'MISSING_COVERAGE')) as pending_verifications,
       (select count(*)::text from recovery_autopilot_dead_letters) as dead_letters,
       (select coalesce((select protected_leakage::text from recovery_shadow_gate_snapshots order by measured_at desc limit 1), '0')) as protected_leakage`,
  );
  const row = result.rows[0];
  return {
    oldestQueuedNoticeSeconds: row?.oldest_queued_notice_seconds == null ? null : Number(row.oldest_queued_notice_seconds),
    noticesFailed24h: Number(row?.notices_failed_24h ?? 0),
    noticesDelivered24h: Number(row?.notices_delivered_24h ?? 0),
    pendingVerifications: Number(row?.pending_verifications ?? 0),
    deadLetters: Number(row?.dead_letters ?? 0),
    protectedLeakage: Number(row?.protected_leakage ?? 0),
  };
}

export async function verifyCoveredWindow(input: {
  workspaceId: string;
  candidateId: string;
  expectedDebitDate?: string;
}) {
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`recovery:${input.workspaceId}`]);
    const candidate = await client.query<{
      commitment_id: string;
      currency: string;
      amount_minor: string;
      next_expected_date: string | null;
      next_debit_date: string | null;
      workspace_id: string;
    }>(
      `select candidate.commitment_id, candidate.currency, candidate.amount_minor::text,
              commitment.effective_next_expected_date::text as next_expected_date,
              candidate.next_debit_date::text as next_debit_date,
              candidate.workspace_id::text
       from recovery_action_candidates candidate
       join recovery_commitments commitment
         on commitment.workspace_id = candidate.workspace_id and commitment.id = candidate.commitment_id
       where candidate.workspace_id = $1 and candidate.id = $2
       for update of candidate`,
      [input.workspaceId, input.candidateId],
    );
    const row = candidate.rows[0];
    if (!row) throw new RecoveryServiceError("NOT_FOUND");
    const persisted = row.next_debit_date;
    if (persisted && input.expectedDebitDate && input.expectedDebitDate !== persisted) {
      // Caller-supplied dates cannot override persisted derivation.
    }
    const expectedDebitDate = persisted ?? row.next_expected_date;
    if (!expectedDebitDate) throw new RecoveryServiceError("INVALID_EVIDENCE", "Covered windows need a cited expected debit date.");
    const sources = await client.query<{
      source_id: string;
      source_workspace_id: string;
      source_type: "RECEIPT_PASTE" | "CSV_IMPORT" | "FORWARDED_EMAIL" | "GMAIL_OAUTH";
      coverage_start: string | null;
      coverage_end: string | null;
    }>(
      `select source.id::text as source_id, source.workspace_id::text as source_workspace_id,
              source.source_type, source.coverage_start::text, source.coverage_end::text
       from recovery_commitment_evidence link
       join recovery_evidence evidence
         on evidence.workspace_id = link.workspace_id and evidence.id = link.evidence_id
       join recovery_sources source
         on source.workspace_id = evidence.workspace_id and source.id = evidence.source_id
       where link.workspace_id = $1 and link.commitment_id = $2
       order by source.coverage_end desc nulls last`,
      [input.workspaceId, row.commitment_id],
    );
    const covering = sources.rows.find((source) => {
      if (!source.coverage_start || !source.coverage_end) return false;
      if (source.source_workspace_id !== input.workspaceId) return false;
      const window = debitObservationWindow(expectedDebitDate);
      return source.coverage_start <= window.start && window.end <= source.coverage_end;
    }) ?? sources.rows[0] ?? null;
    const observed = await client.query<{
      evidence_id: string;
      evidence_date: string;
      amount_minor: string;
      currency: string;
      provenance_kind: string;
    }>(
      `select evidence.id::text as evidence_id, evidence.evidence_date::text, evidence.amount_minor::text, evidence.currency,
              evidence.provenance_kind
       from recovery_commitment_evidence link
       join recovery_evidence evidence
         on evidence.workspace_id = link.workspace_id and evidence.id = link.evidence_id
       where link.workspace_id = $1 and link.commitment_id = $2
         and evidence.evidence_date is not null
         and evidence.amount_minor is not null
         and (evidence.direction is null or evidence.direction = 'debit')`,
      [input.workspaceId, row.commitment_id],
    );
    const result = evaluateCoveredWindowProof({
      workspaceId: input.workspaceId,
      candidateWorkspaceId: row.workspace_id,
      commitmentId: row.commitment_id,
      candidateCommitmentId: row.commitment_id,
      currency: row.currency,
      candidateCurrency: row.currency,
      sourceKind: covering?.source_type ?? "UNRELATED",
      sourceWorkspaceId: covering?.source_workspace_id ?? "00000000-0000-0000-0000-000000000000",
      sourceRegulated: false,
      coverageStart: covering?.coverage_start ?? null,
      coverageEnd: covering?.coverage_end ?? null,
      expectedDebitDate,
      baselineDebitMinor: BigInt(row.amount_minor),
      historicalDebits: observed.rows
        .filter((item) => item.evidence_date < expectedDebitDate)
        .map((item) => ({
          date: item.evidence_date,
          amountMinor: BigInt(item.amount_minor),
          currency: item.currency,
          corrected: item.provenance_kind === "CORRECTION",
          evidenceId: item.evidence_id,
        })),
      observedDebits: observed.rows.map((item) => ({
        date: item.evidence_date,
        amountMinor: BigInt(item.amount_minor),
        currency: item.currency,
        corrected: item.provenance_kind === "CORRECTION",
        evidenceId: item.evidence_id,
      })),
    });
    const inputsHash = createHash("sha256").update(JSON.stringify({
      workspaceId: input.workspaceId,
      candidateId: input.candidateId,
      commitmentId: row.commitment_id,
      expectedDebitDate,
      baseline: row.amount_minor,
      observed: observed.rows.map((item) => `${item.evidence_date}:${item.amount_minor}:${item.currency}`).sort(),
      coverage: covering ? [covering.source_id, covering.coverage_start, covering.coverage_end] : [],
    })).digest("hex");
    await client.query(
      `insert into recovery_covered_windows (
         workspace_id, candidate_id, coverage_source_id, window_start, window_end,
         expected_debit_date, baseline_debit_minor, observed_debit_minor, saving_minor, status, currency,
         inputs_hash, commitment_id
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       on conflict (workspace_id, candidate_id, expected_debit_date)
       do update set coverage_source_id = excluded.coverage_source_id,
                     window_start = excluded.window_start,
                     window_end = excluded.window_end,
                     observed_debit_minor = excluded.observed_debit_minor,
                     saving_minor = excluded.saving_minor,
                     status = excluded.status,
                     currency = excluded.currency,
                     inputs_hash = excluded.inputs_hash,
                     commitment_id = excluded.commitment_id`,
      [
        input.workspaceId,
        input.candidateId,
        covering?.source_id ?? null,
        covering?.coverage_start ?? expectedDebitDate,
        covering?.coverage_end ?? expectedDebitDate,
        expectedDebitDate,
        row.amount_minor,
        covering && (result.status === "COVERED_CLEAN" || result.status === "NOT_ELIMINATED")
          ? (BigInt(row.amount_minor) - (result.savingMinor ?? BigInt(0))).toString()
          : null,
        result.savingMinor?.toString() ?? null,
        result.status,
        row.currency,
        inputsHash,
        row.commitment_id,
      ],
    );
    if (result.status === "COVERED_CLEAN") {
      await client.query(
        `update recovery_action_candidates set status = 'VERIFIED', updated_at = now()
         where workspace_id = $1 and id = $2 and status in ('EXECUTED', 'VERIFYING')`,
        [input.workspaceId, input.candidateId],
      );
      await recordProductEvent({
        workspaceId: input.workspaceId,
        eventName: "window.verified",
        source: "workspace-api",
        status: "succeeded",
      }, client);
    } else {
      await recordProductEvent({
        workspaceId: input.workspaceId,
        eventName: "verification.pending",
        source: "workspace-api",
        status: "partial",
      }, client);
    }
    await client.query("commit");
    return { ...result, currency: row.currency, expectedDebitDate };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function invoiceWorkspacePeriod(input: {
  workspaceId: string;
  periodStart: string;
  periodEnd: string;
  currency?: string;
}) {
  if (input.periodEnd < input.periodStart) {
    throw new RecoveryServiceError("INVALID_EVIDENCE", "Fee periods must start on or before they end.");
  }
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    await lockWorkspace(client, input.workspaceId);
    const currencies = await client.query<{ currency: string }>(
      `select distinct currency from recovery_covered_windows
       where workspace_id = $1 and status = 'COVERED_CLEAN'
         and expected_debit_date >= $2 and expected_debit_date <= $3`,
      [input.workspaceId, input.periodStart, input.periodEnd],
    );
    const requestedCurrency = input.currency?.trim().toUpperCase() || null;
    const currency = requestedCurrency ?? (currencies.rows.length === 1 ? currencies.rows[0]?.currency : null);
    if (!currency) {
      throw new RecoveryServiceError("INVALID_EVIDENCE", "Fee invoices require an explicit currency.");
    }
    if (currency !== "INR") {
      throw new RecoveryServiceError("INVALID_EVIDENCE", "Fee invoices support INR pricing only until a cross-currency credit policy is approved.");
    }
    if (!requestedCurrency && currencies.rows.some((row) => row.currency !== currency)) {
      throw new RecoveryServiceError("INVALID_EVIDENCE", "Fee invoices cannot mix currencies.");
    }
    await client.query(
      "select pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`fee:${input.workspaceId}:${currency}`],
    );
    const existingAnchor = await client.query<{ anchor_date: string }>(
      `select anchor_date::text from recovery_billing_year_anchors where workspace_id = $1`,
      [input.workspaceId],
    );
    let anchorDate = existingAnchor.rows[0]?.anchor_date ?? null;
    if (!anchorDate) {
      const insertedAnchor = await client.query<{ anchor_date: string }>(
        `insert into recovery_billing_year_anchors (workspace_id, anchor_date)
         select $1, coalesce(
           (select min(signed_at)::date from recovery_standing_mandates where workspace_id = $1),
           $2::date
         )
         on conflict (workspace_id) do nothing
         returning anchor_date::text`,
        [input.workspaceId, input.periodStart],
      );
      anchorDate = insertedAnchor.rows[0]?.anchor_date
        ?? (await client.query<{ anchor_date: string }>(
          `select anchor_date::text from recovery_billing_year_anchors where workspace_id = $1`,
          [input.workspaceId],
        )).rows[0]?.anchor_date
        ?? input.periodStart;
    }
    if (feePeriodCrossesBillingAnniversary(anchorDate, input.periodStart, input.periodEnd)) {
      throw new RecoveryServiceError("INVALID_EVIDENCE", "Fee periods cannot cross the customer billing anniversary.");
    }
    const yearStart = billingYearStart(anchorDate, input.periodStart);
    const windows = await client.query<{ id: string; saving_minor: string }>(
      `select id::text, saving_minor::text
       from recovery_covered_windows
       where workspace_id = $1 and status = 'COVERED_CLEAN' and currency = $2
         and expected_debit_date >= $3 and expected_debit_date <= $4
       order by id`,
      [input.workspaceId, currency, input.periodStart, input.periodEnd],
    );
    const periodSaving = windows.rows.reduce((sum, row) => sum + BigInt(row.saving_minor ?? "0"), BigInt(0));
    const inputsHash = createHash("sha256").update(JSON.stringify({
      workspaceId: input.workspaceId,
      currency,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      yearStart,
      windows: windows.rows.map((row) => [row.id, row.saving_minor]),
      monitoringMinor: monitoringFeeMinor.toString(),
    })).digest("hex");
    const existing = await client.query<{
      inputs_hash: string;
      retained_minor: string;
      monitoring_minor: string;
      verified_saving_minor: string;
      outcome_fee_minor: string;
      refund_credit_minor: string;
      additional_charge_minor: string;
    }>(
      `select inputs_hash, retained_minor::text, monitoring_minor::text, verified_saving_minor::text,
              outcome_fee_minor::text, refund_credit_minor::text, additional_charge_minor::text
       from recovery_fee_ledger
       where workspace_id = $1 and currency = $2 and period_start = $3::date and period_end = $4::date`,
      [input.workspaceId, currency, input.periodStart, input.periodEnd],
    );
    if (existing.rows[0]) {
      if (invoiceReplayDecision({
        existing: { inputsHash: existing.rows[0].inputs_hash, retainedMinor: BigInt(existing.rows[0].retained_minor) },
        incomingInputsHash: inputsHash,
      }) === "CONFLICT") {
        throw new RecoveryServiceError("CONFLICT", "Finalized fee ledger rows cannot be mutated.");
      }
      await client.query("commit");
      const row = existing.rows[0];
      return {
        monitoringMinor: BigInt(row.monitoring_minor),
        verifiedSavingMinor: BigInt(row.verified_saving_minor),
        outcomeFeeMinor: BigInt(row.outcome_fee_minor),
        retainedMinor: BigInt(row.retained_minor),
        refundCreditMinor: BigInt(row.refund_credit_minor),
        additionalChargeMinor: BigInt(row.additional_charge_minor),
        currency,
        replayed: true,
      };
    }
    const prior = await client.query<{
      monitoring_minor: string;
      verified_saving_minor: string;
    }>(
      `select monitoring_minor::text, verified_saving_minor::text
       from recovery_fee_ledger
       where workspace_id = $1 and currency = $2 and year_start = $3::date
       order by period_start asc, period_end asc`,
      [input.workspaceId, currency, yearStart],
    );
    const periods = [
      ...prior.rows.map((row) => ({
        monitoringMinor: BigInt(row.monitoring_minor),
        verifiedSavingMinor: BigInt(row.verified_saving_minor),
      })),
      { monitoringMinor: monitoringFeeMinor, verifiedSavingMinor: periodSaving },
    ];
    const charge = computeCumulativeFirstYearCharge({ periods });
    const priorCharge = prior.rows.length
      ? computeCumulativeFirstYearCharge({ periods: periods.slice(0, -1) })
      : computeFirstYearCharge(BigInt(0), BigInt(0));
    const outcomeFeeMinor = charge.outcomeFeeMinor > priorCharge.outcomeFeeMinor
      ? charge.outcomeFeeMinor - priorCharge.outcomeFeeMinor
      : BigInt(0);
    const retainedMinor = charge.thisPeriodRetainedMinor;
    const refundCreditMinor = monitoringFeeMinor > retainedMinor ? monitoringFeeMinor - retainedMinor : BigInt(0);
    const additionalChargeMinor = retainedMinor > monitoringFeeMinor ? retainedMinor - monitoringFeeMinor : BigInt(0);
    try {
      await client.query(
        `insert into recovery_fee_ledger (
           workspace_id, period_start, period_end, currency, monitoring_minor, verified_saving_minor,
           outcome_fee_minor, retained_minor, refund_credit_minor, additional_charge_minor,
           razorpay_charge_status, inputs_hash, year_start
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'FAIL_CLOSED', $11, $12)`,
        [
          input.workspaceId,
          input.periodStart,
          input.periodEnd,
          currency,
          monitoringFeeMinor.toString(),
          periodSaving.toString(),
          outcomeFeeMinor.toString(),
          retainedMinor.toString(),
          refundCreditMinor.toString(),
          additionalChargeMinor.toString(),
          inputsHash,
          yearStart,
        ],
      );
    } catch (error) {
      if (pgCode(error) === "23P01" || pgCode(error) === "23505") {
        throw new RecoveryServiceError("CONFLICT", "Fee periods cannot overlap for the same currency.");
      }
      throw error;
    }
    await recordProductEvent({
      workspaceId: input.workspaceId,
      eventName: "invoice.created",
      source: "workspace-api",
      status: "succeeded",
    }, client);
    await client.query("commit");
    return {
      monitoringMinor: monitoringFeeMinor,
      verifiedSavingMinor: periodSaving,
      outcomeFeeMinor,
      retainedMinor,
      refundCreditMinor,
      additionalChargeMinor,
      currency,
      replayed: false,
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw mapAutopilotError(error);
  } finally {
    client.release();
  }
}

export async function measureShadowGate(): Promise<ShadowGateSnapshot & { snapshotHash: string }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const client = await getDatabasePool().connect();
    try {
      await client.query("begin isolation level serializable");
      await lockAutopilotShadowGate(client);
      const snapshot = await measureShadowGateWithClient(client);
      await client.query(
        `insert into recovery_shadow_gate_snapshots (
           connected_mandates, eligible_candidates, protected_leakage, passed, evidence, snapshot_hash
         ) values ($1, $2, $3, $4, $5::jsonb, $6)`,
        [
          snapshot.connectedMandates,
          snapshot.eligibleCandidates,
          snapshot.protectedLeakage,
          snapshot.passed,
          JSON.stringify({
            failReasons: [
              ...(snapshot.connectedMandates < 10 ? ["CONNECTED_MANDATES"] : []),
              ...(snapshot.eligibleCandidates < 5 ? ["ELIGIBLE_CANDIDATES"] : []),
              ...(snapshot.protectedLeakage > 0 ? ["PROTECTED_LEAKAGE"] : []),
            ],
            connectedMandates: snapshot.connectedMandates,
            eligibleCandidates: snapshot.eligibleCandidates,
            protectedLeakage: snapshot.protectedLeakage,
          }),
          snapshot.snapshotHash,
        ],
      );
      await client.query("commit");
      return snapshot;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      const code = pgCode(error);
      if (code === "40001" || code === "40P01") {
        lastError = error;
        continue;
      }
      throw error;
    } finally {
      client.release();
    }
  }
  throw lastError instanceof Error ? lastError : new RecoveryServiceError("SAVE_FAILED", "Shadow gate could not be measured under concurrency.");
}

async function measureShadowGateWithClient(client: PoolClient): Promise<ShadowGateSnapshot & { snapshotHash: string }> {
  const connected = await client.query<{ workspace_id: string }>(
    `select mandate.workspace_id
     from recovery_standing_mandates mandate
     join workspaces workspace on workspace.id = mandate.workspace_id
     join users owner on owner.id = workspace.owner_user_id and owner.deleted_at is null
     join workspace_members membership
       on membership.workspace_id = workspace.id
      and membership.user_id = workspace.owner_user_id
      and membership.role = 'owner'
     join recovery_workspace_states state on state.workspace_id = mandate.workspace_id
     where mandate.status = 'ACTIVE'
       and ${currentlyConnectedSourceSql}
       and ${standingMandateConsentExistsSql}
     group by mandate.workspace_id`,
  );
  const candidates = await client.query<{
    id: string;
    workspace_id: string;
    eligibility: "ELIGIBLE" | "INELIGIBLE" | "PROTECTED" | "UNSUPPORTED_ROUTE";
    status: string;
    commitment_class: string;
    cited_category: string;
    cited_merchant: string | null;
    protected_override: boolean;
    snapshot_id: string;
    latest_snapshot_id: string;
    evidence_count: string;
    live_evidence_count: string;
    cited_categories: string[];
    evidence_ids: string[];
    amount_minor: string;
    cadence: string | null;
    next_debit_date: string | null;
    confidence_score: string | null;
    provider_id: string | null;
    mandate_status: string;
    provider_disabled: boolean;
    source_connected: boolean;
    consent_current: boolean;
  }>(
    `select candidate.id, candidate.workspace_id, candidate.eligibility, candidate.status,
            candidate.commitment_class, snapshot.cited_category, snapshot.cited_merchant,
            snapshot.protected_override, snapshot.id::text as snapshot_id,
            latest.id::text as latest_snapshot_id,
            cardinality(snapshot.evidence_ids)::text as evidence_count,
            (select count(*)::text from recovery_evidence live
              where live.workspace_id = candidate.workspace_id
                and live.id = any(snapshot.evidence_ids)) as live_evidence_count,
            coalesce((
              select array_agg(distinct evidence.category)
              from unnest(snapshot.evidence_ids) as cited(id)
              join recovery_evidence evidence
                on evidence.workspace_id = candidate.workspace_id and evidence.id = cited.id
            ), '{}'::text[]) as cited_categories,
            coalesce((
              select array_agg(cited.id::text order by cited.id::text)
              from unnest(snapshot.evidence_ids) as cited(id)
            ), '{}'::text[]) as evidence_ids,
            candidate.amount_minor::text as amount_minor,
            commitment.effective_cadence as cadence,
            candidate.next_debit_date::text as next_debit_date,
            snapshot.confidence_score::text as confidence_score,
            candidate.provider_id, mandate.status as mandate_status,
            coalesce(disable.disabled, false) as provider_disabled,
            ((${candidateCitedSourcesCurrentSql}) and (${candidateClassificationCurrentSql})) as source_connected,
            exists (
              select 1 from consent_grants consent
              join workspaces workspace on workspace.id = candidate.workspace_id
              where consent.workspace_id = candidate.workspace_id
                and consent.user_id = workspace.owner_user_id
                and consent.purpose = '${standingMandateConsentPurpose}'
                and consent.withdrawn_at is null
                and (consent.expires_at is null or consent.expires_at > now())
            ) as consent_current
     from recovery_action_candidates candidate
     join recovery_standing_mandates mandate
       on mandate.workspace_id = candidate.workspace_id and mandate.id = candidate.mandate_id
     join recovery_commitments commitment
       on commitment.workspace_id = candidate.workspace_id and commitment.id = candidate.commitment_id
     join recovery_classification_snapshots snapshot
       on snapshot.id = candidate.classification_snapshot_id
     left join recovery_provider_disables disable
       on disable.provider_id = candidate.provider_id
     join lateral (
       select id from recovery_classification_snapshots newer
       where newer.workspace_id = candidate.workspace_id and newer.commitment_id = candidate.commitment_id
       order by newer.created_at desc, newer.id desc
       limit 1
     ) latest on true`,
  );
  const eligibleWorkspaces = new Set<string>();
  let protectedLeakage = 0;
  const noticeDeliverable = canQueueDeliverableAutopilotNotice();
  for (const row of candidates.rows) {
    const terminal = (terminalCandidateStatuses as readonly string[]).includes(row.status);
    const catalog = row.provider_id ? lookupCatalogProviderById(row.provider_id) : null;
    const executable = catalog ? isProviderExecutable(catalog) && !row.provider_disabled : false;
    const liveEvidence = Number(row.live_evidence_count);
    const snapshotEvidence = Number(row.evidence_count);
    const eligible = countsAsEligibleCandidate({
      workspaceId: row.workspace_id,
      mandateActive: row.mandate_status === "ACTIVE",
      classificationCurrent: row.snapshot_id === row.latest_snapshot_id,
      evidenceFresh: liveEvidence > 0 && liveEvidence === snapshotEvidence,
      nonTerminal: !terminal,
      nonWithdrawn: row.status !== "WITHDRAWN",
      evaluatorEligible: row.eligibility === "ELIGIBLE",
      providerExecutable: executable,
      providerProven: Boolean(catalog && isProviderRouteProven(catalog)),
      providerEnabled: Boolean(catalog) && !row.provider_disabled,
      noticeDeliverable,
      sourceConnected: row.source_connected,
      consentCurrent: row.consent_current,
    });
    if (eligible) eligibleWorkspaces.add(row.workspace_id);
    const citedClass = classifyCommitment(row.cited_category, row.cited_merchant ?? "");
    const conflictingProtected = (row.cited_categories ?? []).some((category) => {
      const classified = classifyCommitment(category, row.cited_merchant ?? "");
      return isProtectedCommitmentClass(classified) && classified !== citedClass;
    });
    if (countsAsProtectedLeakage({
      citedClass,
      protectedOverride: row.protected_override || isProtectedCommitmentClass(citedClass),
      conflictingProtected,
      recordedEligibility: row.eligibility,
    })) {
      protectedLeakage += 1;
    }
  }
  const counts = {
    connectedMandates: connected.rows.length,
    eligibleCandidates: eligibleWorkspaces.size,
    protectedLeakage,
  };
  const evaluated = evaluateShadowGate(counts);
  return {
    ...evaluated,
    snapshotHash: createHash("sha256").update(JSON.stringify({
      connected: connected.rows.map((row) => row.workspace_id).sort(),
      eligible: [...eligibleWorkspaces].sort(),
      leakage: protectedLeakage,
      facts: candidates.rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        snapshotId: row.snapshot_id,
        latestSnapshotId: row.latest_snapshot_id,
        evidenceIds: [...row.evidence_ids].sort(),
        citedCategory: row.cited_category,
        citedMerchant: row.cited_merchant,
        commitmentClass: row.commitment_class,
        amountMinor: row.amount_minor,
        cadence: row.cadence,
        nextDebitDate: row.next_debit_date,
        confidenceScore: row.confidence_score,
        eligibility: row.eligibility,
        status: row.status,
        sourceConnected: row.source_connected,
        consentCurrent: row.consent_current,
        mandateStatus: row.mandate_status,
      })).sort((left, right) => left.id.localeCompare(right.id)),
    })).digest("hex"),
  };
}

async function recordConnectedMandateCohort(client: PoolClient, workspaceId: string) {
  await client.query(
    `insert into recovery_connected_mandate_cohort (workspace_id, started_at)
     select $1, greatest(mandate.signed_at, min(source.ingested_at))
     from recovery_standing_mandates mandate
     join workspaces workspace on workspace.id = mandate.workspace_id
     join recovery_sources source on source.workspace_id = mandate.workspace_id
     join recovery_evidence evidence
       on evidence.workspace_id = source.workspace_id and evidence.source_id = source.id
     where mandate.workspace_id = $1 and mandate.status = 'ACTIVE'
       and ${currentSourceNotDisconnectedSql}
       and ${standingMandateConsentExistsSql}
     group by mandate.signed_at
     having count(*) > 0
     on conflict (workspace_id) do nothing`,
    [workspaceId],
  );
}

async function refreshCandidates(client: PoolClient, workspaceId: string, mandate: MandateRow) {
  await recordConnectedMandateCohort(client, workspaceId);
  const commitments = await client.query<{
    id: string;
    merchant: string;
    category: string;
    confidence_score: number;
    amount_minor: string;
    currency: string;
    cadence: string;
    next_expected_date: string | null;
    evidence_count: string;
    distinct_dates: string;
    decision: string | null;
    coverage_end: string | null;
  }>(
    `select commitment.id, commitment.effective_merchant as merchant, commitment.base_category as category,
            commitment.confidence_score, commitment.effective_amount_minor::text as amount_minor,
            commitment.base_currency as currency, commitment.effective_cadence as cadence,
            commitment.effective_next_expected_date::text as next_expected_date,
            count(distinct evidence.id)::text as evidence_count,
            count(distinct evidence.evidence_date) filter (where evidence.observed_at is not null)::text as distinct_dates,
            decision.decision,
            max(source.coverage_end)::text as coverage_end
     from recovery_commitments commitment
     left join recovery_commitment_evidence link
       on link.workspace_id = commitment.workspace_id and link.commitment_id = commitment.id
     left join recovery_evidence evidence
       on evidence.workspace_id = link.workspace_id and evidence.id = link.evidence_id
     left join recovery_sources source
       on source.workspace_id = evidence.workspace_id and source.id = evidence.source_id
     left join recovery_decisions decision
       on decision.workspace_id = commitment.workspace_id and decision.commitment_id = commitment.id
     where commitment.workspace_id = $1 and commitment.effective_status = 'ACTIVE'
     group by commitment.id, decision.decision`,
    [workspaceId],
  );

  for (const commitment of commitments.rows) {
    const evidence = await client.query<{
      id: string;
      category: string;
      amount_minor: string | null;
      currency: string | null;
      evidence_date: string | null;
      observed_at: string | null;
      cadence_hint: string | null;
      next_expected_date: string | null;
      excerpt: string | null;
      provenance_kind: "USER_SUBMITTED" | "PROVIDER_RECEIVED";
      coverage_start: string | null;
      coverage_end: string | null;
    }>(
            `select evidence.id::text, evidence.category, evidence.amount_minor::text, evidence.currency,
              evidence.evidence_date::text, evidence.observed_at::text, evidence.cadence_hint, evidence.next_expected_date::text,
              evidence.excerpt, evidence.provenance_kind, source.coverage_start::text, source.coverage_end::text
       from recovery_commitment_evidence link
       join recovery_evidence evidence
         on evidence.workspace_id = link.workspace_id and evidence.id = link.evidence_id
       left join recovery_sources source
         on source.workspace_id = evidence.workspace_id and source.id = evidence.source_id
       where link.workspace_id = $1 and link.commitment_id = $2
       limit 40`,
      [workspaceId, commitment.id],
    );
    const cited = evidence.rows.map((row) => row.id);
    if (!cited.length) continue;
    const amounts = [...new Set(evidence.rows.map((row) => row.amount_minor).filter(Boolean))];
    const currencies = [...new Set(evidence.rows.map((row) => row.currency).filter(Boolean))];
    const cadences = [...new Set(evidence.rows.map((row) => row.cadence_hint).filter(Boolean))];
    const categories = [...new Set(evidence.rows.map((row) => row.category))];
    const priorVeto = await client.query<{ id: string }>(
      `select id from recovery_action_candidates
       where workspace_id = $1 and commitment_id = $2 and status = 'VETOED' limit 1`,
      [workspaceId, commitment.id],
    );
    const contradictory = await client.query<{ id: string }>(
      `select id from recovery_changes
       where workspace_id = $1 and commitment_id = $2
         and provenance_kind = 'CORRECTION'
         and kind in ('AMOUNT', 'MERCHANT', 'DATE', 'CADENCE')
       limit 1`,
      [workspaceId, commitment.id],
    );
    const executed = await client.query<{ total: string }>(
      `select coalesce(sum(amount_minor), 0)::text as total
       from recovery_action_candidates
       where workspace_id = $1
         and currency = $2
         and status in ('EXECUTED', 'VERIFYING', 'VERIFIED')
         and updated_at >= now() - interval '30 days'`,
      [workspaceId, mandate.currency],
    );
    const coverageEnds = evidence.rows.map((row) => row.coverage_end).filter((value): value is string => Boolean(value));
    const latestCoverageEnd = coverageEnds.sort().at(-1) ?? null;
    const nextDebit = deriveNextDebit({
      occurrences: evidence.rows.flatMap((row) => {
        const explicitProviderRenewal = row.provenance_kind === "PROVIDER_RECEIVED" && receiptNextDateIsExplicit(row.excerpt ?? "");
        return row.evidence_date && (row.observed_at || explicitProviderRenewal) ? [{
        evidenceDate: row.evidence_date,
        amountMinor: BigInt(row.amount_minor ?? "0"),
        currency: row.currency ?? commitment.currency,
        merchant: commitment.merchant,
        cadence: (row.cadence_hint ?? commitment.cadence) as Cadence,
        citedNextExpectedDate: row.next_expected_date,
        explicitProviderRenewal,
      }] : [];
      }),
      correctionInvalidates: Boolean(contradictory.rows[0]),
    });
    const evaluated = evaluateEligibility({
      mandateActive: mandate.status === "ACTIVE",
      category: commitment.category,
      conflictingCategories: categories.filter((value) => value !== commitment.category),
      confidenceScore: commitment.confidence_score,
      datedOccurrenceCount: Number(commitment.distinct_dates),
      explicitProviderRenewalEvidence: evidence.rows.some((row) => row.provenance_kind === "PROVIDER_RECEIVED" && receiptNextDateIsExplicit(row.excerpt ?? "")),
      cadenceStable: Boolean(commitment.cadence) && commitment.cadence !== "IRREGULAR" && cadences.length <= 1,
      amountStable: Boolean(commitment.amount_minor) && amounts.length <= 1,
      currencyStable: Boolean(commitment.currency) && currencies.length <= 1,
      nextDebitStable: nextDebit.stable,
      amountMinor: BigInt(commitment.amount_minor),
      amountCurrency: commitment.currency,
      mandateCurrency: mandate.currency,
      rolling30dExecutedMinor: BigInt(executed.rows[0]?.total ?? "0"),
      perActionCeilingMinor: BigInt(mandate.per_action_ceiling_minor),
      rolling30dCeilingMinor: BigInt(mandate.rolling_30d_ceiling_minor),
      merchant: commitment.merchant,
      decision: commitment.decision as never,
      priorVeto: Boolean(priorVeto.rows[0]),
      staleEvidence: isStale(latestCoverageEnd),
      contradictoryUpdate: Boolean(contradictory.rows[0]),
      noticeCanBeDelivered: canDeliverAutopilotNotice(),
    });
    const snapshot = await client.query<{ id: string }>(
      `insert into recovery_classification_snapshots (
         workspace_id, commitment_id, commitment_class, protected_override, cited_category,
         cited_merchant, confidence_score, evidence_ids
       ) values ($1, $2, $3, $4, $5, $6, $7, $8::uuid[])
       returning id`,
      [
        workspaceId,
        commitment.id,
        evaluated.commitmentClass,
        evaluated.protectedOverride,
        commitment.category,
        commitment.merchant,
        commitment.confidence_score,
        cited,
      ],
    );
    const prior = await client.query<{
      eligibility: string;
      next_debit_reason: string | null;
      next_debit_date: string | null;
      provider_id: string | null;
    }>(
      `select eligibility, next_debit_reason, next_debit_date::text, provider_id
       from recovery_action_candidates
       where workspace_id = $1 and commitment_id = $2 and mandate_id = $3 and mandate_version = $4`,
      [workspaceId, commitment.id, mandate.id, mandate.version],
    );
    await client.query(
      `insert into recovery_action_candidates (
         workspace_id, commitment_id, mandate_id, mandate_version, classification_snapshot_id,
         commitment_class, eligibility, ineligible_reasons, status, provider_id, amount_minor, currency,
         next_debit_date, next_debit_inputs_hash, next_debit_reason
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, 'SHADOW', $9, $10, $11, $12, $13, $14)
       on conflict (workspace_id, commitment_id, mandate_id, mandate_version)
       do update set classification_snapshot_id = excluded.classification_snapshot_id,
                     commitment_class = excluded.commitment_class,
                     eligibility = excluded.eligibility,
                     ineligible_reasons = excluded.ineligible_reasons,
                     provider_id = excluded.provider_id,
                     amount_minor = excluded.amount_minor,
                     currency = excluded.currency,
                     next_debit_date = excluded.next_debit_date,
                     next_debit_inputs_hash = excluded.next_debit_inputs_hash,
                     next_debit_reason = excluded.next_debit_reason,
                     updated_at = now()
       where recovery_action_candidates.status in ('SHADOW', 'WITHDRAWN')`,
      [
        workspaceId,
        commitment.id,
        mandate.id,
        mandate.version,
        snapshot.rows[0]?.id,
        evaluated.commitmentClass,
        evaluated.eligibility,
        evaluated.reasons,
        evaluated.providerId,
        commitment.amount_minor,
        commitment.currency,
        nextDebit.nextDebitDate,
        nextDebit.inputsHash,
        nextDebit.reason,
      ],
    );
    const changed = !prior.rows[0]
      || prior.rows[0].eligibility !== evaluated.eligibility
      || prior.rows[0].next_debit_reason !== nextDebit.reason
      || prior.rows[0].next_debit_date !== nextDebit.nextDebitDate
      || prior.rows[0].provider_id !== evaluated.providerId;
    if (changed) {
      await recordProductEvent({
        workspaceId,
        eventName: "candidate.evaluated",
        source: "workspace-api",
        status: "succeeded",
      }, client);
    }
  }
}

function isStale(coverageEnd: string | null) {
  if (!coverageEnd) return true;
  const end = new Date(`${coverageEnd}T00:00:00.000Z`);
  return Date.now() - end.getTime() > 90 * 24 * 60 * 60 * 1000;
}

const candidateReturning = `
  recovery_action_candidates.id, recovery_action_candidates.commitment_id,
  (select effective_merchant from recovery_commitments where id = recovery_action_candidates.commitment_id) as merchant,
  eligibility, status, ineligible_reasons, provider_id, amount_minor::text, currency,
  notice_delivered_at, veto_deadline_at, exception_code
`;

const candidateSelect = `
  select ${candidateReturning}
  from recovery_action_candidates
  where workspace_id = $1 and id = $2
`;

async function listCandidateDtos(client: PoolClient, workspaceId: string) {
  const result = await client.query<CandidateRow>(
    `select recovery_action_candidates.id, recovery_action_candidates.commitment_id,
            commitment.effective_merchant as merchant, eligibility, status, ineligible_reasons,
            provider_id, amount_minor::text, currency, notice_delivered_at, veto_deadline_at, exception_code,
            notice.delivery_status,
            exists (
              select 1 from recovery_autopilot_dead_letters dead
              where dead.workspace_id = recovery_action_candidates.workspace_id
                and dead.candidate_id = recovery_action_candidates.id
                and dead.last_error_code = 'NOTICE_TOKEN_COVERAGE_INVALID'
            ) as token_coverage_invalid
     from recovery_action_candidates
     join recovery_commitments commitment
       on commitment.workspace_id = recovery_action_candidates.workspace_id
      and commitment.id = recovery_action_candidates.commitment_id
     left join recovery_veto_notices notice
       on notice.workspace_id = recovery_action_candidates.workspace_id
      and notice.candidate_id = recovery_action_candidates.id
     where recovery_action_candidates.workspace_id = $1
     order by recovery_action_candidates.updated_at desc`,
    [workspaceId],
  );
  return result.rows.map(toCandidateDto);
}

async function readActiveMandate(client: PoolClient, workspaceId: string) {
  const result = await client.query<MandateRow>(
    `select mandate.id, mandate.version, mandate.status, mandate.terms_version, mandate.signed_text,
            mandate.signed_text_hash, mandate.currency,
            mandate.per_action_ceiling_minor::text, mandate.rolling_30d_ceiling_minor::text,
            mandate.veto_window_hours, mandate.signed_at, mandate.revoked_at
     from recovery_standing_mandates mandate
     join workspaces workspace on workspace.id = mandate.workspace_id
     where mandate.workspace_id = $1 and mandate.status = 'ACTIVE'
       and ${standingMandateConsentExistsSql}`,
    [workspaceId],
  );
  return result.rows[0] ?? null;
}

async function readActiveOrLatestMandate(client: PoolClient, workspaceId: string) {
  const result = await client.query<MandateRow>(
    `select id, version, status, terms_version, signed_text, signed_text_hash, currency,
            per_action_ceiling_minor::text, rolling_30d_ceiling_minor::text, veto_window_hours,
            signed_at, revoked_at
     from recovery_standing_mandates
     where workspace_id = $1
     order by version desc limit 1`,
    [workspaceId],
  );
  return result.rows[0] ? toMandateDto(result.rows[0]) : null;
}

async function readVersion(client: PoolClient, workspaceId: string) {
  const result = await client.query<{ version: string }>(
    `select version::text from recovery_workspace_states where workspace_id = $1`,
    [workspaceId],
  );
  return Number(result.rows[0]?.version ?? 0);
}

async function assertExpectedVersion(client: PoolClient, workspaceId: string, expected: number) {
  const current = await readVersion(client, workspaceId);
  if (current !== expected) throw new RecoveryServiceError("STALE_STATE", undefined, { currentVersion: current });
}

async function readIdempotent<T>(client: PoolClient, workspaceId: string, key: string, operation: string, requestHash: string) {
  const result = await client.query<{ operation: string; request_hash: string; response_payload: T; workspace_version: string }>(
    `select operation, request_hash, response_payload, workspace_version::text
     from recovery_idempotency_keys where workspace_id = $1 and idempotency_key = $2`,
    [workspaceId, key],
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
  key: string,
  operation: string,
  requestHash: string,
  response: unknown,
  workspaceVersion: number,
) {
  await client.query(
    `insert into recovery_idempotency_keys (
       workspace_id, idempotency_key, operation, request_hash, response_payload, workspace_version
     ) values ($1, $2, $3, $4, $5::jsonb, $6)`,
    [workspaceId, key, operation, requestHash, JSON.stringify(response), workspaceVersion],
  );
}

function honestExceptionCode(failureReason?: string | null) {
  const known = [
    "LOGIN_REQUIRED",
    "OTP_REQUIRED",
    "PHONE_REQUIRED",
    "UPI_APP_CONFIRMATION",
    "BANK_SCRAPE",
    "UNKNOWN_PATH",
    "OPERATOR_EXCEPTION",
  ] as const;
  return known.find((code) => code === failureReason) ?? "OPERATOR_EXCEPTION";
}

function pgCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error ? String(error.code) : "";
}

function mapAutopilotError(error: unknown): RecoveryServiceError {
  if (error instanceof RecoveryServiceError) return error;
  const code = pgCode(error);
  if (code === "23P01" || code === "23505") {
    return new RecoveryServiceError("CONFLICT");
  }
  if (["ECONNREFUSED", "57P01", "57P02", "57P03", "08001", "08006"].includes(code)) {
    return new RecoveryServiceError("DATABASE_UNAVAILABLE", undefined, { retryable: true });
  }
  return new RecoveryServiceError("SAVE_FAILED");
}
