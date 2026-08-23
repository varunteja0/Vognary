import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { evaluateExpectedCharge } from "../../src/lib/recovery/absence";
import { verificationExpectedAmountMinor } from "../../src/lib/recovery/decision-cycle";
import { getDatabasePool } from "../../src/lib/server/database";
import {
  getRecoveryHome,
  putRecoveryDecision,
  submitRecoveryEvidence,
} from "../../src/lib/server/recovery-store";

const databaseConfigured = Boolean(process.env.DATABASE_URL);

test("decision cycles freeze the cited amount and later bills cannot rewrite it", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const ownerUserId = randomUUID();
  const workspaceId = randomUUID();
  const suffix = randomUUID().slice(0, 8);

  await pool.query(
    `insert into users (id, email, display_name) values ($1, $2, 'Expected-amount owner')`,
    [ownerUserId, `recovery-expected-${suffix}@example.test`],
  );
  await pool.query(
    `insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Expected-amount workspace')`,
    [workspaceId, ownerUserId],
  );
  await pool.query(
    `insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`,
    [workspaceId, ownerUserId],
  );

  try {
    const first = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `expected-first-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "cursor-july",
          text: "Cursor invoice paid INR 1,999.00 on 6 July 2026. Cursor Pro monthly subscription. Next billing date: 6 August 2026.",
        }],
      },
      now: new Date("2026-07-20T10:00:00.000Z"),
    });
    assert.equal(first.data.commitments.length, 1);
    const commitmentId = first.data.commitments[0]?.id;
    assert.ok(commitmentId);
    const firstCard = first.data.home.decisionQueue.find((card) => card.commitmentId === commitmentId);
    assert.ok(firstCard);
    assert.equal(firstCard.charge.minor, "199900");

    const kept = await putRecoveryDecision({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: first.workspaceVersion,
      idempotencyKey: `expected-keep-${suffix}`,
      request: { commitmentId, decision: "KEEP", action: "KEEP" },
      now: new Date("2026-07-20T10:05:00.000Z"),
    });
    assert.equal(kept.data.decision.value, "KEEP");

    const frozen = await pool.query<{
      due_date: string;
      expected_amount_minor: string | null;
      verification_outcome: string | null;
    }>(
      `select due_date::text as due_date, expected_amount_minor::text as expected_amount_minor, verification_outcome
       from recovery_decision_cycles
       where workspace_id = $1 and commitment_id = $2`,
      [workspaceId, commitmentId],
    );
    assert.equal(frozen.rowCount, 1);
    assert.equal(frozen.rows[0]?.expected_amount_minor, "199900");
    assert.equal(frozen.rows[0]?.due_date, "2026-08-06");
    assert.equal(frozen.rows[0]?.verification_outcome, null);

    const second = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: kept.workspaceVersion,
      idempotencyKey: `expected-second-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "cursor-august",
          text: "Cursor invoice paid INR 2,499.00 on 6 August 2026. Cursor Pro monthly subscription. Next billing date: 6 September 2026.",
        }],
      },
      now: new Date("2026-08-20T10:00:00.000Z"),
    });
    assert.ok(second.workspaceVersion > kept.workspaceVersion);

    const afterLaterBill = await pool.query<{
      expected_amount_minor: string | null;
      effective_amount_minor: string;
    }>(
      `select cycle.expected_amount_minor::text as expected_amount_minor,
              commitment.effective_amount_minor::text as effective_amount_minor
       from recovery_decision_cycles cycle
       join recovery_commitments commitment
         on commitment.workspace_id = cycle.workspace_id and commitment.id = cycle.commitment_id
       where cycle.workspace_id = $1 and cycle.commitment_id = $2 and cycle.due_date = '2026-08-06'`,
      [workspaceId, commitmentId],
    );
    assert.equal(afterLaterBill.rows[0]?.expected_amount_minor, "199900");
    assert.notEqual(afterLaterBill.rows[0]?.effective_amount_minor, "199900");

    await getRecoveryHome({
      workspaceId,
      actorUserId: ownerUserId,
      generatedAt: new Date("2026-08-20T12:00:00.000Z"),
    });

    const afterVerify = await pool.query<{ expected_amount_minor: string | null }>(
      `select expected_amount_minor::text as expected_amount_minor
       from recovery_decision_cycles
       where workspace_id = $1 and commitment_id = $2 and due_date = '2026-08-06'`,
      [workspaceId, commitmentId],
    );
    assert.equal(afterVerify.rows[0]?.expected_amount_minor, "199900");

    const frozenMinor = BigInt(199_900);
    const currentEffective = BigInt(afterLaterBill.rows[0]?.effective_amount_minor ?? "0");
    const againstFrozen = evaluateExpectedCharge({
      evaluatedOn: "2026-08-20",
      expectedDate: "2026-08-06",
      cadence: "MONTHLY",
      currency: "INR",
      expectedAmountMinor: verificationExpectedAmountMinor(frozenMinor, currentEffective),
      coverage: {
        state: "CURRENT",
        trustworthy: true,
        citedSourceIds: ["src"],
        brokenSourceIds: [],
        staleSourceIds: [],
        limitations: [],
      },
      observations: [{
        evidenceId: "ev-aug",
        date: "2026-08-06",
        amountMinor: BigInt(249_900),
        currency: "INR",
      }],
      cancellationClaimed: false,
    });
    assert.equal(againstFrozen.status === "EVALUATED" && againstFrozen.outcome, "AMOUNT_CHANGED");

    const redecided = await putRecoveryDecision({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: second.workspaceVersion,
      idempotencyKey: `expected-redecide-${suffix}`,
      request: { commitmentId, decision: "CANCEL", action: "PLAN_TO_CANCEL" },
      now: new Date("2026-08-20T12:30:00.000Z"),
    });
    assert.equal(redecided.data.decision.value, "CANCEL");
    const cycles = await pool.query<{
      due_date: string;
      expected_amount_minor: string | null;
      user_action: string;
    }>(
      `select due_date::text as due_date, expected_amount_minor::text as expected_amount_minor, user_action
       from recovery_decision_cycles
       where workspace_id = $1 and commitment_id = $2
       order by due_date`,
      [workspaceId, commitmentId],
    );
    const cancelled = cycles.rows.find((row) => row.user_action === "PLAN_TO_CANCEL");
    assert.ok(cancelled);
    assert.equal(cancelled.expected_amount_minor, "249900");
    const priorKeep = cycles.rows.find((row) => row.due_date === "2026-08-06" && row.user_action === "KEEP");
    if (priorKeep) {
      assert.equal(priorKeep.expected_amount_minor, "199900");
    }

    await pool.query(
      `update recovery_decision_cycles
       set expected_amount_minor = null, verification_outcome = null, verified_at = null
       where workspace_id = $1 and commitment_id = $2 and due_date = '2026-08-06'`,
      [workspaceId, commitmentId],
    );
    const legacyHome = await getRecoveryHome({
      workspaceId,
      actorUserId: ownerUserId,
      generatedAt: new Date("2026-08-20T13:00:00.000Z"),
    });
    assert.ok(Array.isArray(legacyHome.decisionQueue));

    const differed = await pool.query(
      `update recovery_decision_cycles
       set verification_outcome = 'AMOUNT_DIFFERED'
       where workspace_id = $1 and commitment_id = $2 and due_date = '2026-08-06'
       returning verification_outcome`,
      [workspaceId, commitmentId],
    );
    assert.equal(differed.rows[0]?.verification_outcome, "AMOUNT_DIFFERED");
    await assert.rejects(
      () => pool.query(
        `update recovery_decision_cycles
         set verification_outcome = 'INVENTED'
         where workspace_id = $1 and commitment_id = $2 and due_date = '2026-08-06'`,
        [workspaceId, commitmentId],
      ),
    );
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});
