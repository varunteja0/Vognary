import "server-only";

import type { PoolClient } from "pg";
import {
  renewalAlertConsentPurpose,
  renewalAlertNoticeVersion,
  type RenewalAlertFailureCode,
  type RenewalAlertPreferenceInput,
  type RenewalAlertWindow,
} from "@/lib/renewal-alerts";
import { recordConsentGrant } from "@/lib/server/consent-store";
import { getDatabasePool } from "@/lib/server/database";
import { renewalAlertMinimumConfidence, toMoneyDto } from "@/lib/recovery/domain";
import type { MoneyDto } from "@/lib/recovery/contracts";

const maxDeliveryAttempts = 5;

const weeklyDigestItemsSql = `
  select
    commitment.workspace_id,
    commitment.id,
    commitment.identity_key,
    commitment.effective_merchant as merchant,
    commitment.base_currency::text as currency,
    commitment.effective_amount_minor as amount_minor,
    commitment.effective_monthly_minor as monthly_minor,
    commitment.effective_next_expected_date as next_expected_date,
    commitment.confidence_score,
    decision.decision as user_decision
  from recovery_commitments commitment
  left join recovery_decisions decision
    on decision.workspace_id = commitment.workspace_id
   and decision.commitment_id = commitment.id
  where commitment.effective_status = 'ACTIVE'`;

type PreferenceRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  consent_grant_id: string | null;
  enabled: boolean;
  weekly_digest_enabled: boolean;
  seven_day_enabled: boolean;
  one_day_enabled: boolean;
  time_zone: string;
  send_hour_local: number;
  updated_at: Date;
  consent_granted_at: Date | null;
  consent_withdrawn_at: Date | null;
  consent_expires_at: Date | null;
  consent_active: boolean;
};

export type ClaimedRenewalAlert = {
  deliveryId: string;
  email: string;
  merchant: string;
  renewalDate: string;
  alertWindow: RenewalAlertWindow;
};

export type ClaimedWeeklyDigest = {
  deliveryId: string;
  email: string;
  weekStart: string;
  monthlyTotals: readonly MoneyDto[];
  renewalCountNext7Days: number;
  renewalTotalsNext7Days: readonly MoneyDto[];
  suggestion: null | { merchant: string; monthlyCost: MoneyDto };
};

export async function getRenewalAlertPreference(input: { workspaceId: string; userId: string }) {
  const row = await readPreferenceRow(input.workspaceId, input.userId);
  return mapPreference(row);
}

export async function updateRenewalAlertPreference(input: {
  workspaceId: string;
  userId: string;
  email: string;
  preference: RenewalAlertPreferenceInput;
}) {
  const client = await getDatabasePool().connect();

  try {
    await client.query("begin");
    const existing = await readPreferenceRow(input.workspaceId, input.userId, client, true);
    const settingsChanged = !existing
      || existing.weekly_digest_enabled !== input.preference.weeklyDigestEnabled
      || existing.seven_day_enabled !== input.preference.sevenDayEnabled
      || existing.one_day_enabled !== input.preference.oneDayEnabled
      || existing.time_zone !== input.preference.timeZone
      || existing.send_hour_local !== input.preference.sendHourLocal;
    let consentGrantId = existing?.consent_grant_id ?? null;

    const deliveryConsentRequired = input.preference.enabled || input.preference.weeklyDigestEnabled;
    if (deliveryConsentRequired) {
      if (!existing?.consent_active || settingsChanged) {
        if (existing?.consent_active && existing.consent_grant_id) {
          await client.query(
            `update consent_grants
             set withdrawn_at = coalesce(withdrawn_at, now())
             where id = $1
               and user_id = $2`,
            [existing.consent_grant_id, input.userId],
          );
        }
        const consent = await recordConsentGrant({
          workspaceId: input.workspaceId,
          userId: input.userId,
          subjectEmail: input.email,
          purpose: renewalAlertConsentPurpose,
          noticeVersion: renewalAlertNoticeVersion,
          source: "renewal-alert-preferences",
          scopes: {
            deliveryChannel: "email",
            weeklyDigest: input.preference.weeklyDigestEnabled,
            sevenDay: input.preference.sevenDayEnabled,
            oneDay: input.preference.oneDayEnabled,
            timeZone: input.preference.timeZone,
            sendHourLocal: input.preference.sendHourLocal,
          },
        }, client);
        consentGrantId = consent.id;
      }
    } else if (existing?.consent_active && existing.consent_grant_id) {
      await client.query(
        `update consent_grants
         set withdrawn_at = coalesce(withdrawn_at, now())
         where id = $1
           and user_id = $2`,
        [existing.consent_grant_id, input.userId],
      );
    }

    const result = await client.query<{ id: string }>(
      `insert into renewal_alert_preferences (
         workspace_id,
         user_id,
         consent_grant_id,
         enabled,
         weekly_digest_enabled,
         seven_day_enabled,
         one_day_enabled,
         time_zone,
         send_hour_local,
         disabled_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, case when ($4 or $5) then null else now() end)
       on conflict (workspace_id, user_id)
       do update set
         consent_grant_id = excluded.consent_grant_id,
         enabled = excluded.enabled,
         weekly_digest_enabled = excluded.weekly_digest_enabled,
         seven_day_enabled = excluded.seven_day_enabled,
         one_day_enabled = excluded.one_day_enabled,
         time_zone = excluded.time_zone,
         send_hour_local = excluded.send_hour_local,
         disabled_at = case when (excluded.enabled or excluded.weekly_digest_enabled) then null else coalesce(renewal_alert_preferences.disabled_at, now()) end,
         updated_at = now()
       returning id`,
      [
        input.workspaceId,
        input.userId,
        consentGrantId,
        input.preference.enabled,
        input.preference.weeklyDigestEnabled,
        input.preference.sevenDayEnabled,
        input.preference.oneDayEnabled,
        input.preference.timeZone,
        input.preference.sendHourLocal,
      ],
    );
    const preferenceId = result.rows[0]?.id;
    if (!preferenceId) throw new Error("Renewal alert preference upsert did not return an id.");

    await client.query(
      `insert into audit_log (workspace_id, user_id, action, entity_type, entity_id)
       values ($1, $2, $3, 'renewal_alert_preference', $4)`,
      [input.workspaceId, input.userId, deliveryConsentRequired ? "renewal_alerts.enabled" : "renewal_alerts.disabled", preferenceId],
    );
    await scheduleRenewalAlertsForWorkspace(input.workspaceId, client);
    await cancelIneligibleWeeklyDigests(input.workspaceId, client);
    const updated = await readPreferenceRow(input.workspaceId, input.userId, client);
    await client.query("commit");
    return mapPreference(updated);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function scheduleRenewalAlertsForWorkspace(workspaceId: string, client?: PoolClient) {
  const queryable = client ?? getDatabasePool();
  const scheduled = await queryable.query<{ id: string }>(
    `with candidates as (
       select
         p.workspace_id,
         p.user_id,
         p.id as preference_id,
         p.consent_grant_id,
         commitment.id as recovery_commitment_id,
         reminder.alert_window,
         commitment.effective_next_expected_date as renewal_date,
         (
           (commitment.effective_next_expected_date - reminder.lead_days)::timestamp
           + make_interval(hours => p.send_hour_local)
         ) at time zone p.time_zone as scheduled_for
       from renewal_alert_preferences p
       join consent_grants consent
         on consent.id = p.consent_grant_id
        and consent.purpose = 'renewal-alerts'
        and consent.withdrawn_at is null
        and (consent.expires_at is null or consent.expires_at > now())
       join pg_timezone_names time_zone on time_zone.name = p.time_zone
         join recovery_commitments commitment
           on commitment.workspace_id = p.workspace_id
          and commitment.effective_status = 'ACTIVE'
          and commitment.effective_next_expected_date is not null
          and commitment.confidence_score >= ${renewalAlertMinimumConfidence}
         left join recovery_decisions decision
           on decision.workspace_id = commitment.workspace_id
          and decision.commitment_id = commitment.id
       cross join lateral (values
         ('7_day', 7, p.seven_day_enabled),
         ('1_day', 1, p.one_day_enabled)
       ) as reminder(alert_window, lead_days, enabled)
       where p.workspace_id = $1
         and p.enabled
         and reminder.enabled
         and decision.decision is distinct from 'KEEP'
     ), eligible as (
       select * from candidates where scheduled_for > now()
     )
     insert into renewal_alert_deliveries (
       workspace_id,
       user_id,
       preference_id,
       consent_grant_id,
       recurring_item_id,
      recovery_commitment_id,
       alert_window,
       renewal_date,
       scheduled_for,
       next_attempt_at
     )
     select
       workspace_id,
       user_id,
       preference_id,
       consent_grant_id,
      null,
      recovery_commitment_id,
       alert_window,
       renewal_date,
       scheduled_for,
       scheduled_for
     from eligible
     on conflict (preference_id, recovery_commitment_id, alert_window, renewal_date)
       where recovery_commitment_id is not null
     do update set
       consent_grant_id = excluded.consent_grant_id,
       scheduled_for = excluded.scheduled_for,
       status = case
         when renewal_alert_deliveries.status = 'cancelled'
           or renewal_alert_deliveries.consent_grant_id is distinct from excluded.consent_grant_id
         then 'scheduled'
         else renewal_alert_deliveries.status
       end,
       attempt_count = case
         when renewal_alert_deliveries.status = 'cancelled'
           or renewal_alert_deliveries.consent_grant_id is distinct from excluded.consent_grant_id
         then 0
         else renewal_alert_deliveries.attempt_count
       end,
       next_attempt_at = case
         when renewal_alert_deliveries.status = 'cancelled'
           or renewal_alert_deliveries.consent_grant_id is distinct from excluded.consent_grant_id
         then excluded.scheduled_for
         else renewal_alert_deliveries.next_attempt_at
       end,
       last_error_code = case
         when renewal_alert_deliveries.status = 'cancelled'
           or renewal_alert_deliveries.consent_grant_id is distinct from excluded.consent_grant_id
         then null
         else renewal_alert_deliveries.last_error_code
       end,
       last_error_at = case
         when renewal_alert_deliveries.status = 'cancelled'
           or renewal_alert_deliveries.consent_grant_id is distinct from excluded.consent_grant_id
         then null
         else renewal_alert_deliveries.last_error_at
       end,
       updated_at = now()
     where renewal_alert_deliveries.status in ('scheduled', 'failed', 'cancelled')
     returning id`,
    [workspaceId],
  );

  const cancelled = await queryable.query(
    `update renewal_alert_deliveries delivery
     set status = 'cancelled',
         next_attempt_at = null,
         locked_at = null,
         locked_by = null,
         updated_at = now()
     where delivery.workspace_id = $1
       and delivery.status in ('scheduled', 'failed', 'sending')
       and (
         delivery.recurring_item_id is not null
         or not exists (
         select 1
         from renewal_alert_preferences preference
         join consent_grants consent
           on consent.id = preference.consent_grant_id
          and consent.id = delivery.consent_grant_id
          and consent.purpose = 'renewal-alerts'
          and consent.withdrawn_at is null
          and (consent.expires_at is null or consent.expires_at > now())
         join recovery_commitments recovery
           on recovery.id = delivery.recovery_commitment_id
          and recovery.workspace_id = preference.workspace_id
          and recovery.effective_status = 'ACTIVE'
          and recovery.effective_next_expected_date = delivery.renewal_date
         left join recovery_decisions decision
           on decision.workspace_id = recovery.workspace_id
          and decision.commitment_id = recovery.id
         where preference.id = delivery.preference_id
           and preference.enabled
           and delivery.recovery_commitment_id is not null
           and recovery.confidence_score >= ${renewalAlertMinimumConfidence}
           and decision.decision is distinct from 'KEEP'
           and case delivery.alert_window
             when '7_day' then preference.seven_day_enabled
             when '1_day' then preference.one_day_enabled
             else false
           end
         )
       )`,
    [workspaceId],
  );

  return { touched: scheduled.rowCount ?? 0, cancelled: cancelled.rowCount ?? 0 };
}

export async function scheduleDueWeeklyDigests(client?: PoolClient) {
  const queryable = client ?? getDatabasePool();
  const scheduled = await queryable.query<{ id: string }>(
    `with digest_items as (${weeklyDigestItemsSql}), local_preferences as (
       select
         preference.*,
         (now() at time zone preference.time_zone) as local_now,
         date_trunc('week', now() at time zone preference.time_zone)::date as week_start
       from renewal_alert_preferences preference
       join consent_grants consent
         on consent.id = preference.consent_grant_id
        and consent.purpose = 'renewal-alerts'
        and consent.withdrawn_at is null
        and (consent.expires_at is null or consent.expires_at > now())
       join pg_timezone_names time_zone on time_zone.name = preference.time_zone
       where preference.weekly_digest_enabled
     ), candidates as (
       select
         preference.*,
         (preference.week_start::timestamp + make_interval(hours => preference.send_hour_local)) at time zone preference.time_zone as scheduled_for
       from local_preferences preference
       where extract(isodow from preference.local_now) = 1
         and exists (select 1 from digest_items item where item.workspace_id = preference.workspace_id)
     )
     insert into weekly_digest_deliveries (
       workspace_id,
       user_id,
       preference_id,
       consent_grant_id,
       week_start,
       scheduled_for,
       next_attempt_at
     )
     select
       workspace_id,
       user_id,
       id,
       consent_grant_id,
       week_start,
       scheduled_for,
       scheduled_for
     from candidates
     on conflict (preference_id, week_start) do nothing
     returning id`,
  );
  const cancelled = await cancelIneligibleWeeklyDigests(undefined, client);
  return { touched: scheduled.rowCount ?? 0, cancelled };
}

async function cancelIneligibleWeeklyDigests(workspaceId?: string, client?: PoolClient) {
  const queryable = client ?? getDatabasePool();
  const result = await queryable.query(
    `with digest_items as (${weeklyDigestItemsSql})
     update weekly_digest_deliveries delivery
     set status = 'cancelled',
         next_attempt_at = null,
         locked_at = null,
         locked_by = null,
         updated_at = now()
     where delivery.status in ('scheduled', 'failed')
       and ($1::uuid is null or delivery.workspace_id = $1)
       and not exists (
         select 1
         from renewal_alert_preferences preference
         join consent_grants consent
           on consent.id = preference.consent_grant_id
          and consent.id = delivery.consent_grant_id
          and consent.purpose = 'renewal-alerts'
          and consent.withdrawn_at is null
          and (consent.expires_at is null or consent.expires_at > now())
         where preference.id = delivery.preference_id
           and preference.weekly_digest_enabled
           and exists (select 1 from digest_items item where item.workspace_id = delivery.workspace_id)
       )`,
    [workspaceId ?? null],
  );
  return result.rowCount ?? 0;
}

export async function claimDueWeeklyDigests(input: { limit: number; workerId: string; invocation: "internal-api" | "cron" }): Promise<ClaimedWeeklyDigest[]> {
  const result = await getDatabasePool().query<{
    delivery_id: string;
    email: string;
    week_start: string;
    monthly_totals: Array<{ currency: string; minor: string }> | null;
    renewal_count: string;
    renewal_totals: Array<{ currency: string; minor: string }> | null;
    suggestion_merchant: string | null;
    suggestion_monthly_cost: string | null;
    suggestion_currency: string | null;
  }>(
    `with digest_items as (${weeklyDigestItemsSql}), due as (
       select delivery.id
       from weekly_digest_deliveries delivery
       join renewal_alert_preferences preference
         on preference.id = delivery.preference_id
        and preference.weekly_digest_enabled
        and preference.consent_grant_id = delivery.consent_grant_id
       join consent_grants consent
         on consent.id = delivery.consent_grant_id
        and consent.purpose = 'renewal-alerts'
        and consent.withdrawn_at is null
        and (consent.expires_at is null or consent.expires_at > now())
       join users recipient on recipient.id = delivery.user_id and recipient.deleted_at is null
       where delivery.attempt_count < $2
         and exists (select 1 from digest_items item where item.workspace_id = delivery.workspace_id)
         and (
           (delivery.status = 'scheduled' and delivery.scheduled_for <= now())
           or (delivery.status = 'failed' and delivery.next_attempt_at is not null and delivery.next_attempt_at <= now())
           or (delivery.status = 'sending' and delivery.locked_at < now() - interval '10 minutes')
         )
       order by coalesce(delivery.next_attempt_at, delivery.scheduled_for), delivery.created_at
       for update of delivery skip locked
       limit $1
     ), claimed as (
       update weekly_digest_deliveries delivery
       set status = 'sending',
           attempt_count = delivery.attempt_count + 1,
           last_invocation = $4,
           locked_at = now(),
           locked_by = $3,
           updated_at = now()
       from due
       where delivery.id = due.id
       returning delivery.*
     )
     select
       claimed.id as delivery_id,
       recipient.email,
       claimed.week_start::text,
      totals.monthly_totals,
       totals.renewal_count::text,
      totals.renewal_totals,
       suggestion.merchant as suggestion_merchant,
      suggestion.monthly_minor::text as suggestion_monthly_cost,
      suggestion.currency as suggestion_currency
     from claimed
     join users recipient on recipient.id = claimed.user_id and recipient.deleted_at is null
     join lateral (
       select
         coalesce((
           select jsonb_agg(jsonb_build_object('currency', monthly.currency, 'minor', monthly.minor) order by monthly.currency)
           from (
             select item_by_currency.currency, sum(item_by_currency.monthly_minor)::text as minor
             from digest_items item_by_currency
             where item_by_currency.workspace_id = claimed.workspace_id
             group by item_by_currency.currency
           ) monthly
         ), '[]'::jsonb) as monthly_totals,
         (select count(*) from digest_items item
          where item.workspace_id = claimed.workspace_id
            and item.next_expected_date >= claimed.week_start
            and item.next_expected_date < claimed.week_start + 7) as renewal_count,
         coalesce((
           select jsonb_agg(jsonb_build_object('currency', renewal.currency, 'minor', renewal.minor) order by renewal.currency)
           from (
             select item_by_currency.currency, sum(item_by_currency.amount_minor)::text as minor
             from digest_items item_by_currency
             where item_by_currency.workspace_id = claimed.workspace_id
               and item_by_currency.next_expected_date >= claimed.week_start
               and item_by_currency.next_expected_date < claimed.week_start + 7
             group by item_by_currency.currency
           ) renewal
         ), '[]'::jsonb) as renewal_totals
     ) totals on true
     left join lateral (
       select item.merchant, item.monthly_minor, item.currency
       from digest_items item
       where item.workspace_id = claimed.workspace_id
         and item.currency = 'INR'
         and item.confidence_score >= 80
         and item.user_decision is distinct from 'KEEP'
      order by item.monthly_minor desc, item.identity_key, item.id
       limit 1
     ) suggestion on true`,
    [Math.max(1, Math.min(input.limit, 25)), maxDeliveryAttempts, input.workerId, input.invocation],
  );

  return result.rows.map((row) => ({
    deliveryId: row.delivery_id,
    email: row.email,
    weekStart: row.week_start,
    monthlyTotals: (row.monthly_totals ?? []).map((total) => toMoneyDto(total.minor, total.currency)),
    renewalCountNext7Days: Number(row.renewal_count),
    renewalTotalsNext7Days: (row.renewal_totals ?? []).map((total) => toMoneyDto(total.minor, total.currency)),
    suggestion: row.suggestion_merchant && row.suggestion_monthly_cost !== null && row.suggestion_currency
      ? { merchant: row.suggestion_merchant, monthlyCost: toMoneyDto(row.suggestion_monthly_cost, row.suggestion_currency) }
      : null,
  }));
}

export async function claimDueRenewalAlerts(input: { limit: number; workerId: string; invocation: "internal-api" | "cron" }): Promise<ClaimedRenewalAlert[]> {
  const result = await getDatabasePool().query<{
    delivery_id: string;
    email: string;
    merchant: string;
    renewal_date: string;
    alert_window: RenewalAlertWindow;
  }>(
    `with due as (
       select delivery.id
       from renewal_alert_deliveries delivery
       join renewal_alert_preferences preference
         on preference.id = delivery.preference_id
        and preference.enabled
        and preference.consent_grant_id = delivery.consent_grant_id
       join consent_grants consent
         on consent.id = delivery.consent_grant_id
        and consent.purpose = 'renewal-alerts'
        and consent.withdrawn_at is null
        and (consent.expires_at is null or consent.expires_at > now())
       join users recipient
         on recipient.id = delivery.user_id
        and recipient.deleted_at is null
       join recovery_commitments recovery
         on recovery.id = delivery.recovery_commitment_id
        and recovery.workspace_id = delivery.workspace_id
        and recovery.effective_status = 'ACTIVE'
        and recovery.effective_next_expected_date = delivery.renewal_date
        and recovery.confidence_score >= ${renewalAlertMinimumConfidence}
       left join recovery_decisions decision
         on decision.workspace_id = recovery.workspace_id
        and decision.commitment_id = recovery.id
       where delivery.attempt_count < $2
         and delivery.recurring_item_id is null
         and decision.decision is distinct from 'KEEP'
         and case delivery.alert_window
           when '7_day' then preference.seven_day_enabled
           when '1_day' then preference.one_day_enabled
           else false
         end
         and (
           (delivery.status = 'scheduled' and delivery.scheduled_for <= now())
           or (delivery.status = 'failed' and delivery.next_attempt_at is not null and delivery.next_attempt_at <= now())
           or (delivery.status = 'sending' and delivery.locked_at < now() - interval '10 minutes')
         )
       order by coalesce(delivery.next_attempt_at, delivery.scheduled_for), delivery.created_at
       for update of delivery skip locked
       limit $1
     ), claimed as (
       update renewal_alert_deliveries delivery
       set status = 'sending',
           attempt_count = delivery.attempt_count + 1,
           last_invocation = $4,
           locked_at = now(),
           locked_by = $3,
           updated_at = now()
       from due
       where delivery.id = due.id
      returning delivery.id, delivery.user_id, delivery.recurring_item_id,
           delivery.recovery_commitment_id, delivery.renewal_date, delivery.alert_window
     )
     select
       claimed.id as delivery_id,
       recipient.email,
      recovery.effective_merchant as merchant,
       claimed.renewal_date::text,
       claimed.alert_window
     from claimed
    join users recipient on recipient.id = claimed.user_id and recipient.deleted_at is null
    join recovery_commitments recovery on recovery.id = claimed.recovery_commitment_id`,
    [Math.max(1, Math.min(input.limit, 25)), maxDeliveryAttempts, input.workerId, input.invocation],
  );

  return result.rows.map((row) => ({
    deliveryId: row.delivery_id,
    email: row.email,
    merchant: row.merchant,
    renewalDate: row.renewal_date,
    alertWindow: row.alert_window,
  }));
}

export async function isRenewalAlertStillDeliverable(deliveryId: string, workerId: string) {
  const result = await getDatabasePool().query<{ active: boolean }>(
    `select exists (
       select 1
       from renewal_alert_deliveries delivery
       join renewal_alert_preferences preference
         on preference.id = delivery.preference_id
        and preference.enabled
        and preference.consent_grant_id = delivery.consent_grant_id
       join consent_grants consent
         on consent.id = delivery.consent_grant_id
        and consent.purpose = 'renewal-alerts'
        and consent.withdrawn_at is null
        and (consent.expires_at is null or consent.expires_at > now())
       join users recipient on recipient.id = delivery.user_id and recipient.deleted_at is null
         join recovery_commitments recovery
           on recovery.id = delivery.recovery_commitment_id
          and recovery.workspace_id = delivery.workspace_id
          and recovery.effective_status = 'ACTIVE'
          and recovery.effective_next_expected_date = delivery.renewal_date
          and recovery.confidence_score >= ${renewalAlertMinimumConfidence}
         left join recovery_decisions decision
           on decision.workspace_id = recovery.workspace_id
          and decision.commitment_id = recovery.id
         where delivery.id = $1
           and delivery.status = 'sending'
           and delivery.locked_by = $2
           and delivery.recurring_item_id is null
           and decision.decision is distinct from 'KEEP'
         and case delivery.alert_window
           when '7_day' then preference.seven_day_enabled
           when '1_day' then preference.one_day_enabled
           else false
         end
     ) as active`,
    [deliveryId, workerId],
  );
  return Boolean(result.rows[0]?.active);
}

export async function markRenewalAlertSent(deliveryId: string, workerId: string) {
  await getDatabasePool().query(
    `update renewal_alert_deliveries
     set status = 'sent',
         sent_at = now(),
         next_attempt_at = null,
         locked_at = null,
         locked_by = null,
         last_error_code = null,
         last_error_at = null,
         updated_at = now()
     where id = $1
       and status = 'sending'
       and locked_by = $2`,
    [deliveryId, workerId],
  );
}

export async function markRenewalAlertCancelled(deliveryId: string, workerId: string) {
  await getDatabasePool().query(
    `update renewal_alert_deliveries
     set status = 'cancelled',
         next_attempt_at = null,
         locked_at = null,
         locked_by = null,
         updated_at = now()
     where id = $1
       and status = 'sending'
       and locked_by = $2`,
    [deliveryId, workerId],
  );
}

export async function markRenewalAlertFailed(input: {
  deliveryId: string;
  workerId: string;
  errorCode: RenewalAlertFailureCode;
  retryable: boolean;
}) {
  await getDatabasePool().query(
    `update renewal_alert_deliveries
     set status = 'failed',
         next_attempt_at = case
           when not $4 or attempt_count >= $5 then null
           else now() + case attempt_count
             when 1 then interval '5 minutes'
             when 2 then interval '15 minutes'
             when 3 then interval '1 hour'
             else interval '6 hours'
           end
         end,
         locked_at = null,
         locked_by = null,
         last_error_code = $3,
         last_error_at = now(),
         updated_at = now()
     where id = $1
       and status = 'sending'
       and locked_by = $2`,
    [input.deliveryId, input.workerId, input.errorCode, input.retryable, maxDeliveryAttempts],
  );
}

export async function isWeeklyDigestStillDeliverable(deliveryId: string, workerId: string) {
  const result = await getDatabasePool().query<{ active: boolean }>(
    `with digest_items as (${weeklyDigestItemsSql})
     select exists (
       select 1
       from weekly_digest_deliveries delivery
       join renewal_alert_preferences preference
         on preference.id = delivery.preference_id
        and preference.weekly_digest_enabled
        and preference.consent_grant_id = delivery.consent_grant_id
       join consent_grants consent
         on consent.id = delivery.consent_grant_id
        and consent.purpose = 'renewal-alerts'
        and consent.withdrawn_at is null
        and (consent.expires_at is null or consent.expires_at > now())
       join users recipient on recipient.id = delivery.user_id and recipient.deleted_at is null
       where delivery.id = $1
         and delivery.status = 'sending'
         and delivery.locked_by = $2
         and exists (select 1 from digest_items item where item.workspace_id = delivery.workspace_id)
     ) as active`,
    [deliveryId, workerId],
  );
  return Boolean(result.rows[0]?.active);
}

export async function markWeeklyDigestSent(deliveryId: string, workerId: string) {
  await getDatabasePool().query(
    `update weekly_digest_deliveries
     set status = 'sent', sent_at = now(), next_attempt_at = null,
         locked_at = null, locked_by = null, last_error_code = null,
         last_error_at = null, updated_at = now()
     where id = $1 and status = 'sending' and locked_by = $2`,
    [deliveryId, workerId],
  );
}

export async function markWeeklyDigestCancelled(deliveryId: string, workerId: string) {
  await getDatabasePool().query(
    `update weekly_digest_deliveries
     set status = 'cancelled', next_attempt_at = null,
         locked_at = null, locked_by = null, updated_at = now()
     where id = $1 and status = 'sending' and locked_by = $2`,
    [deliveryId, workerId],
  );
}

export async function markWeeklyDigestFailed(input: {
  deliveryId: string;
  workerId: string;
  errorCode: RenewalAlertFailureCode;
  retryable: boolean;
}) {
  await getDatabasePool().query(
    `update weekly_digest_deliveries
     set status = 'failed',
         next_attempt_at = case
           when not $4 or attempt_count >= $5 then null
           else now() + case attempt_count
             when 1 then interval '5 minutes'
             when 2 then interval '15 minutes'
             when 3 then interval '1 hour'
             else interval '6 hours'
           end
         end,
         locked_at = null,
         locked_by = null,
         last_error_code = $3,
         last_error_at = now(),
         updated_at = now()
     where id = $1 and status = 'sending' and locked_by = $2`,
    [input.deliveryId, input.workerId, input.errorCode, input.retryable, maxDeliveryAttempts],
  );
}

async function readPreferenceRow(
  workspaceId: string,
  userId: string,
  client?: PoolClient,
  forUpdate = false,
) {
  const queryable = client ?? getDatabasePool();
  const result = await queryable.query<PreferenceRow>(
    `select
       preference.id,
       preference.workspace_id,
       preference.user_id,
       preference.consent_grant_id,
       preference.enabled,
       preference.weekly_digest_enabled,
       preference.seven_day_enabled,
       preference.one_day_enabled,
       preference.time_zone,
       preference.send_hour_local,
       preference.updated_at,
       consent.granted_at as consent_granted_at,
       consent.withdrawn_at as consent_withdrawn_at,
       consent.expires_at as consent_expires_at,
       coalesce(
         consent.purpose = 'renewal-alerts'
         and consent.withdrawn_at is null
         and (consent.expires_at is null or consent.expires_at > now()),
         false
       ) as consent_active
     from renewal_alert_preferences preference
     left join consent_grants consent on consent.id = preference.consent_grant_id
     where preference.workspace_id = $1
       and preference.user_id = $2
     ${forUpdate ? "for update of preference" : ""}`,
    [workspaceId, userId],
  );
  return result.rows[0] ?? null;
}

function mapPreference(row: PreferenceRow | null) {
  if (!row) {
    return {
      enabled: false,
      weeklyDigestEnabled: false,
      sevenDayEnabled: true,
      oneDayEnabled: true,
      timeZone: "UTC",
      sendHourLocal: 9,
      updatedAt: null,
      disabledReason: null,
      consent: {
        purpose: renewalAlertConsentPurpose,
        active: false,
        grantId: null,
        grantedAt: null,
        withdrawnAt: null,
        expiresAt: null,
      },
    };
  }

  const consentActive = Boolean(row.consent_active);
  return {
    enabled: row.enabled && consentActive,
    weeklyDigestEnabled: row.weekly_digest_enabled && consentActive,
    sevenDayEnabled: row.seven_day_enabled,
    oneDayEnabled: row.one_day_enabled,
    timeZone: row.time_zone,
    sendHourLocal: row.send_hour_local,
    updatedAt: row.updated_at.toISOString(),
    disabledReason: (row.enabled || row.weekly_digest_enabled) && !consentActive ? "consent-withdrawn" : null,
    consent: {
      purpose: renewalAlertConsentPurpose,
      active: consentActive,
      grantId: row.consent_grant_id,
      grantedAt: row.consent_granted_at?.toISOString() ?? null,
      withdrawnAt: row.consent_withdrawn_at?.toISOString() ?? null,
      expiresAt: row.consent_expires_at?.toISOString() ?? null,
    },
  };
}
