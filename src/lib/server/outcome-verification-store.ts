import "server-only";

import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { canonicalize } from "@/lib/audit-pack";
import { formatCalendarDate, parseCalendarDate, startOfLocalDay } from "@/lib/date-only";
import { calculateOutcomeFeeMinor, outcomeOffer, type ActionCaseStatus, type ConciergeAction } from "@/lib/outcome-cases";
import {
  advanceDateByFrequency,
  getFrequencyGapDays,
  getFrequencyMonthlyMultiplier,
  type Frequency,
} from "@/lib/recurring-audit";
import { getDatabasePool } from "@/lib/server/database";
import { appendLedgerEvent } from "@/lib/server/ledger-event-store";
import { ActionCaseConflictError, ActionCaseNotFoundError } from "@/lib/server/outcome-case-store";

const proofVersion = "verified-savings-absence-v1";
const graceDays = 5;

type VerificationCaseRow = {
  id: string;
  workspace_id: string;
  recurring_item_id: string;
  action: ConciergeAction;
  status: ActionCaseStatus;
  currency: string;
  baseline_monthly_amount: string;
  baseline_annual_amount: string;
  maximum_success_fee_minor: string;
  executed_at: Date | null;
  verification_started_at: Date | null;
  frequency: Frequency;
  average_amount: string;
  normalized_merchant: string;
  next_expected_date: string | null;
  success_fee_basis_points: number;
  minimum_fee_minor: string;
  authorization_maximum_fee_minor: string;
};

type VerificationWindowRow = {
  id: string;
  ordinal: number;
  expected_debit_on: string;
  window_start_on: string;
  window_end_on: string;
  source_id: string | null;
  status: "pending" | "coverage-missing" | "covered-clean" | "charge-observed" | "reduced-charge-observed" | "covered-no-charge";
  observed_transaction_id: string | null;
};

export async function evaluateVerifiedSaving(input: {
  workspaceId: string;
  actionCaseId: string;
  today?: Date;
}) {
  const today = startOfLocalDay(input.today ?? new Date());
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    const row = await loadVerificationCase(client, input.workspaceId, input.actionCaseId);
    if (!row) throw new ActionCaseNotFoundError();
    if (row.status === "verified") {
      const receipt = await loadReceipt(client, input.workspaceId, input.actionCaseId);
      await client.query("commit");
      return { status: "verified" as const, idempotentReplay: true, receipt };
    }
    if (row.status !== "executed" && row.status !== "verifying") {
      throw new ActionCaseConflictError("Only an executed action can enter proof verification.", "invalid-status");
    }
    if (!row.executed_at || !row.next_expected_date) {
      throw new ActionCaseConflictError("Execution time and the next expected debit are required for verification.", "proof-window-unavailable");
    }

    if (row.status === "executed") await beginVerification(client, row);
    const requiredCleanCycles = row.action === "cancel" && row.frequency !== "yearly" ? 2 : 1;
    await ensureVerificationWindows(client, row, requiredCleanCycles);
    const windows = await loadWindows(client, row.workspace_id, row.id);

    let observedMonthlyAmount: number | null = null;
    for (const window of windows) {
      if (parseRequiredDate(window.window_end_on) > today) {
        await updateWindow(client, window.id, "pending", null, null);
        continue;
      }
      const source = await findCoveringSource(client, row, window);
      if (!source) {
        await updateWindow(client, window.id, "coverage-missing", null, null);
        continue;
      }
      const charge = await findCharge(client, row, window, source.id);
      if (row.action === "cancel") {
        await updateWindow(
          client,
          window.id,
          charge ? "charge-observed" : "covered-clean",
          source.id,
          charge?.id ?? null,
        );
        continue;
      }
      if (!charge) {
        await updateWindow(client, window.id, "covered-no-charge", source.id, null);
        continue;
      }
      const priorOccurrenceAmount = Number(row.average_amount);
      const chargeAmount = Number(charge.amount);
      const meaningfulReduction = priorOccurrenceAmount - chargeAmount >= Math.max(10, priorOccurrenceAmount * 0.08);
      if (meaningfulReduction) {
        observedMonthlyAmount = chargeAmount * getFrequencyMonthlyMultiplier(row.frequency);
        await updateWindow(client, window.id, "reduced-charge-observed", source.id, charge.id);
      } else {
        await updateWindow(client, window.id, "charge-observed", source.id, charge.id);
      }
    }

    const evaluated = await loadWindows(client, row.workspace_id, row.id);
    const failed = evaluated.some((window) => window.status === "charge-observed");
    if (failed) {
      const failureCode = row.action === "cancel" ? "charge-still-present" : "price-not-reduced";
      await markVerificationFailed(client, row, failureCode, today, evaluated);
      await client.query("commit");
      return {
        status: "failed" as const,
        reasonCode: failureCode,
        cleanCycles: evaluated.filter((window) => window.status === "covered-clean").length,
        requiredCleanCycles,
      };
    }

    const proven = row.action === "cancel"
      ? evaluated.filter((window) => window.status === "covered-clean").length >= requiredCleanCycles
      : evaluated.some((window) => window.status === "reduced-charge-observed");
    if (!proven) {
      await recordPendingVerification(client, row, today, evaluated, requiredCleanCycles);
      await client.query("commit");
      return {
        status: "verifying" as const,
        cleanCycles: evaluated.filter((window) => window.status === "covered-clean").length,
        requiredCleanCycles,
        coverageMissing: evaluated.filter((window) => window.status === "coverage-missing").length,
      };
    }

    const receipt = await mintVerifiedSavingReceipt(
      client,
      row,
      evaluated,
      requiredCleanCycles,
      observedMonthlyAmount ?? 0,
    );
    await client.query("commit");
    return { status: "verified" as const, idempotentReplay: false, receipt };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function claimDueSavingVerifications(limit = 25) {
  const boundedLimit = Math.max(1, Math.min(limit, 100));
  const result = await getDatabasePool().query<{ workspace_id: string; id: string }>(
    `select action_case.workspace_id, action_case.id
     from action_cases action_case
     where action_case.status in ('executed', 'verifying')
     order by coalesce(action_case.verification_started_at, action_case.executed_at), action_case.id
     limit $1`,
    [boundedLimit],
  );
  return result.rows.map((row) => ({ workspaceId: row.workspace_id, actionCaseId: row.id }));
}

async function loadVerificationCase(client: PoolClient, workspaceId: string, actionCaseId: string) {
  const result = await client.query<VerificationCaseRow>(
    `select action_case.id, action_case.workspace_id, action_case.recurring_item_id,
            action_case.action, action_case.status, action_case.currency,
            action_case.baseline_monthly_amount::text, action_case.baseline_annual_amount::text,
            action_case.maximum_success_fee_minor::text,
            action_case.executed_at, action_case.verification_started_at,
            item.frequency, item.average_amount::text, item.normalized_merchant,
            item.next_expected_date::text,
            auth_record.success_fee_basis_points,
            auth_record.minimum_fee_minor::text,
            auth_record.maximum_fee_minor::text as authorization_maximum_fee_minor
     from action_cases action_case
     join recurring_items item on item.id = action_case.recurring_item_id
     join lateral (
       select success_fee_basis_points, minimum_fee_minor, maximum_fee_minor
       from action_authorizations
       where action_case_id = action_case.id and revoked_at is null
       order by authorized_at desc, id desc limit 1
     ) auth_record on true
     where action_case.workspace_id = $1 and action_case.id = $2
     for update of action_case`,
    [workspaceId, actionCaseId],
  );
  return result.rows[0] ?? null;
}

async function beginVerification(client: PoolClient, row: VerificationCaseRow) {
  await client.query(
    `update action_cases
     set status = 'verifying', verification_started_at = coalesce(verification_started_at, now()), updated_at = now()
     where workspace_id = $1 and id = $2 and status = 'executed'`,
    [row.workspace_id, row.id],
  );
  await client.query(
    `insert into action_case_events (
       workspace_id, action_case_id, previous_status, status,
       actor_kind, reason_code, idempotency_key
     ) values ($1, $2, 'executed', 'verifying', 'system',
               'proof-window-opened', $3)
     on conflict (workspace_id, idempotency_key) do nothing`,
    [row.workspace_id, row.id, `verification-event:${row.id}:opened`],
  );
  await appendLedgerEvent({
    workspaceId: row.workspace_id,
    eventType: "action.case.transitioned",
    entityKind: "action",
    entityRef: row.id,
    idempotencyKey: `verification-ledger:${row.id}:opened`,
    payload: { previousStatus: "executed", status: "verifying", reasonCode: "proof-window-opened" },
  }, client);
}

async function ensureVerificationWindows(client: PoolClient, row: VerificationCaseRow, requiredCycles: number) {
  const executedOn = startOfLocalDay(row.executed_at as Date);
  let expected = parseRequiredDate(row.next_expected_date as string);
  let guard = 0;
  while (expected < executedOn && guard < 240) {
    expected = advanceDateByFrequency(expected, row.frequency, getFrequencyGapDays(row.frequency));
    guard += 1;
  }
  if (expected < executedOn) throw new Error("Expected debit could not be advanced into the verification period.");
  for (let index = 0; index < requiredCycles; index += 1) {
    const windowStart = addDays(expected, -graceDays);
    const windowEnd = addDays(expected, graceDays);
    await client.query(
      `insert into saving_verification_windows (
         workspace_id, action_case_id, ordinal, expected_debit_on,
         window_start_on, window_end_on
       ) values ($1, $2, $3, $4::date, $5::date, $6::date)
       on conflict (action_case_id, ordinal) do nothing`,
      [row.workspace_id, row.id, index + 1, formatCalendarDate(expected), formatCalendarDate(windowStart), formatCalendarDate(windowEnd)],
    );
    expected = advanceDateByFrequency(expected, row.frequency, getFrequencyGapDays(row.frequency));
  }
}

async function loadWindows(client: PoolClient, workspaceId: string, actionCaseId: string) {
  const result = await client.query<VerificationWindowRow>(
    `select id, ordinal, expected_debit_on::text, window_start_on::text,
            window_end_on::text, source_id, status, observed_transaction_id
     from saving_verification_windows
     where workspace_id = $1 and action_case_id = $2
     order by ordinal`,
    [workspaceId, actionCaseId],
  );
  return result.rows;
}

async function findCoveringSource(client: PoolClient, row: VerificationCaseRow, window: VerificationWindowRow) {
  const result = await client.query<{ id: string }>(
    `with candidate_sources as (
       select distinct evidence.source_id
       from evidence_links evidence
       where evidence.recurring_item_id = $1 and evidence.source_id is not null
       union
       select distinct evidence.source_id
       from connector_evidence evidence
       where evidence.recurring_item_id = $1 and evidence.source_id is not null
     )
     select source.id
     from candidate_sources candidate
     join data_sources source on source.id = candidate.source_id
     where source.workspace_id = $2
       and source.status = 'active'
       and source.freshness_status <> 'error'
       and source.coverage_start_at::date <= $3::date
       and source.coverage_end_at::date >= $4::date
     order by source.coverage_end_at desc, source.id
     limit 1`,
    [row.recurring_item_id, row.workspace_id, window.window_start_on, window.window_end_on],
  );
  return result.rows[0] ?? null;
}

async function findCharge(
  client: PoolClient,
  row: VerificationCaseRow,
  window: VerificationWindowRow,
  sourceId: string,
) {
  const result = await client.query<{ id: string; amount: string }>(
    `select ledger_tx.id, ledger_tx.amount::text
     from transactions ledger_tx
     where ledger_tx.workspace_id = $1
       and ledger_tx.source_id = $2
       and ledger_tx.direction = 'debit'
       and ledger_tx.normalized_merchant = $3
       and ledger_tx.transaction_date between $4::date and $5::date
     order by ledger_tx.transaction_date desc, ledger_tx.id desc
     limit 1`,
    [row.workspace_id, sourceId, row.normalized_merchant, window.window_start_on, window.window_end_on],
  );
  return result.rows[0] ?? null;
}

async function updateWindow(
  client: PoolClient,
  windowId: string,
  status: VerificationWindowRow["status"],
  sourceId: string | null,
  transactionId: string | null,
) {
  await client.query(
    `update saving_verification_windows
     set status = $2, source_id = $3, observed_transaction_id = $4,
         coverage_confirmed_at = case when $2 in ('covered-clean', 'charge-observed', 'reduced-charge-observed', 'covered-no-charge') then now() else null end,
         evaluated_at = now(), updated_at = now()
     where id = $1`,
    [windowId, status, sourceId, transactionId],
  );
}

async function recordPendingVerification(
  client: PoolClient,
  row: VerificationCaseRow,
  today: Date,
  windows: VerificationWindowRow[],
  requiredCleanCycles: number,
) {
  const cleanCycles = windows.filter((window) => window.status === "covered-clean").length;
  const coverageMissing = windows.filter((window) => window.status === "coverage-missing").length;
  const coverageDates = coveredDateRange(windows);
  await appendLedgerEvent({
    workspaceId: row.workspace_id,
    eventType: "saving.verification.updated",
    entityKind: "action",
    entityRef: row.id,
    idempotencyKey: `saving-verification:${row.id}:${formatCalendarDate(today)}:${cleanCycles}:${coverageMissing}`,
    payload: {
      status: "verifying",
      cleanCycles,
      requiredCleanCycles,
      coverageStart: coverageDates.start,
      coverageEnd: coverageDates.end,
    },
  }, client);
}

async function markVerificationFailed(
  client: PoolClient,
  row: VerificationCaseRow,
  reasonCode: string,
  today: Date,
  windows: VerificationWindowRow[],
) {
  await client.query(
    `update action_cases
     set status = 'failed', failure_code = $3, updated_at = now()
     where workspace_id = $1 and id = $2 and status = 'verifying'`,
    [row.workspace_id, row.id, reasonCode],
  );
  await client.query(
    `insert into action_case_events (
       workspace_id, action_case_id, previous_status, status,
       actor_kind, reason_code, idempotency_key
     ) values ($1, $2, 'verifying', 'failed', 'system', $3, $4)
     on conflict (workspace_id, idempotency_key) do nothing`,
    [row.workspace_id, row.id, reasonCode, `verification-event:${row.id}:failed:${formatCalendarDate(today)}`],
  );
  const coverageDates = coveredDateRange(windows);
  await appendLedgerEvent({
    workspaceId: row.workspace_id,
    eventType: "saving.verification.updated",
    entityKind: "action",
    entityRef: row.id,
    idempotencyKey: `saving-verification:${row.id}:failed:${formatCalendarDate(today)}`,
    payload: {
      status: "failed",
      reasonCode,
      cleanCycles: windows.filter((window) => window.status === "covered-clean").length,
      requiredCleanCycles: row.action === "cancel" && row.frequency !== "yearly" ? 2 : 1,
      coverageStart: coverageDates.start,
      coverageEnd: coverageDates.end,
    },
  }, client);
  await appendLedgerEvent({
    workspaceId: row.workspace_id,
    eventType: "action.case.transitioned",
    entityKind: "action",
    entityRef: row.id,
    idempotencyKey: `verification-transition:${row.id}:failed:${formatCalendarDate(today)}`,
    payload: { previousStatus: "verifying", status: "failed", reasonCode },
  }, client);
}

async function mintVerifiedSavingReceipt(
  client: PoolClient,
  row: VerificationCaseRow,
  windows: VerificationWindowRow[],
  requiredCleanCycles: number,
  currentMonthlyAmount: number,
) {
  const existing = await loadReceipt(client, row.workspace_id, row.id);
  if (existing) return existing;
  const baselineMonthly = Number(row.baseline_monthly_amount);
  const verifiedMonthlySaving = Math.round((baselineMonthly - currentMonthlyAmount) * 100) / 100;
  const verifiedAnnualSaving = Math.round(verifiedMonthlySaving * 12 * 100) / 100;
  if (verifiedMonthlySaving <= 0 || verifiedAnnualSaving <= 0) {
    throw new Error("Verification cannot mint a non-positive saving.");
  }
  const cleanCycles = row.action === "cancel"
    ? windows.filter((window) => window.status === "covered-clean").length
    : windows.filter((window) => window.status === "reduced-charge-observed").length;
  const coverageDates = coveredDateRange(windows);
  if (!coverageDates.start || !coverageDates.end) {
    throw new Error("Verified saving has no evidence-covered date range.");
  }
  const evidenceManifest = {
    version: 1,
    actionCaseId: row.id,
    verificationWindowIds: windows.map((window) => window.id),
    sourceIds: [...new Set(windows.map((window) => window.source_id).filter((value): value is string => Boolean(value)))].sort(),
    observedTransactionIds: [...new Set(windows.map((window) => window.observed_transaction_id).filter((value): value is string => Boolean(value)))].sort(),
  };
  const receiptHash = createHash("sha256").update(canonicalize({
    workspaceId: row.workspace_id,
    actionCaseId: row.id,
    currency: row.currency,
    baselineMonthly,
    currentMonthlyAmount,
    verifiedMonthlySaving,
    verifiedAnnualSaving,
    cleanCycles,
    requiredCleanCycles,
    coverageDates,
    proofVersion,
    evidenceManifest,
  })).digest("hex");
  const receiptResult = await client.query<{ id: string; minted_at: Date }>(
    `insert into verified_saving_receipts (
       workspace_id, action_case_id, currency, baseline_monthly_amount,
       current_monthly_amount, verified_monthly_saving, verified_annual_saving,
       clean_cycles, required_clean_cycles, coverage_start_on, coverage_end_on,
       proof_version, evidence_manifest, receipt_hash
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, $11::date, $12, $13::jsonb, $14)
     returning id, minted_at`,
    [
      row.workspace_id,
      row.id,
      row.currency,
      baselineMonthly,
      currentMonthlyAmount,
      verifiedMonthlySaving,
      verifiedAnnualSaving,
      cleanCycles,
      requiredCleanCycles,
      coverageDates.start,
      coverageDates.end,
      proofVersion,
      JSON.stringify(evidenceManifest),
      receiptHash,
    ],
  );
  const receipt = receiptResult.rows[0];
  const authorizedMaximum = Math.min(Number(row.maximum_success_fee_minor), Number(row.authorization_maximum_fee_minor));
  const invoiceAmountMinor = calculateOutcomeFeeMinor(verifiedAnnualSaving, {
    successFeeBasisPoints: row.success_fee_basis_points,
    minimumFeeMinor: Number(row.minimum_fee_minor),
    maximumFeeMinor: authorizedMaximum,
  });
  await client.query(
    `insert into success_fee_invoices (
       workspace_id, action_case_id, verified_saving_receipt_id,
       offer_id, offer_version, terms_version, success_fee_basis_points,
       amount_minor, currency, review_available_until
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9,
               now() + ($10::int * interval '1 day'))`,
    [
      row.workspace_id,
      row.id,
      receipt.id,
      outcomeOffer.id,
      outcomeOffer.version,
      outcomeOffer.termsVersion,
      row.success_fee_basis_points,
      invoiceAmountMinor,
      row.currency,
      outcomeOffer.reviewWindowDays,
    ],
  );
  await client.query(
    `update action_cases
     set status = 'verified', verified_at = now(), failure_code = null, updated_at = now()
     where workspace_id = $1 and id = $2 and status = 'verifying'`,
    [row.workspace_id, row.id],
  );
  await client.query(
    `insert into action_case_events (
       workspace_id, action_case_id, previous_status, status,
       actor_kind, reason_code, idempotency_key
     ) values ($1, $2, 'verifying', 'verified', 'system', 'proof-complete', $3)`,
    [row.workspace_id, row.id, `verification-event:${row.id}:verified`],
  );
  await client.query(
    `insert into proof_nodes (workspace_id, kind, entity_ref)
     values ($1, 'saving', $2)
     on conflict (workspace_id, kind, entity_ref)
     do update set status = 'active', retired_at = null`,
    [row.workspace_id, receipt.id],
  );
  await client.query(
    `insert into proof_edges (workspace_id, from_node_id, to_node_id, edge_type)
     select $1, action_node.id, saving_node.id, 'produced'
     from proof_nodes action_node
     join proof_nodes saving_node on saving_node.workspace_id = action_node.workspace_id
       and saving_node.kind = 'saving' and saving_node.entity_ref = $3
     where action_node.workspace_id = $1
       and action_node.kind = 'action' and action_node.entity_ref = $2
     on conflict (workspace_id, from_node_id, to_node_id, edge_type) where valid_to is null do nothing`,
    [row.workspace_id, row.id, receipt.id],
  );
  await appendLedgerEvent({
    workspaceId: row.workspace_id,
    eventType: "saving.receipt.minted",
    entityKind: "saving",
    entityRef: receipt.id,
    idempotencyKey: `saving-receipt:${receipt.id}:minted`,
    payload: {
      status: "verified",
      currency: row.currency,
      monthlyDelta: verifiedMonthlySaving,
      annualSaving: verifiedAnnualSaving,
      cleanCycles,
      requiredCleanCycles,
      coverageStart: coverageDates.start,
      coverageEnd: coverageDates.end,
      modelVersion: proofVersion,
    },
  }, client);
  await appendLedgerEvent({
    workspaceId: row.workspace_id,
    eventType: "action.case.transitioned",
    entityKind: "action",
    entityRef: row.id,
    idempotencyKey: `verification-transition:${row.id}:verified`,
    payload: { previousStatus: "verifying", status: "verified", reasonCode: "proof-complete" },
  }, client);
  await client.query(
    `insert into audit_log (workspace_id, action, entity_type, entity_id, metadata)
     values ($1, 'saving.receipt.minted', 'verified_saving_receipt', $2,
             jsonb_build_object('actionCaseId', $3::text, 'receiptHash', $4::text))`,
    [row.workspace_id, receipt.id, row.id, receiptHash],
  );
  return {
    id: receipt.id,
    currency: row.currency,
    verifiedMonthlySaving,
    verifiedAnnualSaving,
    cleanCycles,
    requiredCleanCycles,
    coverageStart: coverageDates.start,
    coverageEnd: coverageDates.end,
    proofVersion,
    receiptHash,
    mintedAt: receipt.minted_at.toISOString(),
  };
}

async function loadReceipt(client: PoolClient, workspaceId: string, actionCaseId: string) {
  const result = await client.query<{
    id: string; currency: string; verified_monthly_saving: string; verified_annual_saving: string;
    clean_cycles: number; required_clean_cycles: number; coverage_start_on: string;
    coverage_end_on: string; proof_version: string; receipt_hash: string; minted_at: Date;
  }>(
    `select id, currency, verified_monthly_saving::text, verified_annual_saving::text,
            clean_cycles, required_clean_cycles, coverage_start_on::text,
            coverage_end_on::text, proof_version, receipt_hash, minted_at
     from verified_saving_receipts
     where workspace_id = $1 and action_case_id = $2 and status in ('active', 'disputed')
     order by minted_at desc, id desc limit 1`,
    [workspaceId, actionCaseId],
  );
  const row = result.rows[0];
  return row ? {
    id: row.id,
    currency: row.currency,
    verifiedMonthlySaving: Number(row.verified_monthly_saving),
    verifiedAnnualSaving: Number(row.verified_annual_saving),
    cleanCycles: row.clean_cycles,
    requiredCleanCycles: row.required_clean_cycles,
    coverageStart: row.coverage_start_on,
    coverageEnd: row.coverage_end_on,
    proofVersion: row.proof_version,
    receiptHash: row.receipt_hash,
    mintedAt: row.minted_at.toISOString(),
  } : null;
}

function coveredDateRange(windows: VerificationWindowRow[]) {
  const covered = windows.filter((window) => ["covered-clean", "charge-observed", "reduced-charge-observed", "covered-no-charge"].includes(window.status));
  return {
    start: covered.map((window) => window.window_start_on).sort()[0] ?? null,
    end: covered.map((window) => window.window_end_on).sort().at(-1) ?? null,
  };
}

function parseRequiredDate(value: string) {
  const parsed = parseCalendarDate(value);
  if (!parsed) throw new Error(`Invalid verification calendar date: ${value}`);
  return parsed;
}

function addDays(value: Date, days: number) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + days);
}
