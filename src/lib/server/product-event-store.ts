import "server-only";

import type { PoolClient } from "pg";
import { normalizeProductEvent, type ProductEventInput } from "@/lib/product-events";
import { getDatabasePool } from "@/lib/server/database";

export async function recordProductEvent(input: ProductEventInput, client?: PoolClient) {
  const event = normalizeProductEvent(input);
  const queryable = client ?? getDatabasePool();
  const result = await queryable.query<{ id: string }>(
    `insert into product_events (
       workspace_id,
       user_id,
       event_name,
       occurred_at,
       source,
       status,
       duration_ms,
       metrics
     ) values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id`,
    [
      event.workspaceId,
      event.userId,
      event.eventName,
      event.occurredAt,
      event.source,
      event.status,
      event.durationMs,
      event.metrics,
    ],
  );

  const id = result.rows[0]?.id;
  if (!id) throw new Error("Product event insert did not return an id.");
  return { id };
}

export async function recordConsentedProductEvent(input: ProductEventInput, client?: PoolClient) {
  const event = normalizeProductEvent(input);
  if (!event.workspaceId) throw new Error("Consented product events require a workspace.");
  const queryable = client ?? getDatabasePool();
  const result = await queryable.query<{ id: string | null; consent_current: boolean }>(
    `with active_consent as materialized (
       select consent.user_id
       from consent_grants consent
       where consent.workspace_id = $1
         and ($2::uuid is null or consent.user_id = $2)
         and consent.purpose = 'product-analytics-opt-in'
         and consent.withdrawn_at is null
         and (consent.expires_at is null or consent.expires_at > now())
       order by consent.granted_at desc, consent.id desc
       limit 1
       for share
     ), inserted as (
       insert into product_events (
         workspace_id, user_id, event_name, occurred_at, source, status, duration_ms, metrics
       )
       select $1, coalesce($2::uuid, active_consent.user_id), $3, $4, $5, $6, $7, $8
       from active_consent
       on conflict do nothing
       returning id
     )
     select (select id from inserted) as id,
            exists(select 1 from active_consent) as consent_current`,
    [
      event.workspaceId,
      event.userId,
      event.eventName,
      event.occurredAt,
      event.source,
      event.status,
      event.durationMs,
      event.metrics,
    ],
  );
  const row = result.rows[0];
  return { id: row?.id ?? null, recorded: Boolean(row?.id), consentCurrent: row?.consent_current === true };
}

export async function recordWorkspaceReturnOnce(input: {
  workspaceId: string;
  userId: string;
}, client?: PoolClient) {
  const event = normalizeProductEvent({
    ...input,
    eventName: "workspace.returned",
    source: "workspace-api",
    status: "succeeded",
  });
  const queryable = client ?? getDatabasePool();
  const result = await queryable.query<{ id: string | null }>(
    `with active_consent as materialized (
       select consent.id
       from consent_grants consent
       where consent.workspace_id = $1 and consent.user_id = $2
         and consent.purpose = 'product-analytics-opt-in'
         and consent.withdrawn_at is null
         and (consent.expires_at is null or consent.expires_at > now())
       order by consent.granted_at desc, consent.id desc
       limit 1
       for share
     ), prior_activation as (
       select 1
       from product_events activation
       where activation.workspace_id = $1
         and activation.event_name = 'workspace.activated'
         and activation.occurred_at < (
           date_trunc('day', $4::timestamptz at time zone 'Asia/Kolkata')
           at time zone 'Asia/Kolkata'
         )
       limit 1
     ), inserted as (
       insert into product_events (
         workspace_id, user_id, event_name, occurred_at, source, status, duration_ms, metrics
       )
       select $1, $2, $3, $4, $5, $6, $7, $8
       from active_consent, prior_activation
       on conflict do nothing
       returning id
     )
     select (select id from inserted) as id`,
    [
      event.workspaceId,
      event.userId,
      event.eventName,
      event.occurredAt,
      event.source,
      event.status,
      event.durationMs,
      event.metrics,
    ],
  );
  return { id: result.rows[0]?.id ?? null, recorded: Boolean(result.rows[0]?.id) };
}

export const workspaceActivationSemanticVersion = 1;

export async function recordWorkspaceActivationOnce(input: {
  workspaceId: string;
  userId: string;
  commitmentsTouched: number;
  evidenceWritten: number;
}, client?: PoolClient) {
  const event = normalizeProductEvent({
    workspaceId: input.workspaceId,
    userId: input.userId,
    eventName: "workspace.activated",
    source: "workspace-api",
    status: "succeeded",
    metrics: {
      commitmentsTouched: input.commitmentsTouched,
      evidenceWritten: input.evidenceWritten,
    },
  });
  const queryable = client ?? getDatabasePool();
  const result = await queryable.query<{ id: string | null; consent_current: boolean }>(
    `with active_consent as materialized (
       select consent.id
       from consent_grants consent
       where consent.workspace_id = $1
         and consent.user_id = $2
         and consent.purpose = 'product-analytics-opt-in'
         and consent.withdrawn_at is null
         and (consent.expires_at is null or consent.expires_at > now())
       order by consent.granted_at desc, consent.id desc
       limit 1
      for share
     ), setup_start as (
       select min(alias.created_at) as started_at
       from recovery_inbound_aliases alias
       where alias.workspace_id = $1
     ), inserted as (
       insert into product_events (
         workspace_id,
         user_id,
         event_name,
         occurred_at,
         source,
         status,
         duration_ms,
         metrics,
         activation_semantic_version
       )
       select $1, $2, $3, $4, $5, $6, $7,
              case
                when setup_start.started_at is null then $8::jsonb
                else $8::jsonb || jsonb_build_object(
                  'secondsToTrustworthyPicture',
                  least(1000000000, greatest(0, floor(extract(epoch from ($4::timestamptz - setup_start.started_at)))))
                )
              end,
              $9
       from active_consent cross join setup_start
       on conflict (workspace_id) where event_name = 'workspace.activated' and workspace_id is not null
       do nothing
       returning id
     )
     select (select id from inserted) as id,
            exists(select 1 from active_consent) as consent_current`,
    [
      event.workspaceId,
      event.userId,
      event.eventName,
      event.occurredAt,
      event.source,
      event.status,
      event.durationMs,
      event.metrics,
      workspaceActivationSemanticVersion,
    ],
  );
  const row = result.rows[0];
  const id = row?.id ?? null;
  return { id, recorded: Boolean(id), consentCurrent: row?.consent_current === true };
}
