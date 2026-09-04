import "server-only";

import {
  buildControlAttention,
  primaryControlAttention,
  type ControlAttentionItem,
  type ControlAttentionKind,
} from "@/lib/commitment-control/attention";
import type { ControlExceptionTargetKind } from "@/lib/commitment-control/contracts";
import { isCommitmentControlWorkspaceEnrolled } from "@/lib/commitment-control/enrollment";
import { calendarDateInTimeZone } from "@/lib/commitment-control/project";
import {
  advanceNotificationDelivery,
  notificationRetryDelayMinutes,
  type NotificationDeliveryEvent,
  type NotificationDeliveryState,
} from "@/lib/recovery/notification-policy";
import { isNoticeProviderEventType, type NoticeProviderEventType } from "@/lib/recovery/notice-delivery";
import { getCommitmentControlBrief } from "@/lib/server/commitment-control-store";
import { getDatabasePool } from "@/lib/server/database";
import { RecoveryServiceError } from "@/lib/server/recovery-api";

/**
 * Durable outbox for Commitment Control attention.
 *
 * This module only records what a human still owes. It never decides, never
 * sends, and never stores drafted prose: a row is the deterministic attention
 * kind plus its due date, so the message is always re-derived from live truth at
 * send time. Consent is opt-in — a recipient with no preference row is silent.
 */

const controlAttentionTimeZone = "Asia/Kolkata";
/** One first attempt plus the shared retry budget. */
const controlAttentionMaxAttempts = notificationRetryDelayMinutes.length + 1;

const defaultClaimLimit = 25;
const maxClaimLimit = 100;
const defaultStaleLockMinutes = 15;

// 0068 split the occurrence key into two partial unique indexes so a null
// target still dedupes, so the insert names the one it can actually conflict on.
const targetedOccurrenceConflict =
  `on conflict (workspace_id, proposal_id, recipient_user_id, attention_kind, due_on, target_kind, target_id)
     where target_kind is not null do nothing`;
const untargetedOccurrenceConflict =
  `on conflict (workspace_id, proposal_id, recipient_user_id, attention_kind, due_on)
     where target_kind is null do nothing`;

export type ControlAttentionNotificationState = NotificationDeliveryState | "CANCELLED";

export type ControlAttentionScheduleSummary = {
  workspacesScanned: number;
  recipients: number;
  enqueued: number;
  cancelled: number;
};

export type ClaimedControlAttentionNotification = {
  id: string;
  workspaceId: string;
  proposalId: string;
  recipientUserId: string;
  recipientEmail: string;
  attentionKind: ControlAttentionKind;
  dueOn: string;
  /** Which adverse record this interruption is about, when it is about one. */
  targetKind: ControlExceptionTargetKind | null;
  targetId: string | null;
  attempt: number;
  /** Re-derived at claim time, so a sender never renders a stale headline. */
  item: ControlAttentionItem;
};

export type ControlAttentionClaimSummary = {
  ready: readonly ClaimedControlAttentionNotification[];
  cancelled: number;
  suppressed: number;
  unsubscribed: number;
  deadLettered: number;
};

export type ControlAttentionTransition = {
  id: string;
  state: ControlAttentionNotificationState;
  nextAttemptAt: string | null;
};

/**
 * What a signed provider event did to the outbox.
 *
 * `pending` means no attention row is bound to that provider message id yet, so
 * the caller must ask the provider to retry rather than guess. `duplicate` and
 * `ignored` are both idempotent no-ops: the row already holds this outcome, or
 * the event is older or weaker than what the row already knows.
 */
export type ControlAttentionProviderEventResult = {
  result: "pending" | "duplicate" | "ignored" | "applied";
  notificationId: string | null;
  state: ControlAttentionNotificationState | null;
};

type EligibleRecipient = { userId: string; email: string };

export async function scheduleControlAttentionNotifications(input: {
  workspaceIds: readonly string[];
  now: Date;
  today?: string;
}): Promise<ControlAttentionScheduleSummary> {
  const today = input.today ?? calendarDateInTimeZone(input.now, controlAttentionTimeZone);
  const timestamp = input.now.toISOString();
  const summary = { workspacesScanned: 0, recipients: 0, enqueued: 0, cancelled: 0 };

  for (const workspaceId of enrolledWorkspaceIds(input.workspaceIds)) {
    const recipients = await readEligibleRecipients(workspaceId);
    if (!recipients.length) continue;
    const brief = await getCommitmentControlBrief({ workspaceId, actorUserId: recipients[0]!.userId });
    const attention = primaryControlAttention(buildControlAttention(brief.data.proposals, { today }));

    const client = await getDatabasePool().connect();
    try {
      await client.query("begin");
      const cancelled = await client.query(
        `update commitment_control_attention_notifications
         set delivery_state = 'CANCELLED', state_reason = 'ATTENTION_RESOLVED',
             next_attempt_at = null, locked_by = null, locked_at = null, updated_at = $2
         where workspace_id = $1
           and delivery_state in ('QUEUED', 'RETRY_SCHEDULED')
           and (proposal_id::text || '|' || attention_kind || '|' || to_char(due_on, 'YYYY-MM-DD')
             || '|' || coalesce(target_kind, '') || '|' || coalesce(target_id::text, '')) <> all($3::text[])`,
        [workspaceId, timestamp, attention.map(occurrenceKey)],
      );
      let enqueued = 0;
      for (const item of attention) {
        for (const recipient of recipients) {
          const inserted = await client.query(
            `insert into commitment_control_attention_notifications (
               workspace_id, proposal_id, recipient_user_id, attention_kind, due_on,
               target_kind, target_id, delivery_state, attempt_count, next_attempt_at,
               created_at, updated_at
             ) values ($1, $2, $3, $4, $5::date, $7, $8::uuid, 'QUEUED', 0, $6, $6, $6)
             ${item.targetKind ? targetedOccurrenceConflict : untargetedOccurrenceConflict}
             returning id`,
            [workspaceId, item.proposalId, recipient.userId, item.kind, item.dueOn, timestamp,
              item.targetKind ?? null, item.targetId ?? null],
          );
          enqueued += inserted.rowCount ?? 0;
        }
      }
      await client.query("commit");
      summary.workspacesScanned += 1;
      summary.recipients += recipients.length;
      summary.enqueued += enqueued;
      summary.cancelled += cancelled.rowCount ?? 0;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw normalizeAttentionError(error);
    } finally {
      client.release();
    }
  }

  return summary;
}

export async function claimDueControlAttentionNotifications(input: {
  workspaceIds: readonly string[];
  now: Date;
  lockOwner: string;
  limit?: number;
  staleLockMinutes?: number;
  today?: string;
}): Promise<ControlAttentionClaimSummary> {
  const workspaceIds = enrolledWorkspaceIds(input.workspaceIds);
  const summary = { ready: [] as ClaimedControlAttentionNotification[], cancelled: 0, suppressed: 0, unsubscribed: 0, deadLettered: 0 };
  if (!workspaceIds.length) return summary;

  const lockOwner = input.lockOwner.trim().slice(0, 120);
  if (!lockOwner) throw new RecoveryServiceError("INVALID_EVIDENCE", "Claiming attention requires a lock owner.");
  const today = input.today ?? calendarDateInTimeZone(input.now, controlAttentionTimeZone);
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? defaultClaimLimit), 1), maxClaimLimit);
  const staleMinutes = Math.max(input.staleLockMinutes ?? defaultStaleLockMinutes, 1);
  const timestamp = input.now.toISOString();
  const staleBefore = new Date(input.now.getTime() - staleMinutes * 60_000).toISOString();

  const claimed = await claimRows({ workspaceIds, timestamp, staleBefore, limit, lockOwner });
  const attentionByActor = new Map<string, readonly ControlAttentionItem[] | null>();

  for (const row of claimed) {
    if (row.delivery_state === "DEAD_LETTER") {
      summary.deadLettered += 1;
      continue;
    }

    const eligibility = await readRecipientEligibility(row.workspace_id, row.recipient_user_id);
    if (eligibility === null || !eligibility.authorizing) {
      await finishClaim(row.id, "SUPPRESSED", "RECIPIENT_INELIGIBLE", timestamp);
      summary.suppressed += 1;
      continue;
    }
    if (eligibility.unsubscribed) {
      await finishClaim(row.id, "UNSUBSCRIBED", null, timestamp);
      summary.unsubscribed += 1;
      continue;
    }
    if (!eligibility.productEmails) {
      await finishClaim(row.id, "SUPPRESSED", "NO_CONSENT", timestamp);
      summary.suppressed += 1;
      continue;
    }

    const actorKey = `${row.workspace_id}|${row.recipient_user_id}`;
    if (!attentionByActor.has(actorKey)) {
      attentionByActor.set(actorKey, await readCurrentAttention(row.workspace_id, row.recipient_user_id, today));
    }
    const attention = attentionByActor.get(actorKey) ?? null;
    if (attention === null) {
      await finishClaim(row.id, "SUPPRESSED", "RECIPIENT_INELIGIBLE", timestamp);
      summary.suppressed += 1;
      continue;
    }
    const item = attention.find((candidate) =>
      candidate.kind === row.attention_kind
      && candidate.proposalId === row.proposal_id
      && candidate.dueOn === row.due_on
      && (candidate.targetKind ?? null) === row.target_kind
      && (candidate.targetId ?? null) === row.target_id);
    if (!item) {
      await finishClaim(row.id, "CANCELLED", "ATTENTION_RESOLVED", timestamp);
      summary.cancelled += 1;
      continue;
    }

    summary.ready.push({
      id: row.id,
      workspaceId: row.workspace_id,
      proposalId: row.proposal_id,
      recipientUserId: row.recipient_user_id,
      recipientEmail: eligibility.email,
      attentionKind: row.attention_kind,
      dueOn: row.due_on,
      targetKind: row.target_kind,
      targetId: row.target_id,
      attempt: row.attempt_count,
      item,
    });
  }

  return summary;
}

export function recordControlAttentionProviderAccepted(input: {
  notificationId: string;
  providerMessageId: string;
  now: Date;
}): Promise<ControlAttentionTransition> {
  const providerMessageId = input.providerMessageId.trim();
  if (!providerMessageId) throw new RecoveryServiceError("INVALID_EVIDENCE", "Provider acceptance requires the provider message id.");
  return applyDeliveryEvent({
    notificationId: input.notificationId,
    now: input.now,
    event: { kind: "PROVIDER_ACCEPTED" },
    providerMessageId,
  });
}

export function recordControlAttentionSendFailure(input: {
  notificationId: string;
  errorCode: string;
  retryable: boolean;
  now: Date;
}): Promise<ControlAttentionTransition> {
  const errorCode = input.errorCode.trim().slice(0, 120);
  if (!errorCode) throw new RecoveryServiceError("INVALID_EVIDENCE", "A send failure requires an error code.");
  return applyDeliveryEvent({
    notificationId: input.notificationId,
    now: input.now,
    event: input.retryable ? { kind: "SEND_FAILED", errorCode } : { kind: "PROVIDER_BOUNCED", errorCode },
    errorCode,
  });
}

/**
 * Applies one signed provider delivery event to the attention row that owns the
 * provider's message id.
 *
 * A recipient address never identifies anything here: the provider message id is
 * the only key, and the provider's own event id and payload are never stored.
 * Ordering is enforced against the last event this row applied, so a replayed or
 * out-of-order webhook can never unsay a newer fact. Acceptance stays acceptance;
 * only `email.delivered` may claim an inbox, and only the first such claim is
 * kept. A complaint stops future product email for that recipient even when the
 * message really was delivered.
 */
export async function applyControlAttentionProviderEvent(input: {
  providerMessageId: string;
  type: NoticeProviderEventType;
  occurredAt: Date;
}): Promise<ControlAttentionProviderEventResult> {
  const providerMessageId = input.providerMessageId.trim();
  if (!providerMessageId || providerMessageId.length > 200) {
    throw new RecoveryServiceError("INVALID_EVIDENCE", "A provider event requires the provider message id.");
  }
  if (!isNoticeProviderEventType(input.type)) {
    throw new RecoveryServiceError("INVALID_EVIDENCE", "That provider event type is not recognized.");
  }
  const occurredAt = input.occurredAt.getTime();
  if (!Number.isFinite(occurredAt)) {
    throw new RecoveryServiceError("INVALID_EVIDENCE", "A provider event requires when the provider says it happened.");
  }
  const occurredAtIso = input.occurredAt.toISOString();

  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    const current = await client.query<ProviderEventRow>(
      `select id, workspace_id, recipient_user_id, delivery_state, provider_accepted_at,
         delivered_at, failed_at, error_code, last_provider_event_type, last_provider_event_at
       from commitment_control_attention_notifications
       where provider_message_id = $1
       for update`,
      [providerMessageId],
    );
    const row = current.rows[0];
    if (!row) {
      await client.query("rollback");
      return { result: "pending", notificationId: null, state: null };
    }

    const target = decideProviderEvent(row, input.type, occurredAt, occurredAtIso);
    if (target.write) {
      await client.query(
        `update commitment_control_attention_notifications
         set delivery_state = $2,
             state_reason = null,
             next_attempt_at = case when $2 in ('QUEUED', 'RETRY_SCHEDULED') then next_attempt_at else null end,
             locked_by = case when $2 = 'SENDING' then locked_by else null end,
             locked_at = case when $2 = 'SENDING' then locked_at else null end,
             provider_accepted_at = $3,
             delivered_at = $4,
             failed_at = $5,
             error_code = $6,
             last_provider_event_type = $7,
             last_provider_event_at = $8,
             updated_at = now()
         where id = $1`,
        [row.id, target.state, target.providerAcceptedAt, target.deliveredAt, target.failedAt,
          target.errorCode, input.type, occurredAtIso],
      );
    }
    if (target.optOutRecipient) {
      // Only an existing consent row is switched off. A recipient who never
      // opted in has no row, and inventing one would invent consent history.
      await client.query(
        `update recovery_notification_preferences
         set product_emails = false,
             unsubscribed_at = coalesce(unsubscribed_at, $3::timestamptz),
             updated_at = now()
         where workspace_id = $1 and user_id = $2`,
        [row.workspace_id, row.recipient_user_id, occurredAtIso],
      );
    }
    await client.query("commit");
    return { result: target.result, notificationId: row.id, state: target.state };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw normalizeAttentionError(error);
  } finally {
    client.release();
  }
}

type ProviderEventRow = {
  id: string;
  workspace_id: string;
  recipient_user_id: string;
  delivery_state: ControlAttentionNotificationState;
  provider_accepted_at: Date | null;
  delivered_at: Date | null;
  failed_at: Date | null;
  error_code: string | null;
  last_provider_event_type: NoticeProviderEventType | null;
  last_provider_event_at: Date | null;
};

type ProviderEventTarget = {
  result: "duplicate" | "ignored" | "applied";
  state: ControlAttentionNotificationState;
  write: boolean;
  optOutRecipient: boolean;
  providerAcceptedAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
  errorCode: string | null;
};

const providerTerminalFailureStates = new Set<ControlAttentionNotificationState>(["FAILED", "DEAD_LETTER"]);
const providerUnreachableStates = new Set<ControlAttentionNotificationState>(["CANCELLED", "SUPPRESSED"]);

function decideProviderEvent(
  row: ProviderEventRow,
  type: NoticeProviderEventType,
  occurredAt: number,
  occurredAtIso: string,
): ProviderEventTarget {
  const cursorAt = row.last_provider_event_at?.getTime() ?? null;
  if (cursorAt !== null && occurredAt < cursorAt) return keepRow(row, "ignored", false);
  if (cursorAt !== null && occurredAt === cursorAt && row.last_provider_event_type === type) {
    return keepRow(row, "duplicate", false);
  }
  // A row that was cancelled or suppressed is no longer a live delivery record.
  if (providerUnreachableStates.has(row.delivery_state)) return keepRow(row, "ignored", false);

  const state = row.delivery_state;
  const failed = providerTerminalFailureStates.has(state);
  const settled = failed || state === "DELIVERED" || state === "UNSUBSCRIBED";

  switch (type) {
    case "email.sent":
      if (settled) return keepRow(row, "ignored", true);
      if (state === "PROVIDER_ACCEPTED") return keepRow(row, "duplicate", true);
      return {
        ...keepRow(row, "applied", true),
        state: "PROVIDER_ACCEPTED",
        providerAcceptedAt: isoOrNull(row.provider_accepted_at) ?? occurredAtIso,
      };

    case "email.delivered":
      if (state === "DELIVERED") return keepRow(row, "duplicate", true);
      if (failed || state === "UNSUBSCRIBED") return keepRow(row, "ignored", true);
      return {
        ...keepRow(row, "applied", true),
        state: "DELIVERED",
        providerAcceptedAt: isoOrNull(row.provider_accepted_at) ?? occurredAtIso,
        deliveredAt: occurredAtIso,
      };

    case "email.delayed":
    case "email.delivery_delayed":
      // A delay says the provider is still trying. It never says an inbox saw it.
      return keepRow(row, settled ? "ignored" : "applied", true);

    case "email.bounced":
    case "email.failed":
      if (failed) return keepRow(row, "duplicate", true);
      if (state === "UNSUBSCRIBED") return keepRow(row, "ignored", true);
      return {
        ...keepRow(row, "applied", true),
        state: "FAILED",
        deliveredAt: null,
        failedAt: occurredAtIso,
        errorCode: type === "email.bounced" ? "PROVIDER_BOUNCED" : "PROVIDER_FAILED",
      };

    case "email.complained":
      if (state === "UNSUBSCRIBED") return keepRow(row, "duplicate", true);
      // A complaint about a message that already failed adds no delivery fact,
      // so the failure evidence stays and only the consent changes.
      if (failed) return { ...keepRow(row, "applied", true), optOutRecipient: true };
      return {
        ...keepRow(row, "applied", true),
        state: "UNSUBSCRIBED",
        optOutRecipient: true,
      };
  }
}

function keepRow(row: ProviderEventRow, result: ProviderEventTarget["result"], write: boolean): ProviderEventTarget {
  return {
    result,
    write,
    optOutRecipient: false,
    state: row.delivery_state,
    providerAcceptedAt: isoOrNull(row.provider_accepted_at),
    deliveredAt: isoOrNull(row.delivered_at),
    failedAt: isoOrNull(row.failed_at),
    errorCode: row.error_code,
  };
}

function isoOrNull(value: Date | null) {
  return value === null ? null : value.toISOString();
}

type ClaimedRow = {
  id: string;
  workspace_id: string;
  proposal_id: string;
  recipient_user_id: string;
  attention_kind: ControlAttentionKind;
  due_on: string;
  target_kind: ControlExceptionTargetKind | null;
  target_id: string | null;
  attempt_count: number;
  delivery_state: ControlAttentionNotificationState;
};

async function claimRows(input: {
  workspaceIds: readonly string[];
  timestamp: string;
  staleBefore: string;
  limit: number;
  lockOwner: string;
}): Promise<readonly ClaimedRow[]> {
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    const claimed = await client.query<ClaimedRow>(
      `with stale as (
         update commitment_control_attention_notifications entry
         set delivery_state = 'DEAD_LETTER',
             locked_by = null,
             locked_at = null,
             next_attempt_at = null,
             failed_at = $2::timestamptz,
             error_code = 'ACCEPTANCE_OUTCOME_UNKNOWN',
             updated_at = $2::timestamptz
         where entry.workspace_id = any($1::uuid[])
           and entry.delivery_state = 'SENDING'
           and entry.locked_at <= $3::timestamptz
         returning entry.id, entry.workspace_id, entry.proposal_id, entry.recipient_user_id,
           entry.attention_kind, to_char(entry.due_on, 'YYYY-MM-DD') as due_on,
           entry.target_kind, entry.target_id::text as target_id,
           entry.attempt_count, entry.delivery_state
       ), due as (
         select id
         from commitment_control_attention_notifications
         where workspace_id = any($1::uuid[])
           and delivery_state in ('QUEUED', 'RETRY_SCHEDULED')
           and next_attempt_at <= $2
         order by next_attempt_at, created_at, id
         limit $4
         for update skip locked
       ), claimed as (
         update commitment_control_attention_notifications entry
         set delivery_state = case when entry.attempt_count >= $5 then 'DEAD_LETTER' else 'SENDING' end,
             attempt_count = case when entry.attempt_count >= $5 then entry.attempt_count else entry.attempt_count + 1 end,
             locked_by = case when entry.attempt_count >= $5 then null else $6 end,
             locked_at = case when entry.attempt_count >= $5 then null else $2::timestamptz end,
             next_attempt_at = null,
             failed_at = case when entry.attempt_count >= $5 then $2::timestamptz else null end,
             error_code = case when entry.attempt_count >= $5 then 'ATTEMPT_BUDGET_EXHAUSTED' else entry.error_code end,
             updated_at = $2
         from due
         where entry.id = due.id
         returning entry.id, entry.workspace_id, entry.proposal_id, entry.recipient_user_id,
           entry.attention_kind, to_char(entry.due_on, 'YYYY-MM-DD') as due_on,
           entry.target_kind, entry.target_id::text as target_id,
           entry.attempt_count, entry.delivery_state
       )
       select * from stale
       union all
       select * from claimed`,
      [input.workspaceIds, input.timestamp, input.staleBefore, input.limit, controlAttentionMaxAttempts, input.lockOwner],
    );
    await client.query("commit");
    return claimed.rows;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw normalizeAttentionError(error);
  } finally {
    client.release();
  }
}

async function applyDeliveryEvent(input: {
  notificationId: string;
  now: Date;
  event: NotificationDeliveryEvent;
  providerMessageId?: string;
  errorCode?: string;
}): Promise<ControlAttentionTransition> {
  const timestamp = input.now.toISOString();
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    const current = await client.query<{
      delivery_state: ControlAttentionNotificationState;
      attempt_count: number;
      provider_message_id: string | null;
    }>(
      `select delivery_state, attempt_count, provider_message_id
       from commitment_control_attention_notifications where id = $1 for update`,
      [input.notificationId],
    );
    const row = current.rows[0];
    if (!row) throw new RecoveryServiceError("NOT_FOUND");
    if (row.delivery_state === "CANCELLED") {
      throw new RecoveryServiceError("CONFLICT", "This attention item was cancelled and must not be sent.");
    }
    if (input.providerMessageId && row.provider_message_id && row.provider_message_id !== input.providerMessageId) {
      throw new RecoveryServiceError("CONFLICT", "This attention item is already bound to another provider message.");
    }
    if (input.event.kind === "PROVIDER_ACCEPTED"
      && row.provider_message_id === input.providerMessageId
      && ["PROVIDER_ACCEPTED", "DELIVERED", "UNSUBSCRIBED"].includes(row.delivery_state)) {
      await client.query("commit");
      return { id: input.notificationId, state: row.delivery_state, nextAttemptAt: null };
    }
    const transition = advanceNotificationDelivery({
      current: row.delivery_state,
      attempt: row.attempt_count,
      now: timestamp,
      event: input.event,
    });
    if (!transition.accepted) throw new RecoveryServiceError("CONFLICT", transition.reasons[0]);

    await client.query(
      `update commitment_control_attention_notifications
       set delivery_state = $2,
           next_attempt_at = $3,
           locked_by = null,
           locked_at = null,
           provider_message_id = coalesce($4, provider_message_id),
           provider_accepted_at = case
             when $2 in ('PROVIDER_ACCEPTED', 'DELIVERED') then coalesce(provider_accepted_at, $5::timestamptz)
             else provider_accepted_at end,
           delivered_at = case when $2 = 'DELIVERED' then $5::timestamptz else null end,
           failed_at = case when $2 in ('FAILED', 'DEAD_LETTER') then $5::timestamptz else null end,
           error_code = coalesce($6, error_code),
           updated_at = $5
       where id = $1`,
      [input.notificationId, transition.state, transition.nextAttemptAt, input.providerMessageId ?? null, timestamp, input.errorCode ?? null],
    );
    await client.query("commit");
    return { id: input.notificationId, state: transition.state, nextAttemptAt: transition.nextAttemptAt };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw normalizeAttentionError(error);
  } finally {
    client.release();
  }
}

async function finishClaim(
  notificationId: string,
  state: "CANCELLED" | "SUPPRESSED" | "UNSUBSCRIBED",
  reason: string | null,
  timestamp: string,
) {
  await getDatabasePool().query(
    `update commitment_control_attention_notifications
     set delivery_state = $2, state_reason = $3, next_attempt_at = null,
         locked_by = null, locked_at = null, updated_at = $4
     where id = $1 and delivery_state = 'SENDING'`,
    [notificationId, state, reason, timestamp],
  );
}

async function readEligibleRecipients(workspaceId: string): Promise<readonly EligibleRecipient[]> {
  const result = await getDatabasePool().query<{ user_id: string; email: string }>(
    `select member.user_id, account.email
     from workspace_members member
     join users account on account.id = member.user_id
     join recovery_notification_preferences preference
       on preference.workspace_id = member.workspace_id and preference.user_id = member.user_id
     where member.workspace_id = $1
       and member.role in ('owner', 'admin')
       and account.deleted_at is null
       and preference.product_emails = true
       and preference.unsubscribed_at is null
     order by member.user_id`,
    [workspaceId],
  );
  return result.rows.map((row) => ({ userId: row.user_id, email: row.email }));
}

async function readRecipientEligibility(workspaceId: string, userId: string) {
  const result = await getDatabasePool().query<{
    email: string;
    role: string | null;
    product_emails: boolean | null;
    unsubscribed_at: Date | null;
  }>(
    `select account.email, member.role, preference.product_emails, preference.unsubscribed_at
     from users account
     left join workspace_members member
       on member.workspace_id = $1 and member.user_id = account.id
     left join recovery_notification_preferences preference
       on preference.workspace_id = $1 and preference.user_id = account.id
     where account.id = $2 and account.deleted_at is null`,
    [workspaceId, userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    email: row.email,
    authorizing: row.role === "owner" || row.role === "admin",
    productEmails: row.product_emails === true,
    unsubscribed: row.unsubscribed_at !== null,
  };
}

async function readCurrentAttention(workspaceId: string, actorUserId: string, today: string) {
  try {
    const brief = await getCommitmentControlBrief({ workspaceId, actorUserId });
    return primaryControlAttention(buildControlAttention(brief.data.proposals, { today }));
  } catch (error) {
    if (error instanceof RecoveryServiceError) return null;
    throw error;
  }
}

/**
 * The identity of one semantic interruption. Two adverse records on the same
 * proposal can share a kind and a due date, so the record itself is part of the
 * occurrence; an untargeted kind contributes empty target fields and still
 * dedupes on the rest.
 */
function occurrenceKey(item: ControlAttentionItem) {
  return `${item.proposalId}|${item.kind}|${item.dueOn}|${item.targetKind ?? ""}|${item.targetId ?? ""}`;
}

function enrolledWorkspaceIds(workspaceIds: readonly string[]) {
  return [...new Set(workspaceIds)].filter((workspaceId) => isCommitmentControlWorkspaceEnrolled(workspaceId));
}

function normalizeAttentionError(error: unknown) {
  if (error instanceof RecoveryServiceError) return error;
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  if (code === "42P01" || code === "42703") {
    return new RecoveryServiceError("FEATURE_UNAVAILABLE", "The Commitment Control attention outbox is not installed for this deployment.");
  }
  if (code === "23505") return new RecoveryServiceError("CONFLICT");
  if (code === "23503") return new RecoveryServiceError("NOT_FOUND");
  if (code === "23514") return new RecoveryServiceError("INVALID_EVIDENCE");
  return new RecoveryServiceError("SAVE_FAILED", error instanceof Error ? error.message : undefined, { retryable: true });
}
