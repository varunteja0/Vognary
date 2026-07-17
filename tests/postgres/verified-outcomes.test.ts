import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { formatCalendarDate } from "../../src/lib/date-only";
import { outcomeOffer } from "../../src/lib/outcome-cases";
import { getDatabasePool } from "../../src/lib/server/database";
import {
  authorizeWorkspaceActionCase,
  createWorkspaceActionCase,
  transitionWorkspaceActionCase,
} from "../../src/lib/server/outcome-case-store";
import { evaluateVerifiedSaving } from "../../src/lib/server/outcome-verification-store";

const databaseConfigured = Boolean(process.env.DATABASE_URL);

test("a permissioned cancellation mints exactly one receipt only after two covered clean cycles", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const sourceId = randomUUID();
  const recurringItemId = randomUUID();
  const initialTransactionId = randomUUID();
  const now = new Date();
  const nextExpected = addDays(now, 15);
  const proofToday = addDays(now, 85);

  try {
    await pool.query(`insert into users (id, email) values ($1, $2)`, [userId, `${userId}@outcome.test`]);
    await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Verified outcome test')`, [workspaceId, userId]);
    await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, userId]);
    await pool.query(
      `insert into data_sources (
         id, workspace_id, kind, provider, display_name, status,
         coverage_start_at, coverage_end_at, coverage_completeness, freshness_status, rail_id
       ) values ($1, $2, 'csv_upload', 'integration-test', 'Complete statement', 'active',
                 $3::date, $4::date, 'complete', 'fresh', 'statement')`,
      [sourceId, workspaceId, formatCalendarDate(addDays(now, -120)), formatCalendarDate(addDays(now, 180))],
    );
    await pool.query(
      `insert into recurring_items (
         id, workspace_id, merchant, normalized_merchant, category, frequency,
         currency, amount_min, amount_max, average_amount, monthly_cost,
         annual_cost, last_charge_date, next_expected_date, confidence_score
       ) values ($1, $2, 'Outcome SaaS', 'outcome saas', 'SaaS subscription', 'monthly',
                 'INR', 1000, 1000, 1000, 1000, 12000, $3::date, $4::date, 95)`,
      [recurringItemId, workspaceId, formatCalendarDate(addDays(now, -15)), formatCalendarDate(nextExpected)],
    );
    await pool.query(
      `insert into transactions (
         id, workspace_id, source_id, transaction_date, description,
         normalized_merchant, category, amount, currency, direction
       ) values ($1, $2, $3, $4::date, 'Outcome SaaS charge',
                 'outcome saas', 'SaaS subscription', 1000, 'INR', 'debit')`,
      [initialTransactionId, workspaceId, sourceId, formatCalendarDate(addDays(now, -15))],
    );
    await pool.query(
      `insert into evidence_links (
         recurring_item_id, transaction_id, source_id, evidence_type,
         evidence_text, evidence_date, amount
       ) values ($1, $2, $3, 'transaction', 'Outcome SaaS charge', $4::date, 1000)`,
      [recurringItemId, initialTransactionId, sourceId, formatCalendarDate(addDays(now, -15))],
    );

    const created = await createWorkspaceActionCase({
      workspaceId,
      recurringItemId,
      requestedByUserId: userId,
      action: "cancel",
      idempotencyKey: `outcome-create:${randomUUID()}`,
    });
    assert.equal(created.created, true);
    assert.equal(created.actionCase.status, "awaiting-authorization");
    assert.equal(created.authorizationPreview.scope, "one-action-one-commitment");

    const authorized = await authorizeWorkspaceActionCase({
      workspaceId,
      actionCaseId: created.actionCase.id,
      authorizedByUserId: userId,
      termsVersion: outcomeOffer.termsVersion,
      idempotencyKey: `outcome-authorize:${randomUUID()}`,
    });
    assert.equal(authorized.actionCase.status, "authorized");
    await transitionWorkspaceActionCase({
      workspaceId,
      actionCaseId: created.actionCase.id,
      nextStatus: "in-progress",
      actorKind: "operator",
      reasonCode: "operator-accepted",
      idempotencyKey: `outcome-start:${randomUUID()}`,
    });
    await transitionWorkspaceActionCase({
      workspaceId,
      actionCaseId: created.actionCase.id,
      nextStatus: "executed",
      actorKind: "operator",
      reasonCode: "provider-confirmed",
      idempotencyKey: `outcome-executed:${randomUUID()}`,
    });

    const verified = await evaluateVerifiedSaving({
      workspaceId,
      actionCaseId: created.actionCase.id,
      today: proofToday,
    });
    assert.equal(verified.status, "verified");
    assert.equal(verified.receipt?.verifiedAnnualSaving, 12000);
    assert.equal(verified.receipt?.cleanCycles, 2);
    const replay = await evaluateVerifiedSaving({
      workspaceId,
      actionCaseId: created.actionCase.id,
      today: proofToday,
    });
    assert.equal(replay.status, "verified");
    assert.equal(replay.idempotentReplay, true);

    const durable = await pool.query<{
      receipts: number; invoices: number; amount_minor: string; produced_edges: number; ledger_events: number;
    }>(
      `select
         (select count(*)::int from verified_saving_receipts where action_case_id = $1) as receipts,
         (select count(*)::int from success_fee_invoices where action_case_id = $1) as invoices,
         (select amount_minor::text from success_fee_invoices where action_case_id = $1) as amount_minor,
         (select count(*)::int
          from proof_edges edge
          join proof_nodes source on source.id = edge.from_node_id and source.kind = 'action' and source.entity_ref = $1::text
          join proof_nodes target on target.id = edge.to_node_id and target.kind = 'saving'
          where edge.workspace_id = $2 and edge.edge_type = 'produced' and edge.valid_to is null) as produced_edges,
         (select count(*)::int from ledger_events where workspace_id = $2 and entity_ref in ($1::text,
           (select id::text from verified_saving_receipts where action_case_id = $1 limit 1))) as ledger_events`,
      [created.actionCase.id, workspaceId],
    );
    assert.deepEqual(durable.rows[0], {
      receipts: 1,
      invoices: 1,
      amount_minor: "180000",
      produced_edges: 1,
      ledger_events: 8,
    });
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [userId]);
  }
});

function addDays(value: Date, days: number) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + days);
}
