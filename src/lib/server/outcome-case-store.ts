import "server-only";

import type { PoolClient } from "pg";
import {
  buildAuthorizationText,
  calculateOutcomeFeeMinor,
  canTransitionActionCase,
  getConciergeEligibility,
  hashAuthorizationText,
  normalizeActionCaseIdempotencyKey,
  outcomeOffer,
  type ActionCaseActor,
  type ActionCaseStatus,
  type ConciergeAction,
} from "@/lib/outcome-cases";
import { appendLedgerEvent } from "@/lib/server/ledger-event-store";
import { getDatabasePool } from "@/lib/server/database";

const verifiableFrequencies = new Set(["weekly", "biweekly", "semimonthly", "monthly", "bimonthly", "quarterly", "yearly"]);

type ActionCaseRow = {
  id: string;
  workspace_id: string;
  recurring_item_id: string;
  requested_by_user_id: string;
  action: ConciergeAction;
  commitment_class: string;
  status: ActionCaseStatus;
  merchant: string;
  category: string;
  currency: string;
  frequency: string;
  baseline_monthly_amount: string;
  baseline_annual_amount: string;
  target_monthly_amount: string | null;
  maximum_success_fee_minor: string;
  failure_code: string | null;
  authorized_at: Date | null;
  execution_started_at: Date | null;
  executed_at: Date | null;
  verification_started_at: Date | null;
  verified_at: Date | null;
  withdrawn_at: Date | null;
  disputed_at: Date | null;
  created_at: Date;
  updated_at: Date;
  authorization_id: string | null;
  authorization_terms_version: string | null;
  receipt_id: string | null;
  verified_annual_saving: string | null;
  invoice_id: string | null;
  invoice_status: string | null;
  invoice_amount_minor: string | null;
};

export class ActionCaseConflictError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "ActionCaseConflictError";
  }
}

export class ActionCaseNotFoundError extends Error {
  constructor() {
    super("Action case was not found in this workspace.");
    this.name = "ActionCaseNotFoundError";
  }
}

export class ActionCaseValidationError extends Error {
  constructor(message: string, readonly code = "invalid-action-case") {
    super(message);
    this.name = "ActionCaseValidationError";
  }
}

export async function listWorkspaceActionCases(workspaceId: string) {
  const result = await getDatabasePool().query<ActionCaseRow>(actionCaseSelectSql(
    "where action_case.workspace_id = $1 order by action_case.updated_at desc, action_case.id desc limit 250",
  ), [workspaceId]);
  return result.rows.map(mapActionCase).map((actionCase) => ({
    ...actionCase,
    authorizationPreview: actionCase.status === "awaiting-authorization" ? buildAuthorizationPreview(actionCase) : null,
  }));
}

export async function getWorkspaceActionCase(workspaceId: string, actionCaseId: string) {
  const result = await getDatabasePool().query<ActionCaseRow>(actionCaseSelectSql(
    "where action_case.workspace_id = $1 and action_case.id = $2",
  ), [workspaceId, actionCaseId]);
  if (!result.rows[0]) return null;
  const actionCase = mapActionCase(result.rows[0]);
  return {
    ...actionCase,
    authorizationPreview: actionCase.status === "awaiting-authorization" ? buildAuthorizationPreview(actionCase) : null,
  };
}

export async function createWorkspaceActionCase(input: {
  workspaceId: string;
  recurringItemId: string;
  requestedByUserId: string;
  action: ConciergeAction;
  targetMonthlyAmount?: number | null;
  idempotencyKey: string;
}) {
  const idempotencyKey = normalizeActionCaseIdempotencyKey(input.idempotencyKey);
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    const itemResult = await client.query<{
      id: string; merchant: string; category: string; frequency: string; currency: string;
      next_expected_date: Date | string | null;
      monthly_cost: string; annual_cost: string;
    }>(
      `select id, merchant, category, frequency, currency, next_expected_date,
              monthly_cost::text, annual_cost::text
       from recurring_items
       where workspace_id = $1 and id = $2
       for update`,
      [input.workspaceId, input.recurringItemId],
    );
    const item = itemResult.rows[0];
    if (!item) throw new ActionCaseNotFoundError();
    const eligibility = getConciergeEligibility(item.category, input.action);
    if (!eligibility.eligible) {
      throw new ActionCaseValidationError(
        `Concierge execution is unavailable for this commitment class. ${eligibility.guidance}`,
        eligibility.reasonCode,
      );
    }
    if (!verifiableFrequencies.has(item.frequency)) {
      throw new ActionCaseValidationError(
        "This commitment has no stable verification cadence yet. Add enough evidence to prove its recurrence before authorizing execution.",
        "unverifiable-cadence",
      );
    }
    if (!item.next_expected_date) {
      throw new ActionCaseValidationError(
        "The next expected debit is not proven yet. Add fresh evidence before authorizing execution.",
        "missing-next-debit",
      );
    }
    const baselineMonthly = Number(item.monthly_cost);
    const baselineAnnual = Number(item.annual_cost);
    if (!Number.isFinite(baselineMonthly) || baselineMonthly <= 0 || !Number.isFinite(baselineAnnual) || baselineAnnual <= 0) {
      throw new ActionCaseValidationError("The commitment baseline is not valid enough for outcome pricing.", "invalid-baseline");
    }
    const targetMonthlyAmount = normalizeTargetMonthlyAmount(input.targetMonthlyAmount, baselineMonthly, input.action);
    const maximumSuccessFeeMinor = calculateOutcomeFeeMinor(baselineAnnual);
    const inserted = await client.query<{ id: string }>(
      `insert into action_cases (
         workspace_id, recurring_item_id, requested_by_user_id, action,
         commitment_class, currency, baseline_monthly_amount,
         baseline_annual_amount, target_monthly_amount,
         maximum_success_fee_minor, idempotency_key
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (workspace_id, idempotency_key) do nothing
       returning id`,
      [
        input.workspaceId,
        input.recurringItemId,
        input.requestedByUserId,
        input.action,
        eligibility.commitmentClass,
        item.currency,
        baselineMonthly,
        baselineAnnual,
        targetMonthlyAmount,
        maximumSuccessFeeMinor,
        idempotencyKey,
      ],
    );
    let actionCaseId = inserted.rows[0]?.id;
    if (!actionCaseId) {
      const replay = await client.query<{
        id: string; recurring_item_id: string; requested_by_user_id: string; action: ConciergeAction;
        target_monthly_amount: string | null;
      }>(
        `select id, recurring_item_id, requested_by_user_id, action, target_monthly_amount::text
         from action_cases where workspace_id = $1 and idempotency_key = $2`,
        [input.workspaceId, idempotencyKey],
      );
      const existing = replay.rows[0];
      if (!existing
        || existing.recurring_item_id !== input.recurringItemId
        || existing.requested_by_user_id !== input.requestedByUserId
        || existing.action !== input.action
        || nullableNumber(existing.target_monthly_amount) !== targetMonthlyAmount) {
        throw new ActionCaseConflictError("The Idempotency-Key is already bound to a different action request.", "idempotency-conflict");
      }
      actionCaseId = existing.id;
      await client.query("commit");
      const actionCase = await getWorkspaceActionCase(input.workspaceId, actionCaseId);
      if (!actionCase) throw new ActionCaseNotFoundError();
      return { created: false, actionCase, authorizationPreview: buildAuthorizationPreview(actionCase) };
    }

    await client.query(
      `insert into action_case_events (
         workspace_id, action_case_id, previous_status, status,
         actor_kind, actor_user_id, reason_code, idempotency_key
       ) values ($1, $2, null, 'awaiting-authorization', 'customer', $3, 'case-requested', $4)`,
      [input.workspaceId, actionCaseId, input.requestedByUserId, `case-event:${actionCaseId}:created`],
    );
    await materializeActionProofNode(client, input.workspaceId, input.recurringItemId, actionCaseId);
    const ledgerEvent = await appendLedgerEvent({
      workspaceId: input.workspaceId,
      actorUserId: input.requestedByUserId,
      eventType: "action.case.created",
      entityKind: "action",
      entityRef: actionCaseId,
      idempotencyKey: `case-created:${actionCaseId}`,
      payload: {
        action: input.action,
        status: "awaiting-authorization",
        currency: item.currency,
        annualSaving: baselineAnnual,
      },
    }, client);
    await client.query(
      `insert into audit_log (workspace_id, user_id, action, entity_type, entity_id, metadata)
       values ($1, $2, 'concierge.case.created', 'action_case', $3,
               jsonb_build_object('ledgerEventId', $4::text, 'action', $5::text))`,
      [input.workspaceId, input.requestedByUserId, actionCaseId, ledgerEvent.id, input.action],
    );
    await client.query("commit");
    const actionCase = await getWorkspaceActionCase(input.workspaceId, actionCaseId);
    if (!actionCase) throw new ActionCaseNotFoundError();
    return { created: true, actionCase, authorizationPreview: buildAuthorizationPreview(actionCase) };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function authorizeWorkspaceActionCase(input: {
  workspaceId: string;
  actionCaseId: string;
  authorizedByUserId: string;
  termsVersion: string;
  idempotencyKey: string;
}) {
  const idempotencyKey = normalizeActionCaseIdempotencyKey(input.idempotencyKey);
  const authorizationEventKey = `authorization:${idempotencyKey}`;
  if (input.termsVersion !== outcomeOffer.termsVersion) {
    throw new ActionCaseConflictError("The concierge terms changed. Review the current authorization before continuing.", "terms-version-mismatch");
  }
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    const row = await loadActionCaseForUpdate(client, input.workspaceId, input.actionCaseId);
    if (!row) throw new ActionCaseNotFoundError();
    const replay = await client.query<{ action_case_id: string }>(
      `select action_case_id from action_case_events where workspace_id = $1 and idempotency_key = $2`,
      [input.workspaceId, authorizationEventKey],
    );
    if (replay.rows[0]?.action_case_id === input.actionCaseId) {
      await client.query("commit");
      const actionCase = await getWorkspaceActionCase(input.workspaceId, input.actionCaseId);
      if (!actionCase) throw new ActionCaseNotFoundError();
      return { authorized: true, idempotentReplay: true, actionCase };
    }
    if (row.status !== "awaiting-authorization") {
      throw new ActionCaseConflictError("This action case is not waiting for authorization.", "invalid-status");
    }
    const sequenceResult = await client.query<{ next_sequence: number }>(
      `select coalesce(max(authorization_version), 0)::int + 1 as next_sequence
       from action_authorizations where action_case_id = $1`,
      [input.actionCaseId],
    );
    const authorizationSequence = sequenceResult.rows[0]?.next_sequence ?? 1;
    const authorizationText = buildAuthorizationText({
      merchant: row.merchant,
      action: row.action,
      currency: row.currency,
      maximumSuccessFeeMinor: Number(row.maximum_success_fee_minor),
      authorizationSequence,
    });
    const authorization = await client.query<{ id: string; authorized_at: Date }>(
      `insert into action_authorizations (
         workspace_id, action_case_id, authorized_by_user_id, action, scope,
         authorization_version, terms_version, authorization_text, authorization_text_hash,
         success_fee_basis_points, minimum_fee_minor, maximum_fee_minor
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       returning id, authorized_at`,
      [
        input.workspaceId,
        input.actionCaseId,
        input.authorizedByUserId,
        row.action,
        outcomeOffer.authorizationScope,
        authorizationSequence,
        outcomeOffer.termsVersion,
        authorizationText,
        hashAuthorizationText(authorizationText),
        outcomeOffer.successFeeBasisPoints,
        outcomeOffer.minimumFeeMinor,
        Number(row.maximum_success_fee_minor),
      ],
    );
    await client.query(
      `update action_cases
       set status = 'authorized', authorized_at = now(), failure_code = null, updated_at = now()
       where workspace_id = $1 and id = $2`,
      [input.workspaceId, input.actionCaseId],
    );
    await client.query(
      `insert into action_case_events (
         workspace_id, action_case_id, previous_status, status,
         actor_kind, actor_user_id, reason_code, idempotency_key
       ) values ($1, $2, 'awaiting-authorization', 'authorized', 'customer', $3,
                 'explicit-authorization', $4)`,
      [input.workspaceId, input.actionCaseId, input.authorizedByUserId, authorizationEventKey],
    );
    await appendLedgerEvent({
      workspaceId: input.workspaceId,
      actorUserId: input.authorizedByUserId,
      eventType: "action.authorization.recorded",
      entityKind: "action",
      entityRef: input.actionCaseId,
      idempotencyKey: `authorization:${authorization.rows[0].id}`,
      payload: {
        authorizedAction: row.action,
        authorizationVersion: authorizationSequence,
        status: "authorized",
      },
    }, client);
    await appendLedgerEvent({
      workspaceId: input.workspaceId,
      actorUserId: input.authorizedByUserId,
      eventType: "action.case.transitioned",
      entityKind: "action",
      entityRef: input.actionCaseId,
      idempotencyKey: `case-transition:${input.actionCaseId}:authorized:${authorizationSequence}`,
      payload: { previousStatus: "awaiting-authorization", status: "authorized", reasonCode: "explicit-authorization" },
    }, client);
    await client.query(
      `insert into audit_log (workspace_id, user_id, action, entity_type, entity_id, metadata)
       values ($1, $2, 'concierge.authorization.recorded', 'action_case', $3,
               jsonb_build_object('authorizationId', $4::text, 'termsVersion', $5::text))`,
      [input.workspaceId, input.authorizedByUserId, input.actionCaseId, authorization.rows[0].id, outcomeOffer.termsVersion],
    );
    await client.query("commit");
    const actionCase = await getWorkspaceActionCase(input.workspaceId, input.actionCaseId);
    if (!actionCase) throw new ActionCaseNotFoundError();
    return { authorized: true, idempotentReplay: false, actionCase };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function transitionWorkspaceActionCase(input: {
  workspaceId: string;
  actionCaseId: string;
  nextStatus: ActionCaseStatus;
  actorKind: ActionCaseActor;
  actorUserId?: string | null;
  reasonCode: string;
  idempotencyKey: string;
}) {
  const idempotencyKey = normalizeActionCaseIdempotencyKey(input.idempotencyKey);
  const transitionEventKey = `transition:${idempotencyKey}`;
  const reasonCode = normalizeReasonCode(input.reasonCode);
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    const row = await loadActionCaseForUpdate(client, input.workspaceId, input.actionCaseId);
    if (!row) throw new ActionCaseNotFoundError();
    const replay = await client.query<{ status: ActionCaseStatus }>(
      `select status from action_case_events where workspace_id = $1 and idempotency_key = $2`,
      [input.workspaceId, transitionEventKey],
    );
    if (replay.rows[0]) {
      if (replay.rows[0].status !== input.nextStatus) {
        throw new ActionCaseConflictError("The Idempotency-Key is already bound to another transition.", "idempotency-conflict");
      }
      await client.query("commit");
      const actionCase = await getWorkspaceActionCase(input.workspaceId, input.actionCaseId);
      if (!actionCase) throw new ActionCaseNotFoundError();
      return { transitioned: false, idempotentReplay: true, actionCase };
    }
    if (!canTransitionActionCase(row.status, input.nextStatus, input.actorKind)) {
      throw new ActionCaseConflictError(
        `${input.actorKind} cannot transition an action case from ${row.status} to ${input.nextStatus}.`,
        "invalid-transition",
      );
    }
    await client.query(
      `update action_cases
       set status = $3,
           execution_started_at = case when $3 = 'in-progress' then coalesce(execution_started_at, now()) else execution_started_at end,
           executed_at = case when $3 = 'executed' then coalesce(executed_at, now()) else executed_at end,
           verification_started_at = case when $3 = 'verifying' then coalesce(verification_started_at, now()) else verification_started_at end,
           verified_at = case when $3 = 'verified' then coalesce(verified_at, now()) else verified_at end,
           withdrawn_at = case when $3 = 'withdrawn' then coalesce(withdrawn_at, now()) else withdrawn_at end,
           disputed_at = case when $3 = 'disputed' then coalesce(disputed_at, now()) else disputed_at end,
           failure_code = case when $3 = 'failed' then $4 else null end,
           updated_at = now()
       where workspace_id = $1 and id = $2`,
      [input.workspaceId, input.actionCaseId, input.nextStatus, input.nextStatus === "failed" ? reasonCode : null],
    );
    if (input.nextStatus === "withdrawn") {
      await client.query(
        `update action_authorizations set revoked_at = now()
         where action_case_id = $1 and revoked_at is null`,
        [input.actionCaseId],
      );
    }
    if (input.nextStatus === "disputed") {
      await client.query(
        `update verified_saving_receipts set status = 'disputed', updated_at = now()
         where action_case_id = $1 and status = 'active'`,
        [input.actionCaseId],
      );
      await client.query(
        `update success_fee_invoices set status = 'disputed', disputed_at = now(), updated_at = now()
         where action_case_id = $1 and status not in ('paid', 'refunded', 'void')`,
        [input.actionCaseId],
      );
    }
    await client.query(
      `insert into action_case_events (
         workspace_id, action_case_id, previous_status, status,
         actor_kind, actor_user_id, reason_code, idempotency_key
       ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [input.workspaceId, input.actionCaseId, row.status, input.nextStatus, input.actorKind, input.actorUserId ?? null, reasonCode, transitionEventKey],
    );
    await appendLedgerEvent({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId ?? null,
      eventType: "action.case.transitioned",
      entityKind: "action",
      entityRef: input.actionCaseId,
      idempotencyKey: `case-ledger:${idempotencyKey}`,
      payload: { previousStatus: row.status, status: input.nextStatus, reasonCode },
    }, client);
    await client.query(
      `insert into audit_log (workspace_id, user_id, action, entity_type, entity_id, metadata)
       values ($1, $2, 'concierge.case.transitioned', 'action_case', $3,
               jsonb_build_object('previousStatus', $4::text, 'status', $5::text,
                                  'actorKind', $6::text, 'reasonCode', $7::text))`,
      [input.workspaceId, input.actorUserId ?? null, input.actionCaseId, row.status, input.nextStatus, input.actorKind, reasonCode],
    );
    await client.query("commit");
    const actionCase = await getWorkspaceActionCase(input.workspaceId, input.actionCaseId);
    if (!actionCase) throw new ActionCaseNotFoundError();
    return { transitioned: true, idempotentReplay: false, actionCase };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function materializeActionProofNode(
  client: PoolClient,
  workspaceId: string,
  recurringItemId: string,
  actionCaseId: string,
) {
  await client.query(
    `insert into proof_nodes (workspace_id, kind, entity_ref)
     values ($1, 'commitment', $2), ($1, 'action', $3)
     on conflict (workspace_id, kind, entity_ref)
     do update set status = 'active', retired_at = null`,
    [workspaceId, recurringItemId, actionCaseId],
  );
  await client.query(
    `insert into proof_edges (workspace_id, from_node_id, to_node_id, edge_type)
     select $1, commitment.id, action_node.id, 'resolved_to'
     from proof_nodes commitment
     join proof_nodes action_node on action_node.workspace_id = commitment.workspace_id
       and action_node.kind = 'action' and action_node.entity_ref = $3
     where commitment.workspace_id = $1
       and commitment.kind = 'commitment' and commitment.entity_ref = $2
     on conflict (workspace_id, from_node_id, to_node_id, edge_type) where valid_to is null do nothing`,
    [workspaceId, recurringItemId, actionCaseId],
  );
}

async function loadActionCaseForUpdate(client: PoolClient, workspaceId: string, actionCaseId: string) {
  const result = await client.query<ActionCaseRow>(actionCaseSelectSql(
    "where action_case.workspace_id = $1 and action_case.id = $2 for update of action_case",
  ), [workspaceId, actionCaseId]);
  return result.rows[0] ?? null;
}

function actionCaseSelectSql(suffix: string) {
  return `select
    action_case.id, action_case.workspace_id, action_case.recurring_item_id,
    action_case.requested_by_user_id, action_case.action, action_case.commitment_class,
    action_case.status, item.merchant, item.category, item.frequency,
    action_case.currency, action_case.baseline_monthly_amount::text,
    action_case.baseline_annual_amount::text, action_case.target_monthly_amount::text,
    action_case.maximum_success_fee_minor::text, action_case.failure_code,
    action_case.authorized_at, action_case.execution_started_at, action_case.executed_at,
    action_case.verification_started_at, action_case.verified_at,
    action_case.withdrawn_at, action_case.disputed_at,
    action_case.created_at, action_case.updated_at,
    auth_record.id as authorization_id,
    auth_record.terms_version as authorization_terms_version,
    receipt.id as receipt_id, receipt.verified_annual_saving::text,
    invoice.id as invoice_id, invoice.status as invoice_status,
    invoice.amount_minor::text as invoice_amount_minor
  from action_cases action_case
  join recurring_items item on item.id = action_case.recurring_item_id
  left join lateral (
    select id, terms_version
    from action_authorizations
    where action_case_id = action_case.id and revoked_at is null
    order by authorized_at desc, id desc limit 1
  ) auth_record on true
  left join lateral (
    select id, verified_annual_saving
    from verified_saving_receipts
    where action_case_id = action_case.id and status in ('active', 'disputed')
    order by minted_at desc, id desc limit 1
  ) receipt on true
  left join lateral (
    select id, status, amount_minor
    from success_fee_invoices
    where action_case_id = action_case.id
    order by created_at desc, id desc limit 1
  ) invoice on true
  ${suffix}`;
}

function mapActionCase(row: ActionCaseRow) {
  return {
    id: row.id,
    recurringItemId: row.recurring_item_id,
    requestedByUserId: row.requested_by_user_id,
    action: row.action,
    commitmentClass: row.commitment_class,
    status: row.status,
    merchant: row.merchant,
    category: row.category,
    frequency: row.frequency,
    currency: row.currency,
    baselineMonthlyAmount: Number(row.baseline_monthly_amount),
    baselineAnnualAmount: Number(row.baseline_annual_amount),
    targetMonthlyAmount: nullableNumber(row.target_monthly_amount),
    maximumSuccessFeeMinor: Number(row.maximum_success_fee_minor),
    failureCode: row.failure_code,
    authorization: row.authorization_id ? {
      id: row.authorization_id,
      termsVersion: row.authorization_terms_version,
      authorizedAt: row.authorized_at?.toISOString() ?? null,
    } : null,
    receipt: row.receipt_id ? {
      id: row.receipt_id,
      verifiedAnnualSaving: Number(row.verified_annual_saving),
    } : null,
    invoice: row.invoice_id ? {
      id: row.invoice_id,
      status: row.invoice_status,
      amountMinor: Number(row.invoice_amount_minor),
    } : null,
    executionStartedAt: row.execution_started_at?.toISOString() ?? null,
    executedAt: row.executed_at?.toISOString() ?? null,
    verificationStartedAt: row.verification_started_at?.toISOString() ?? null,
    verifiedAt: row.verified_at?.toISOString() ?? null,
    withdrawnAt: row.withdrawn_at?.toISOString() ?? null,
    disputedAt: row.disputed_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function buildAuthorizationPreview(actionCase: ReturnType<typeof mapActionCase>) {
  return {
    scope: outcomeOffer.authorizationScope,
    termsVersion: outcomeOffer.termsVersion,
    authorizationVersion: outcomeOffer.authorizationVersion,
    successFeeBasisPoints: outcomeOffer.successFeeBasisPoints,
    maximumSuccessFeeMinor: actionCase.maximumSuccessFeeMinor,
    text: buildAuthorizationText({
      merchant: actionCase.merchant,
      action: actionCase.action,
      currency: actionCase.currency,
      maximumSuccessFeeMinor: actionCase.maximumSuccessFeeMinor,
    }),
  };
}

function normalizeTargetMonthlyAmount(value: number | null | undefined, baseline: number, action: ConciergeAction) {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0 || value >= baseline) {
    throw new ActionCaseValidationError("Target monthly amount must be at least zero and below the proven baseline.", "invalid-target");
  }
  if (action === "cancel") {
    throw new ActionCaseValidationError("Cancel actions do not accept a target monthly amount.", "invalid-target");
  }
  return Math.round(value * 100) / 100;
}

function normalizeReasonCode(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,79}$/.test(normalized)) {
    throw new ActionCaseValidationError("Transition reason code is invalid.");
  }
  return normalized;
}

function nullableNumber(value: string | null) {
  return value === null ? null : Number(value);
}
