import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import { getDatabasePool } from "../../src/lib/server/database";
import {
  applyAutopilotNoticeEvent,
  authorizeSilentCases,
  disconnectRecoverySource,
  expireUnboundNoticeEvents,
  invoiceWorkspacePeriod,
  measureShadowGate,
  queueDueNotices,
  reconnectRecoverySource,
  recordOperatorExecution,
  replayAutopilotDeadLetter,
  revokeStandingMandate,
  sendQueuedAutopilotNotices,
  setAutopilotNoticeSendInterleaveForTests,
  signStandingMandate,
  vetoAutopilotCandidate,
} from "../../src/lib/server/recovery-autopilot-store";
import { drainAutopilotTestNoticeSends } from "../../src/lib/server/autopilot-mailer";
import { currentlyConnectedSourceSql, queryAutopilotFunnel, standingMandateConsentExistsSql } from "../../scripts/lib/autopilot-funnel.mjs";
import { createRecoveryCorrection, submitRecoveryEvidence } from "../../src/lib/server/recovery-store";
import { lookupCatalogProviderById } from "../../src/lib/recovery/provider-registry";
import { addUtcMonths } from "../../src/lib/recovery/billing-year";
import { withdrawConsentGrant } from "../../src/lib/server/consent-store";

const databaseConfigured = Boolean(process.env.DATABASE_URL);

async function seedWorkspace() {
  const pool = getDatabasePool();
  const ownerUserId = randomUUID();
  const workspaceId = randomUUID();
  const suffix = randomUUID().slice(0, 8);
  await pool.query(
    `insert into users (id, email, display_name) values ($1, $2, 'Integrity owner')`,
    [ownerUserId, `integrity-owner-${suffix}@example.test`],
  );
  await pool.query(
    `insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Integrity workspace')`,
    [workspaceId, ownerUserId],
  );
  await pool.query(
    `insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`,
    [workspaceId, ownerUserId],
  );
  return { pool, ownerUserId, workspaceId, suffix };
}

async function submitMerchantReceipts(input: {
  workspaceId: string;
  actorUserId: string;
  expectedVersion: number;
  suffix: string;
  merchant: "OpenAI" | "Notion";
  now: Date;
}) {
  const receipts = input.merchant === "OpenAI"
    ? [
      {
        clientRef: `openai-july-${input.suffix}`,
        text: "OpenAI subscription charged INR 1,999 on 6 July 2026. Renews monthly on 6 September 2026.",
      },
      {
        clientRef: `openai-august-${input.suffix}`,
        text: "OpenAI subscription charged INR 1,999 on 6 August 2026. Renews monthly on 6 September 2026.",
      },
    ]
    : [
      {
        clientRef: `notion-july-${input.suffix}`,
        text: "Notion invoice paid INR 830 on 7 July 2026. Notion Plus renews monthly on 7 September 2026.",
      },
      {
        clientRef: `notion-august-${input.suffix}`,
        text: "Notion invoice paid INR 830 on 7 August 2026. Notion Plus renews monthly on 7 September 2026.",
      },
    ];
  let version = input.expectedVersion;
  for (const [index, receipt] of receipts.entries()) {
    const submitted = await submitRecoveryEvidence({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      expectedVersion: version,
      idempotencyKey: `cited-${input.merchant.toLowerCase()}-${index}-${input.suffix}`,
      request: { kind: "RECEIPT_PASTE", receipts: [receipt] },
      now: input.now,
    });
    version = submitted.workspaceVersion;
  }
  return version;
}

async function workspaceHasConnectedMandate(pool: ReturnType<typeof getDatabasePool>, workspaceId: string) {
  const result = await pool.query<{ connected: boolean }>(
    `select exists (
       select 1
       from recovery_standing_mandates mandate
       join workspaces workspace on workspace.id = mandate.workspace_id
       join users owner on owner.id = workspace.owner_user_id and owner.deleted_at is null
       join workspace_members membership
         on membership.workspace_id = workspace.id
        and membership.user_id = workspace.owner_user_id
        and membership.role = 'owner'
       join recovery_workspace_states state on state.workspace_id = mandate.workspace_id
       where mandate.workspace_id = $1
         and mandate.status = 'ACTIVE'
         and ${currentlyConnectedSourceSql}
         and ${standingMandateConsentExistsSql}
     ) as connected`,
    [workspaceId],
  );
  return result.rows[0]?.connected === true;
}

test("active mandate with no Recovery source is not a connected shadow-gate mandate", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const { pool, ownerUserId, workspaceId, suffix } = await seedWorkspace();
  try {
    await signStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `integrity-sign-${suffix}`,
    });
    assert.equal(await workspaceHasConnectedMandate(pool, workspaceId), false);
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("fee periods are non-overlapping at the database boundary, including concurrent writers", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const { pool, ownerUserId, workspaceId } = await seedWorkspace();
  try {
    const first = await invoiceWorkspacePeriod({
      workspaceId,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      currency: "INR",
    });
    assert.equal(first.replayed, false);
    const replay = await invoiceWorkspacePeriod({
      workspaceId,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      currency: "INR",
    });
    assert.equal(replay.replayed, true);
    await assert.rejects(
      invoiceWorkspacePeriod({
        workspaceId,
        periodStart: "2026-01-15",
        periodEnd: "2026-02-15",
        currency: "INR",
      }),
      /overlap/i,
    );
    const adjacent = await invoiceWorkspacePeriod({
      workspaceId,
      periodStart: "2026-02-01",
      periodEnd: "2026-02-28",
      currency: "INR",
    });
    assert.equal(adjacent.replayed, false);
    await assert.rejects(
      invoiceWorkspacePeriod({
        workspaceId,
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
        currency: "USD",
      }),
      /INR pricing only/i,
    );
    const other = await seedWorkspace();
    try {
      const otherInvoice = await invoiceWorkspacePeriod({
        workspaceId: other.workspaceId,
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
        currency: "INR",
      });
      assert.equal(otherInvoice.replayed, false);
    } finally {
      await other.pool.query(`delete from workspaces where id = $1`, [other.workspaceId]);
      await other.pool.query(`delete from users where id = $1`, [other.ownerUserId]);
    }
    await assert.rejects(
      invoiceWorkspacePeriod({
        workspaceId,
        periodStart: "2026-04-30",
        periodEnd: "2026-04-01",
        currency: "INR",
      }),
      /start on or before they end/i,
    );
    const [left, right] = await Promise.allSettled([
      invoiceWorkspacePeriod({ workspaceId, periodStart: "2026-03-01", periodEnd: "2026-03-31", currency: "INR" }),
      invoiceWorkspacePeriod({ workspaceId, periodStart: "2026-03-15", periodEnd: "2026-04-14", currency: "INR" }),
    ]);
    const fulfilled = [left, right].filter((result) => result.status === "fulfilled");
    const rejected = [left, right].filter((result) => result.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    await assert.rejects(
      pool.query(
        `insert into recovery_fee_ledger (
           workspace_id, period_start, period_end, currency, monitoring_minor, verified_saving_minor,
           outcome_fee_minor, retained_minor, refund_credit_minor, additional_charge_minor,
           razorpay_charge_status, inputs_hash, year_start
         ) values ($1, '2026-01-10', '2026-01-20', 'INR', 1, 0, 0, 0, 0, 0, 'FAIL_CLOSED', $2, '2026-01-01')`,
        [workspaceId, "a".repeat(64)],
      ),
      /overlap|exclusion|no_overlap/i,
    );
    await assert.rejects(
      pool.query(
        `update recovery_fee_ledger set retained_minor = retained_minor + 1 where workspace_id = $1`,
        [workspaceId],
      ),
      /cannot be mutated/i,
    );
    await assert.rejects(
      pool.query(
        `update recovery_fee_ledger set year_start = '2020-01-01' where workspace_id = $1`,
        [workspaceId],
      ),
      /cannot be mutated/i,
    );
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("explicit currency invoices stay separate in a mixed-currency period", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const { pool, ownerUserId, workspaceId, suffix } = await seedWorkspace();
  try {
    const version = await submitMerchantReceipts({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      suffix: `${suffix}-mixed-fees`,
      merchant: "OpenAI",
      now: new Date("2026-08-09T10:00:00.000Z"),
    });
    await signStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: version,
      idempotencyKey: `mixed-fees-sign-${suffix}`,
    });
    const candidate = await pool.query<{ id: string }>(
      `select id::text from recovery_action_candidates where workspace_id = $1`,
      [workspaceId],
    );
    assert.ok(candidate.rows[0]);
    await pool.query(
      `insert into recovery_covered_windows (
         workspace_id, candidate_id, window_start, window_end, expected_debit_date,
         baseline_debit_minor, observed_debit_minor, saving_minor, status, currency
       ) values
         ($1, $2, '2026-01-05', '2026-01-09', '2026-01-06', 199900, 0, 199900, 'COVERED_CLEAN', 'INR'),
         ($1, $2, '2026-01-06', '2026-01-10', '2026-01-07', 2000, 0, 2000, 'COVERED_CLEAN', 'USD')`,
      [workspaceId, candidate.rows[0]!.id],
    );
    await assert.rejects(
      invoiceWorkspacePeriod({ workspaceId, periodStart: "2026-01-01", periodEnd: "2026-01-31" }),
      /explicit currency/i,
    );
    const verificationClient = await pool.connect();
    let inr: Awaited<ReturnType<typeof invoiceWorkspacePeriod>>;
    try {
      await verificationClient.query("begin");
      await verificationClient.query(
        "select pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`recovery:${workspaceId}`],
      );
      await verificationClient.query(
        `update recovery_covered_windows set saving_minor = 199800
         where workspace_id = $1 and currency = 'INR'`,
        [workspaceId],
      );
      let invoiceFinished = false;
      const invoicePromise = invoiceWorkspacePeriod({
        workspaceId,
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
        currency: "INR",
      });
      void invoicePromise.then(() => { invoiceFinished = true; });
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt += 1) {
        const locks = await pool.query<{ waiting: number }>(
          `select count(*)::int as waiting from pg_locks where locktype = 'advisory' and not granted`,
        );
        waiting = (locks.rows[0]?.waiting ?? 0) > 0;
        if (!waiting) await new Promise<void>((resolve) => setImmediate(resolve));
      }
      assert.equal(waiting, true, "invoicing must wait for in-flight covered-window verification");
      assert.equal(invoiceFinished, false);
      await verificationClient.query("commit");
      inr = await invoicePromise;
    } catch (error) {
      await verificationClient.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      verificationClient.release();
    }
    assert.equal(inr.currency, "INR");
    assert.equal(inr.verifiedSavingMinor, BigInt(199800));
    await assert.rejects(
      pool.query(
        `update recovery_covered_windows set saving_minor = saving_minor - 1
         where workspace_id = $1 and currency = 'INR'`,
        [workspaceId],
      ),
      /Billed covered windows cannot be mutated/i,
    );
    await assert.rejects(
      pool.query(
        `delete from recovery_covered_windows where workspace_id = $1 and currency = 'INR'`,
        [workspaceId],
      ),
      /Billed covered windows cannot be mutated/i,
    );
    await assert.rejects(
      pool.query(
        `insert into recovery_covered_windows (
           workspace_id, candidate_id, window_start, window_end, expected_debit_date,
           baseline_debit_minor, observed_debit_minor, saving_minor, status, currency
         ) values ($1, $2, '2026-01-07', '2026-01-11', '2026-01-08', 199900, 0, 199900, 'COVERED_CLEAN', 'INR')`,
        [workspaceId, candidate.rows[0]!.id],
      ),
      /Billed covered windows cannot be mutated/i,
    );

    await pool.query(
      `insert into recovery_covered_windows (
         workspace_id, candidate_id, window_start, window_end, expected_debit_date,
         baseline_debit_minor, observed_debit_minor, saving_minor, status, currency
       ) values ($1, $2, '2026-02-04', '2026-02-08', '2026-02-06', 199900, 0, 199900, 'COVERED_CLEAN', 'INR')`,
      [workspaceId, candidate.rows[0]!.id],
    );
    const feeLockClient = await pool.connect();
    try {
      await feeLockClient.query("begin");
      await feeLockClient.query(
        "select pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`fee:${workspaceId}:INR`],
      );
      const februaryInvoice = invoiceWorkspacePeriod({
        workspaceId,
        periodStart: "2026-02-01",
        periodEnd: "2026-02-28",
        currency: "INR",
      });
      let invoiceWaiting = false;
      for (let attempt = 0; attempt < 100 && !invoiceWaiting; attempt += 1) {
        const locks = await pool.query<{ waiting: number }>(
          `select count(*)::int as waiting from pg_locks where locktype = 'advisory' and not granted`,
        );
        invoiceWaiting = (locks.rows[0]?.waiting ?? 0) > 0;
        if (!invoiceWaiting) await new Promise<void>((resolve) => setImmediate(resolve));
      }
      assert.equal(invoiceWaiting, true, "invoicing must hold workspace authority while waiting for its fee lock");

      let insertFinished = false;
      const racedInsert = pool.query(
        `insert into recovery_covered_windows (
           workspace_id, candidate_id, window_start, window_end, expected_debit_date,
           baseline_debit_minor, observed_debit_minor, saving_minor, status, currency
         ) values ($1, $2, '2026-02-05', '2026-02-09', '2026-02-07', 199900, 0, 199900, 'COVERED_CLEAN', 'INR')`,
        [workspaceId, candidate.rows[0]!.id],
      ).then(
        () => ({ inserted: true as const, error: null }),
        (error: unknown) => ({ inserted: false as const, error }),
      );
      void racedInsert.then(() => { insertFinished = true; });
      let bothWaiting = false;
      for (let attempt = 0; attempt < 100 && !bothWaiting; attempt += 1) {
        const locks = await pool.query<{ waiting: number }>(
          `select count(*)::int as waiting from pg_locks where locktype = 'advisory' and not granted`,
        );
        bothWaiting = (locks.rows[0]?.waiting ?? 0) >= 2;
        if (!bothWaiting) await new Promise<void>((resolve) => setImmediate(resolve));
      }
      assert.equal(bothWaiting, true, "covered-window inserts must wait behind in-flight invoicing");
      assert.equal(insertFinished, false);
      await feeLockClient.query("commit");
      await februaryInvoice;
      const raced = await racedInsert;
      assert.equal(raced.inserted, false);
      assert.match(String(raced.error), /Billed covered windows cannot be mutated/i);
    } catch (error) {
      await feeLockClient.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      feeLockClient.release();
    }
    await assert.rejects(
      invoiceWorkspacePeriod({
        workspaceId,
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
        currency: "USD",
      }),
      /INR pricing only/i,
    );
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("operator execution replays exactly, conflicts on different input, and never executes SHADOW", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const previous = {
    execution: process.env.AUTOPILOT_EXECUTION_ENABLED,
    notice: process.env.AUTOPILOT_NOTICE_ENABLED,
    channel: process.env.AUTOPILOT_NOTICE_CHANNEL_READY,
    proven: process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS,
  };
  process.env.AUTOPILOT_EXECUTION_ENABLED = "true";
  process.env.AUTOPILOT_NOTICE_ENABLED = "true";
  process.env.AUTOPILOT_NOTICE_CHANNEL_READY = "true";
  process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = "openai";
  const { pool, ownerUserId, workspaceId, suffix } = await seedWorkspace();
  try {
    const first = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `integrity-openai-1-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-july",
          text: "OpenAI subscription charged INR 1,999 on 6 July 2026. Renews monthly on 6 August 2026.",
        }],
      },
      now: new Date("2026-08-09T10:00:00.000Z"),
    });
    const second = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: first.workspaceVersion,
      idempotencyKey: `integrity-openai-2-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-august",
          text: "OpenAI subscription charged INR 1,999 on 6 August 2026. Renews monthly on 6 September 2026.",
        }],
      },
      now: new Date("2026-08-09T11:00:00.000Z"),
    });
    await signStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: second.workspaceVersion,
      idempotencyKey: `integrity-sign-openai-${suffix}`,
    });
    const candidate = await pool.query<{ id: string; status: string }>(
      `select id::text, status from recovery_action_candidates where workspace_id = $1 limit 1`,
      [workspaceId],
    );
    const candidateId = candidate.rows[0]?.id;
    assert.ok(candidateId);
    assert.equal(candidate.rows[0]?.status, "SHADOW");
    await assert.rejects(
      recordOperatorExecution({
        workspaceId,
        actorUserId: ownerUserId,
        candidateId,
        minutes: 4,
        outcome: "EXECUTED",
        proofKind: "MERCHANT_CONFIRMATION_EMAIL",
        proofReference: "msg-shadow-integrity",
        idempotencyKey: `integrity-exec-shadow-${suffix}`,
      }),
      /STATUS_NOT_AUTHORIZED/,
    );
    await pool.query(
      `update recovery_action_candidates
       set status = 'AUTHORIZED_BY_RULE',
           eligibility = 'ELIGIBLE',
           provider_id = 'openai',
           notice_delivered_at = now() - interval '49 hours',
           veto_deadline_at = now() - interval '1 hour'
       where id = $1`,
      [candidateId],
    );
    const payload = {
      workspaceId,
      actorUserId: ownerUserId,
      candidateId,
      minutes: 6,
      outcome: "FAILED" as const,
      failureReason: "provider-timeout",
      idempotencyKey: `integrity-exec-replay-${suffix}`,
    };
    await assert.rejects(recordOperatorExecution(payload), /Execution blocked: SHADOW_GATE/);
    const [left, right] = await Promise.allSettled([
      recordOperatorExecution({ ...payload, idempotencyKey: `integrity-exec-a-${suffix}` }),
      recordOperatorExecution({ ...payload, idempotencyKey: `integrity-exec-b-${suffix}` }),
    ]);
    assert.equal(left.status, "rejected");
    assert.equal(right.status, "rejected");
    const attempts = await pool.query<{ n: string }>(
      `select count(*)::text as n from recovery_execution_attempts where candidate_id = $1`,
      [candidateId],
    );
    assert.equal(attempts.rows[0]?.n, "0");
    const executions = await pool.query<{ n: string }>(
      `select count(*)::text as n from recovery_executions where candidate_id = $1`,
      [candidateId],
    );
    assert.equal(executions.rows[0]?.n, "0");
  } finally {
    process.env.AUTOPILOT_EXECUTION_ENABLED = previous.execution ?? "";
    process.env.AUTOPILOT_NOTICE_ENABLED = previous.notice ?? "";
    process.env.AUTOPILOT_NOTICE_CHANNEL_READY = previous.channel ?? "";
    process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = previous.proven ?? "";
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("unmatched recognized notice webhooks stay pending until a notice can apply them, and workspace delete removes dead letters", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const { pool, ownerUserId, workspaceId, suffix } = await seedWorkspace();
  const providerEventId = `svix-unmatched-notice-${suffix}`;
  const providerMessageId = `resend-unknown-${suffix}`;
  const payloadHash = createHash("sha256").update(`unmatched-${suffix}`).digest("hex");
  const stuckHash = createHash("sha256").update(`stuck-${suffix}`).digest("hex");
  try {
    const first = await applyAutopilotNoticeEvent({
      providerEventId,
      type: "email.delivered",
      providerMessageId,
      occurredAt: "2026-08-15T03:00:00.000Z",
      payloadHash,
      tagged: true,
    });
    assert.equal(first.status, "pending");
    const replay = await applyAutopilotNoticeEvent({
      providerEventId,
      type: "email.delivered",
      providerMessageId,
      occurredAt: "2026-08-15T03:00:00.000Z",
      payloadHash,
      tagged: true,
    });
    assert.equal(replay.status, "pending");
    const held = await pool.query<{ n: string }>(
      `select count(*)::text as n from recovery_notice_pending_events where provider_event_id = $1`,
      [providerEventId],
    );
    assert.equal(held.rows[0]?.n, "1");
    const dead = await pool.query<{ n: string }>(
      `select count(*)::text as n from recovery_autopilot_dead_letters where payload_hash = $1`,
      [payloadHash],
    );
    assert.equal(dead.rows[0]?.n, "0");
    const uniqueIndex = await pool.query<{ indexname: string }>(
      `select indexname from pg_indexes where indexname = 'recovery_veto_notices_provider_message_id_idx'`,
    );
    assert.equal(uniqueIndex.rows[0]?.indexname, "recovery_veto_notices_provider_message_id_idx");
    await pool.query(
      `insert into recovery_autopilot_dead_letters (kind, workspace_id, payload_hash, last_error_code)
       values ('NOTICE', $1, $2, 'QUEUE_STUCK')`,
      [workspaceId, stuckHash],
    );
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    const leftover = await pool.query<{ n: string }>(
      `select count(*)::text as n from recovery_autopilot_dead_letters where workspace_id = $1`,
      [workspaceId],
    );
    assert.equal(leftover.rows[0]?.n, "0");
  } finally {
    await pool.query(`delete from recovery_notice_pending_events where provider_event_id = $1`, [providerEventId]).catch(() => undefined);
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]).catch(() => undefined);
    await pool.query(`delete from users where id = $1`, [ownerUserId]).catch(() => undefined);
  }
});

test("viewers cannot sign a mandate, and candidate ids cannot cross workspaces", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const { pool, ownerUserId, workspaceId, suffix } = await seedWorkspace();
  const viewerId = randomUUID();
  const other = await seedWorkspace();
  try {
    await pool.query(
      `insert into users (id, email, display_name) values ($1, $2, 'Viewer')`,
      [viewerId, `integrity-viewer-${suffix}@example.test`],
    );
    await pool.query(
      `insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'viewer')`,
      [workspaceId, viewerId],
    );
    await assert.rejects(
      signStandingMandate({
        workspaceId,
        actorUserId: viewerId,
        expectedVersion: 0,
        idempotencyKey: `integrity-viewer-sign-${suffix}`,
      }),
      /FORBIDDEN|forbidden|cannot perform that action/i,
    );
    const signed = await signStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `integrity-owner-sign-${suffix}`,
    });
    const candidate = await pool.query<{ id: string }>(
      `select id::text from recovery_action_candidates where workspace_id = $1 limit 1`,
      [workspaceId],
    );
    if (candidate.rows[0]?.id) {
      await assert.rejects(
        vetoAutopilotCandidate({
          workspaceId: other.workspaceId,
          actorUserId: other.ownerUserId,
          candidateId: candidate.rows[0].id,
          expectedVersion: 0,
          idempotencyKey: `integrity-cross-veto-${suffix}`,
        }),
        /NOT_FOUND|not found|FORBIDDEN/i,
      );
    }
    assert.ok(signed.mandate.id);
  } finally {
    await other.pool.query(`delete from workspaces where id = $1`, [other.workspaceId]);
    await other.pool.query(`delete from users where id = $1`, [other.ownerUserId]);
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
    await pool.query(`delete from users where id = $1`, [viewerId]);
  }
});

test("a single pasted receipt cannot invent a next debit, and mixed protected facts create leakage", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const { pool, ownerUserId, workspaceId, suffix } = await seedWorkspace();
  try {
    const first = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `integrity-one-receipt-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-once",
          text: "OpenAI subscription charged INR 1,999 on 6 July 2026. Renews monthly on 6 August 2026.",
        }],
      },
      now: new Date("2026-08-09T10:00:00.000Z"),
    });
    await signStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: first.workspaceVersion,
      idempotencyKey: `integrity-one-receipt-sign-${suffix}`,
    });
    const candidate = await pool.query<{ next_debit_reason: string | null; eligibility: string }>(
      `select next_debit_reason, eligibility from recovery_action_candidates where workspace_id = $1 limit 1`,
      [workspaceId],
    );
    assert.notEqual(candidate.rows[0]?.next_debit_reason, "CITED_RENEWAL");
    assert.notEqual(candidate.rows[0]?.eligibility, "ELIGIBLE");
    if (candidate.rows[0]) {
      const insurance = await pool.query<{ id: string }>(
        `insert into recovery_classification_snapshots (
           workspace_id, commitment_id, commitment_class, protected_override, cited_category,
           cited_merchant, confidence_score, evidence_ids
         )
         select workspace_id, commitment_id, 'insurance', true, 'Insurance', 'LIC', confidence_score, evidence_ids
         from recovery_classification_snapshots
         where workspace_id = $1
         order by created_at desc, id desc
         limit 1
         returning id`,
        [workspaceId],
      );
      await pool.query(
        `update recovery_action_candidates
         set classification_snapshot_id = $2, eligibility = 'ELIGIBLE'
         where workspace_id = $1`,
        [workspaceId, insurance.rows[0]!.id],
      );
      const gate = await measureShadowGate();
      assert.ok(gate.protectedLeakage >= 1);
    }
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("scheduled-only receipt dates do not count as completed Autopilot occurrences", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const { pool, ownerUserId, workspaceId, suffix } = await seedWorkspace();
  try {
    const submitted = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `integrity-scheduled-occurrences-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [
          {
            clientRef: "openai-paid-july",
            text: "OpenAI subscription charged INR 1,999 on 6 July 2026. Renews monthly on 6 August 2026.",
          },
          {
            clientRef: "openai-scheduled-august",
            text: "OpenAI monthly subscription total: INR 1,999. Scheduled to be charged on 6 August 2026.",
          },
          {
            clientRef: "openai-scheduled-september",
            text: "OpenAI monthly subscription total: INR 1,999. Scheduled to be charged on 6 September 2026.",
          },
        ],
      },
      now: new Date("2026-08-01T10:00:00.000Z"),
    });
    await signStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: submitted.workspaceVersion,
      idempotencyKey: `integrity-scheduled-occurrences-sign-${suffix}`,
    });

    const candidate = await pool.query<{ next_debit_reason: string | null; eligibility: string; evidence_count: string }>(
      `select candidate.next_debit_reason, candidate.eligibility,
              cardinality(snapshot.evidence_ids)::text as evidence_count
       from recovery_action_candidates candidate
       join recovery_classification_snapshots snapshot
         on snapshot.workspace_id = candidate.workspace_id
        and snapshot.id = candidate.classification_snapshot_id
       where candidate.workspace_id = $1
       limit 1`,
      [workspaceId],
    );
    assert.equal(candidate.rows[0]?.evidence_count, "3");
    assert.equal(candidate.rows[0]?.next_debit_reason, "INSUFFICIENT_OCCURRENCES");
    assert.notEqual(candidate.rows[0]?.eligibility, "ELIGIBLE");
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("connected mandates require a live Recovery source and current consent; revoke drops the count", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const { pool, ownerUserId, workspaceId, suffix } = await seedWorkspace();
  try {
    assert.equal(await workspaceHasConnectedMandate(pool, workspaceId), false);
    const first = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `integrity-connected-1-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-july-connected",
          text: "OpenAI subscription charged INR 1,999 on 6 July 2026. Renews monthly on 6 August 2026.",
        }],
      },
      now: new Date("2026-08-09T10:00:00.000Z"),
    });
    const signed = await signStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: first.workspaceVersion,
      idempotencyKey: `integrity-connected-sign-${suffix}`,
    });
    assert.equal(await workspaceHasConnectedMandate(pool, workspaceId), true);
    await revokeStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: signed.workspaceVersion,
      idempotencyKey: `integrity-connected-revoke-${suffix}`,
    });
    assert.equal(await workspaceHasConnectedMandate(pool, workspaceId), false);
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("two eligible candidates in one workspace count once; changed cited facts invalidate the prior gate hash", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const previous = {
    notice: process.env.AUTOPILOT_NOTICE_ENABLED,
    channel: process.env.AUTOPILOT_NOTICE_CHANNEL_READY,
    key: process.env.RESEND_API_KEY,
    from: process.env.RESEND_FROM_EMAIL,
    webhook: process.env.RESEND_NOTICE_WEBHOOK_SECRET,
    veto: process.env.AUTOPILOT_VETO_TOKEN_SECRET,
    proven: process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS,
  };
  process.env.AUTOPILOT_NOTICE_ENABLED = "true";
  process.env.AUTOPILOT_NOTICE_CHANNEL_READY = "true";
  process.env.RESEND_API_KEY = "re_test_notice_key";
  process.env.RESEND_FROM_EMAIL = "notices@vognary.test";
  process.env.RESEND_NOTICE_WEBHOOK_SECRET = "whsec_testnoticesecret";
  process.env.AUTOPILOT_VETO_TOKEN_SECRET = "veto-token-secret-at-least-32-chars";
  process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = "openai";
  const { pool, ownerUserId, workspaceId, suffix } = await seedWorkspace();
  try {
    const first = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `integrity-two-1-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-july-two",
          text: "OpenAI subscription charged INR 1,999 on 6 July 2026. Renews monthly on 6 August 2026.",
        }],
      },
      now: new Date("2026-08-09T10:00:00.000Z"),
    });
    const second = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: first.workspaceVersion,
      idempotencyKey: `integrity-two-2-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-august-two",
          text: "OpenAI subscription charged INR 1,999 on 6 August 2026. Renews monthly on 6 September 2026.",
        }],
      },
      now: new Date("2026-08-09T11:00:00.000Z"),
    });
    await signStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: second.workspaceVersion,
      idempotencyKey: `integrity-two-sign-${suffix}`,
    });
    await pool.query(
      `update recovery_action_candidates set eligibility = 'ELIGIBLE', provider_id = 'openai', status = 'SHADOW' where workspace_id = $1`,
      [workspaceId],
    );
    const secondCandidate = await pool.query<{ id: string }>(
      `select id::text from recovery_action_candidates where workspace_id = $1 limit 1`,
      [workspaceId],
    );
    assert.ok(secondCandidate.rows[0]);
    const beforeChange = await measureShadowGate();
    const [left, right] = await Promise.all([measureShadowGate(), measureShadowGate()]);
    assert.equal(left.eligibleCandidates, right.eligibleCandidates);
    assert.equal(left.eligibleCandidates, beforeChange.eligibleCandidates);
    const cloneCount = await pool.query<{ n: string }>(
      `select count(*)::text as n from recovery_action_candidates where workspace_id = $1 and eligibility = 'ELIGIBLE'`,
      [workspaceId],
    );
    assert.ok(Number(cloneCount.rows[0]?.n) >= 1);
    const insurance = await pool.query<{ id: string; commitment_id: string }>(
      `insert into recovery_classification_snapshots (
         workspace_id, commitment_id, commitment_class, protected_override, cited_category,
         cited_merchant, confidence_score, evidence_ids
       )
       select workspace_id, commitment_id, 'insurance', true, 'Insurance', 'LIC', confidence_score, evidence_ids
       from recovery_classification_snapshots
       where workspace_id = $1
       order by created_at desc, id desc
       limit 1
       returning id, commitment_id`,
      [workspaceId],
    );
    await pool.query(
      `update recovery_action_candidates
       set classification_snapshot_id = $2
       where workspace_id = $1 and commitment_id = $3`,
      [workspaceId, insurance.rows[0]!.id, insurance.rows[0]!.commitment_id],
    );
    const afterChange = await measureShadowGate();
    assert.notEqual(afterChange.snapshotHash, beforeChange.snapshotHash);
    assert.ok(afterChange.protectedLeakage >= 1);
  } finally {
    if (previous.notice === undefined) delete process.env.AUTOPILOT_NOTICE_ENABLED;
    else process.env.AUTOPILOT_NOTICE_ENABLED = previous.notice;
    if (previous.channel === undefined) delete process.env.AUTOPILOT_NOTICE_CHANNEL_READY;
    else process.env.AUTOPILOT_NOTICE_CHANNEL_READY = previous.channel;
    if (previous.key === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previous.key;
    if (previous.from === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = previous.from;
    if (previous.webhook === undefined) delete process.env.RESEND_NOTICE_WEBHOOK_SECRET;
    else process.env.RESEND_NOTICE_WEBHOOK_SECRET = previous.webhook;
    if (previous.veto === undefined) delete process.env.AUTOPILOT_VETO_TOKEN_SECRET;
    else process.env.AUTOPILOT_VETO_TOKEN_SECRET = previous.veto;
    if (previous.proven === undefined) delete process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS;
    else process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = previous.proven;
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("operator execution replays the original result, conflicts on changed input, and honors post-authorization disables", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const previous = {
    execution: process.env.AUTOPILOT_EXECUTION_ENABLED,
    pass: process.env.AUTOPILOT_TEST_SHADOW_GATE_PASS,
    proven: process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS,
  };
  process.env.AUTOPILOT_EXECUTION_ENABLED = "true";
  process.env.AUTOPILOT_TEST_SHADOW_GATE_PASS = "true";
  process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = "openai";
  const { pool, ownerUserId, workspaceId, suffix } = await seedWorkspace();
  try {
    const first = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `integrity-replay-1-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-july-replay",
          text: "OpenAI subscription charged INR 1,999 on 6 July 2026. Renews monthly on 6 August 2026.",
        }],
      },
      now: new Date("2026-08-09T10:00:00.000Z"),
    });
    const second = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: first.workspaceVersion,
      idempotencyKey: `integrity-replay-2-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-august-replay",
          text: "OpenAI subscription charged INR 1,999 on 6 August 2026. Renews monthly on 6 September 2026.",
        }],
      },
      now: new Date("2026-08-09T11:00:00.000Z"),
    });
    const signed = await signStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: second.workspaceVersion,
      idempotencyKey: `integrity-replay-sign-${suffix}`,
    });
    const candidate = await pool.query<{ id: string }>(
      `select id::text from recovery_action_candidates where workspace_id = $1 limit 1`,
      [workspaceId],
    );
    const candidateId = candidate.rows[0]?.id;
    assert.ok(candidateId);
    await pool.query(
      `update recovery_action_candidates
       set status = 'AUTHORIZED_BY_RULE',
           eligibility = 'ELIGIBLE',
           provider_id = 'openai',
           notice_delivered_at = now() - interval '49 hours',
           veto_deadline_at = now() - interval '1 hour'
       where id = $1`,
      [candidateId],
    );
    await pool.query(
      `insert into recovery_veto_notices (
         workspace_id, candidate_id, channel, delivery_status, provider_message_id, delivered_at, provider_timestamp
       ) values ($1, $2, 'EMAIL', 'DELIVERED', $3, now() - interval '49 hours', now() - interval '49 hours')`,
      [workspaceId, candidateId, `resend-msg-replay-${suffix}`],
    );
    const payload = {
      workspaceId,
      actorUserId: ownerUserId,
      candidateId,
      minutes: 6,
      outcome: "FAILED" as const,
      failureReason: "provider-timeout",
      idempotencyKey: `integrity-replay-key-${suffix}`,
    };
    const recorded = await recordOperatorExecution(payload);
    assert.equal(recorded.replayed, false);
    const replay = await recordOperatorExecution(payload);
    assert.equal(replay.replayed, true);
    assert.equal(replay.attemptNo, recorded.attemptNo);
    assert.equal(replay.operationKey, recorded.operationKey);
    await assert.rejects(
      recordOperatorExecution({ ...payload, outcome: "EXCEPTION" }),
      /already used|CONFLICT/i,
    );
    const lost = await recordOperatorExecution(payload);
    assert.equal(lost.replayed, true);
    await pool.query(
      `update recovery_action_candidates set status = 'AUTHORIZED_BY_RULE' where id = $1`,
      [candidateId],
    );
    process.env.AUTOPILOT_EXECUTION_ENABLED = "false";
    await assert.rejects(
      recordOperatorExecution({
        ...payload,
        idempotencyKey: `integrity-replay-switch-${suffix}`,
      }),
      /EXECUTION_DISABLED/,
    );
    process.env.AUTOPILOT_EXECUTION_ENABLED = "true";
    await pool.query(
      `insert into recovery_provider_disables (provider_id, disabled, reason)
       values ('openai', true, 'test disable after auth')
       on conflict (provider_id) do update set disabled = true`,
    );
    await assert.rejects(
      recordOperatorExecution({
        ...payload,
        idempotencyKey: `integrity-replay-disabled-${suffix}`,
      }),
      /PROVIDER_DISABLED/,
    );
    await pool.query(`delete from recovery_provider_disables where provider_id = 'openai'`);
    await pool.query(
      `update recovery_action_candidates set status = 'NOTICE_QUEUED' where id = $1`,
      [candidateId],
    );
    await assert.rejects(
      recordOperatorExecution({
        ...payload,
        idempotencyKey: `integrity-replay-notice-${suffix}`,
      }),
      /STATUS_NOT_AUTHORIZED/,
    );
    const citedSource = await pool.query<{ id: string }>(
      `select distinct source.id::text
       from recovery_action_candidates candidate
       join recovery_classification_snapshots snapshot on snapshot.id = candidate.classification_snapshot_id
       join unnest(snapshot.evidence_ids) as cited(id) on true
       join recovery_evidence evidence
         on evidence.workspace_id = candidate.workspace_id and evidence.id = cited.id
       join recovery_sources source
         on source.workspace_id = evidence.workspace_id and source.id = evidence.source_id
       where candidate.workspace_id = $1 and candidate.id = $2
       limit 1`,
      [workspaceId, candidateId],
    );
    assert.ok(citedSource.rows[0]?.id);
    await disconnectRecoverySource({
      workspaceId,
      actorUserId: ownerUserId,
      sourceId: citedSource.rows[0]!.id,
      expectedVersion: signed.workspaceVersion,
      idempotencyKey: `integrity-replay-disconnect-${suffix}`,
    });
    const replayAfterDisconnect = await recordOperatorExecution(payload);
    assert.equal(replayAfterDisconnect.replayed, true);
    assert.equal(replayAfterDisconnect.operationKey, recorded.operationKey);
  } finally {
    if (previous.execution === undefined) delete process.env.AUTOPILOT_EXECUTION_ENABLED;
    else process.env.AUTOPILOT_EXECUTION_ENABLED = previous.execution;
    if (previous.pass === undefined) delete process.env.AUTOPILOT_TEST_SHADOW_GATE_PASS;
    else process.env.AUTOPILOT_TEST_SHADOW_GATE_PASS = previous.pass;
    if (previous.proven === undefined) delete process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS;
    else process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = previous.proven;
    await pool.query(`delete from recovery_provider_disables where provider_id = 'openai'`);
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("later Resend complaints supersede delivery and execution re-reads notice state, not cached clocks", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const previous = {
    execution: process.env.AUTOPILOT_EXECUTION_ENABLED,
    pass: process.env.AUTOPILOT_TEST_SHADOW_GATE_PASS,
    proven: process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS,
  };
  process.env.AUTOPILOT_EXECUTION_ENABLED = "true";
  process.env.AUTOPILOT_TEST_SHADOW_GATE_PASS = "true";
  process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = "openai";
  const { pool, ownerUserId, workspaceId, suffix } = await seedWorkspace();
  try {
    const first = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `integrity-notice-1-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-july-notice",
          text: "OpenAI subscription charged INR 1,999 on 6 July 2026. Renews monthly on 6 August 2026.",
        }],
      },
      now: new Date("2026-08-09T10:00:00.000Z"),
    });
    const second = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: first.workspaceVersion,
      idempotencyKey: `integrity-notice-2-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-august-notice",
          text: "OpenAI subscription charged INR 1,999 on 6 August 2026. Renews monthly on 6 September 2026.",
        }],
      },
      now: new Date("2026-08-09T11:00:00.000Z"),
    });
    await signStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: second.workspaceVersion,
      idempotencyKey: `integrity-notice-sign-${suffix}`,
    });
    const candidate = await pool.query<{ id: string }>(
      `select id::text from recovery_action_candidates where workspace_id = $1 limit 1`,
      [workspaceId],
    );
    const candidateId = candidate.rows[0]?.id;
    assert.ok(candidateId);
    const messageId = `resend-msg-notice-${suffix}`;
    await pool.query(
      `insert into recovery_veto_notices (workspace_id, candidate_id, channel, delivery_status, provider_message_id)
       values ($1, $2, 'EMAIL', 'ACCEPTED', $3)`,
      [workspaceId, candidateId, messageId],
    );
    const delivered = await applyAutopilotNoticeEvent({
      providerEventId: `svix-delivered-${suffix}`,
      type: "email.delivered",
      providerMessageId: messageId,
      occurredAt: "2026-08-24T01:05:00.000Z",
      payloadHash: "d".repeat(64),
    });
    assert.equal(delivered.status, "applied");
    const olderComplaint = await applyAutopilotNoticeEvent({
      providerEventId: `svix-old-complaint-${suffix}`,
      type: "email.complained",
      providerMessageId: messageId,
      occurredAt: "2026-08-24T01:04:00.000Z",
      payloadHash: "e".repeat(64),
    });
    assert.equal(olderComplaint.status, "applied");
    const stillDelivered = await pool.query<{ delivery_status: string }>(
      `select delivery_status from recovery_veto_notices where candidate_id = $1`,
      [candidateId],
    );
    assert.equal(stillDelivered.rows[0]?.delivery_status, "DELIVERED");
    const laterComplaint = await applyAutopilotNoticeEvent({
      providerEventId: `svix-new-complaint-${suffix}`,
      type: "email.complained",
      providerMessageId: messageId,
      occurredAt: "2026-08-24T01:08:00.000Z",
      payloadHash: "f".repeat(64),
    });
    assert.equal(laterComplaint.status, "applied");
    const complained = await pool.query<{ delivery_status: string; delivered_at: Date | null }>(
      `select delivery_status, delivered_at from recovery_veto_notices where candidate_id = $1`,
      [candidateId],
    );
    assert.equal(complained.rows[0]?.delivery_status, "COMPLAINED");
    assert.equal(complained.rows[0]?.delivered_at, null);
    await pool.query(
      `update recovery_action_candidates
       set status = 'AUTHORIZED_BY_RULE',
           eligibility = 'ELIGIBLE',
           provider_id = 'openai',
           notice_delivered_at = now() - interval '49 hours',
           veto_deadline_at = now() - interval '1 hour'
       where id = $1`,
      [candidateId],
    );
    await assert.rejects(
      recordOperatorExecution({
        workspaceId,
        actorUserId: ownerUserId,
        candidateId,
        minutes: 6,
        outcome: "EXECUTED",
        proofKind: "MERCHANT_CONFIRMATION_EMAIL",
        proofReference: "msg-stale-clock",
        idempotencyKey: `integrity-stale-clock-${suffix}`,
      }),
      /NOTICE_NOT_DELIVERED/,
    );
  } finally {
    if (previous.execution === undefined) delete process.env.AUTOPILOT_EXECUTION_ENABLED;
    else process.env.AUTOPILOT_EXECUTION_ENABLED = previous.execution;
    if (previous.pass === undefined) delete process.env.AUTOPILOT_TEST_SHADOW_GATE_PASS;
    else process.env.AUTOPILOT_TEST_SHADOW_GATE_PASS = previous.pass;
    if (previous.proven === undefined) delete process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS;
    else process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = previous.proven;
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("unsupported SHADOW candidates can record an honest EXCEPTION without a proven route", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const previous = {
    execution: process.env.AUTOPILOT_EXECUTION_ENABLED,
    pass: process.env.AUTOPILOT_TEST_SHADOW_GATE_PASS,
    proven: process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS,
  };
  process.env.AUTOPILOT_EXECUTION_ENABLED = "false";
  delete process.env.AUTOPILOT_TEST_SHADOW_GATE_PASS;
  delete process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS;
  const { pool, ownerUserId, workspaceId, suffix } = await seedWorkspace();
  try {
    const first = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `integrity-exception-1-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-july-exc",
          text: "OpenAI subscription charged INR 1,999 on 6 July 2026. Renews monthly on 6 August 2026.",
        }],
      },
      now: new Date("2026-08-09T10:00:00.000Z"),
    });
    const second = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: first.workspaceVersion,
      idempotencyKey: `integrity-exception-2-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-august-exc",
          text: "OpenAI subscription charged INR 1,999 on 6 August 2026. Renews monthly on 6 September 2026.",
        }],
      },
      now: new Date("2026-08-09T11:00:00.000Z"),
    });
    await signStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: second.workspaceVersion,
      idempotencyKey: `integrity-exception-sign-${suffix}`,
    });
    const candidate = await pool.query<{ id: string; status: string; eligibility: string }>(
      `select id::text, status, eligibility from recovery_action_candidates where workspace_id = $1 limit 1`,
      [workspaceId],
    );
    const row = candidate.rows[0];
    assert.ok(row);
    assert.equal(row.status, "SHADOW");
    const recorded = await recordOperatorExecution({
      workspaceId,
      actorUserId: ownerUserId,
      candidateId: row.id,
      minutes: 8,
      outcome: "EXCEPTION",
      failureReason: "login-self-service",
      idempotencyKey: `integrity-exception-${suffix}`,
    });
    assert.equal(recorded.replayed, false);
    assert.equal(recorded.outcome, "EXCEPTION");
    const status = await pool.query<{ status: string }>(
      `select status from recovery_action_candidates where id = $1`,
      [row.id],
    );
    assert.equal(status.rows[0]?.status, "EXCEPTION");
  } finally {
    if (previous.execution === undefined) delete process.env.AUTOPILOT_EXECUTION_ENABLED;
    else process.env.AUTOPILOT_EXECUTION_ENABLED = previous.execution;
    if (previous.pass === undefined) delete process.env.AUTOPILOT_TEST_SHADOW_GATE_PASS;
    else process.env.AUTOPILOT_TEST_SHADOW_GATE_PASS = previous.pass;
    if (previous.proven === undefined) delete process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS;
    else process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = previous.proven;
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("cited amount changes invalidate the shadow hash while ids stay the same; dead-letter replay stays scoped", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const { pool, ownerUserId, workspaceId, suffix } = await seedWorkspace();
  try {
    const first = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `integrity-hash-1-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-july-hash",
          text: "OpenAI subscription charged INR 1,999 on 6 July 2026. Renews monthly on 6 August 2026.",
        }],
      },
      now: new Date("2026-08-09T10:00:00.000Z"),
    });
    await signStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: first.workspaceVersion,
      idempotencyKey: `integrity-hash-sign-${suffix}`,
    });
    const connectedBefore = await workspaceHasConnectedMandate(pool, workspaceId);
    assert.equal(connectedBefore, true);
    const before = await measureShadowGate();
    await pool.query(
      `update recovery_action_candidates set amount_minor = amount_minor + 1 where workspace_id = $1`,
      [workspaceId],
    );
    const after = await measureShadowGate();
    assert.notEqual(after.snapshotHash, before.snapshotHash);
    assert.equal(await workspaceHasConnectedMandate(pool, workspaceId), connectedBefore);
    assert.equal(after.eligibleCandidates, before.eligibleCandidates);
    assert.equal(after.protectedLeakage, before.protectedLeakage);
    const executionLetter = await pool.query<{ id: string }>(
      `insert into recovery_autopilot_dead_letters (kind, workspace_id, payload_hash, last_error_code)
       values ('EXECUTION', $1, $2, 'PROVIDER_TIMEOUT')
       returning id::text`,
      [workspaceId, "1".repeat(64)],
    );
    const skipped = await replayAutopilotDeadLetter({
      workspaceId,
      actorUserId: ownerUserId,
      deadLetterId: executionLetter.rows[0]!.id,
    });
    assert.equal(skipped.replayed, false);
    assert.equal(skipped.reason, "KIND_NOT_REPLAYABLE");
    const disconnected = await seedWorkspace();
    try {
      const disconnectedBefore = await workspaceHasConnectedMandate(disconnected.pool, disconnected.workspaceId);
      assert.equal(disconnectedBefore, false);
      await signStandingMandate({
        workspaceId: disconnected.workspaceId,
        actorUserId: disconnected.ownerUserId,
        expectedVersion: 0,
        idempotencyKey: `integrity-funnel-sign-${disconnected.suffix}`,
      });
      assert.equal(
        await workspaceHasConnectedMandate(disconnected.pool, disconnected.workspaceId),
        disconnectedBefore,
      );
    } finally {
      await disconnected.pool.query(`delete from workspaces where id = $1`, [disconnected.workspaceId]);
      await disconnected.pool.query(`delete from users where id = $1`, [disconnected.ownerUserId]);
    }
    const invoice = await invoiceWorkspacePeriod({
      workspaceId,
      periodStart: "2027-01-01",
      periodEnd: "2027-01-31",
      currency: "INR",
    });
    assert.equal(invoice.replayed, false);
    const year = await pool.query<{ year_start: string; anchor: string }>(
      `select ledger.year_start::text, anchor.anchor_date::text as anchor
       from recovery_fee_ledger ledger
       join recovery_billing_year_anchors anchor on anchor.workspace_id = ledger.workspace_id
       where ledger.workspace_id = $1`,
      [workspaceId],
    );
    assert.equal(year.rows[0]?.year_start, year.rows[0]?.anchor);
    assert.notEqual(year.rows[0]?.year_start, "2027-01-01");
    const anchor = year.rows[0]?.anchor;
    assert.ok(anchor);
    await assert.rejects(
      invoiceWorkspacePeriod({
        workspaceId,
        periodStart: addUtcMonths(anchor, 11),
        periodEnd: addUtcMonths(anchor, 12),
        currency: "INR",
      }),
      /billing anniversary/i,
    );
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("notice send crash after provider accept keeps the same frozen veto token and body", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const previous = {
    notice: process.env.AUTOPILOT_NOTICE_ENABLED,
    channel: process.env.AUTOPILOT_NOTICE_CHANNEL_READY,
    adapter: process.env.AUTOPILOT_TEST_ADAPTER,
    crash: process.env.AUTOPILOT_TEST_NOTICE_PERSIST_CRASH,
    secret: process.env.AUTOPILOT_VETO_TOKEN_SECRET,
    proven: process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS,
    from: process.env.RESEND_FROM_EMAIL,
  };
  process.env.AUTOPILOT_NOTICE_ENABLED = "true";
  process.env.AUTOPILOT_NOTICE_CHANNEL_READY = "true";
  process.env.AUTOPILOT_TEST_ADAPTER = "true";
  process.env.AUTOPILOT_VETO_TOKEN_SECRET = "veto-signing-secret-for-tests-32bytes!!";
  process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = "openai";
  process.env.RESEND_FROM_EMAIL = "notices@vognary.test";
  drainAutopilotTestNoticeSends();
  const { pool, ownerUserId, workspaceId, suffix } = await seedWorkspace();
  try {
    const first = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `integrity-notice-1-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-july-notice",
          text: "OpenAI subscription charged INR 1,999 on 6 July 2026. Renews monthly on 6 September 2026.",
        }],
      },
      now: new Date("2026-08-09T10:00:00.000Z"),
    });
    const second = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: first.workspaceVersion,
      idempotencyKey: `integrity-notice-2-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-august-notice",
          text: "OpenAI subscription charged INR 1,999 on 6 August 2026. Renews monthly on 6 September 2026.",
        }],
      },
      now: new Date("2026-08-09T11:00:00.000Z"),
    });
    await pool.query(`update recovery_commitments set confidence_score = 90 where workspace_id = $1`, [workspaceId]);
    await signStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: second.workspaceVersion,
      idempotencyKey: `integrity-notice-sign-${suffix}`,
    });
    const candidate = await pool.query<{ eligibility: string; next_debit_date: string | null }>(
      `select eligibility, next_debit_date::text from recovery_action_candidates where workspace_id = $1 limit 1`,
      [workspaceId],
    );
    assert.equal(candidate.rows[0]?.eligibility, "ELIGIBLE");
    assert.equal(candidate.rows[0]?.next_debit_date, "2026-09-06");
    process.env.AUTOPILOT_TEST_NOTICE_PERSIST_CRASH = "true";
    await assert.rejects(
      queueDueNotices(new Date("2026-08-24T00:00:00.000Z")),
      /notice-persist-crash/,
    );
    const frozen = await pool.query<{
      delivery_status: string;
      veto_token_hash: string | null;
      notice_body_hash: string | null;
      veto_expires_at: Date | null;
    }>(
      `select delivery_status, veto_token_hash, notice_body_hash, veto_expires_at
       from recovery_veto_notices where workspace_id = $1`,
      [workspaceId],
    );
    assert.equal(frozen.rows[0]?.delivery_status, "QUEUED");
    assert.ok(frozen.rows[0]?.veto_token_hash);
    assert.ok(frozen.rows[0]?.notice_body_hash);
    assert.ok(frozen.rows[0]?.veto_expires_at);
    const firstSend = drainAutopilotTestNoticeSends();
    assert.equal(firstSend.length, 1);
    delete process.env.AUTOPILOT_TEST_NOTICE_PERSIST_CRASH;
    const accepted = await sendQueuedAutopilotNotices(new Date("2026-08-24T00:00:00.000Z"), { workspaceId });
    assert.equal(accepted, 1);
    const replaySend = drainAutopilotTestNoticeSends();
    assert.equal(replaySend.length, 1);
    assert.equal(replaySend[0]?.idempotencyKey, firstSend[0]?.idempotencyKey);
    assert.equal(replaySend[0]?.text, firstSend[0]?.text);
    const after = await pool.query<{ delivery_status: string; veto_token_hash: string }>(
      `select delivery_status, veto_token_hash from recovery_veto_notices where workspace_id = $1`,
      [workspaceId],
    );
    assert.equal(after.rows[0]?.delivery_status, "ACCEPTED");
    assert.equal(after.rows[0]?.veto_token_hash, frozen.rows[0]?.veto_token_hash);
  } finally {
    delete process.env.AUTOPILOT_TEST_NOTICE_PERSIST_CRASH;
    if (previous.notice === undefined) delete process.env.AUTOPILOT_NOTICE_ENABLED;
    else process.env.AUTOPILOT_NOTICE_ENABLED = previous.notice;
    if (previous.channel === undefined) delete process.env.AUTOPILOT_NOTICE_CHANNEL_READY;
    else process.env.AUTOPILOT_NOTICE_CHANNEL_READY = previous.channel;
    if (previous.adapter === undefined) delete process.env.AUTOPILOT_TEST_ADAPTER;
    else process.env.AUTOPILOT_TEST_ADAPTER = previous.adapter;
    if (previous.secret === undefined) delete process.env.AUTOPILOT_VETO_TOKEN_SECRET;
    else process.env.AUTOPILOT_VETO_TOKEN_SECRET = previous.secret;
    if (previous.crash === undefined) delete process.env.AUTOPILOT_TEST_NOTICE_PERSIST_CRASH;
    else process.env.AUTOPILOT_TEST_NOTICE_PERSIST_CRASH = previous.crash;
    if (previous.proven === undefined) delete process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS;
    else process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = previous.proven;
    if (previous.from === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = previous.from;
    drainAutopilotTestNoticeSends();
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("a delivered webhook before provider_message_id persistence applies automatically after the crash retry", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const previous = {
    notice: process.env.AUTOPILOT_NOTICE_ENABLED,
    channel: process.env.AUTOPILOT_NOTICE_CHANNEL_READY,
    adapter: process.env.AUTOPILOT_TEST_ADAPTER,
    crash: process.env.AUTOPILOT_TEST_NOTICE_PERSIST_CRASH,
    secret: process.env.AUTOPILOT_VETO_TOKEN_SECRET,
    proven: process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS,
    from: process.env.RESEND_FROM_EMAIL,
  };
  process.env.AUTOPILOT_NOTICE_ENABLED = "true";
  process.env.AUTOPILOT_NOTICE_CHANNEL_READY = "true";
  process.env.AUTOPILOT_TEST_ADAPTER = "true";
  process.env.AUTOPILOT_VETO_TOKEN_SECRET = "veto-signing-secret-for-tests-32bytes!!";
  process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = "openai";
  process.env.RESEND_FROM_EMAIL = "notices@vognary.test";
  drainAutopilotTestNoticeSends();
  const { pool, ownerUserId, workspaceId, suffix } = await seedWorkspace();
  try {
    const first = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `integrity-pending-1-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-july-pending",
          text: "OpenAI subscription charged INR 1,999 on 6 July 2026. Renews monthly on 6 September 2026.",
        }],
      },
      now: new Date("2026-08-09T10:00:00.000Z"),
    });
    const second = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: first.workspaceVersion,
      idempotencyKey: `integrity-pending-2-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-august-pending",
          text: "OpenAI subscription charged INR 1,999 on 6 August 2026. Renews monthly on 6 September 2026.",
        }],
      },
      now: new Date("2026-08-09T11:00:00.000Z"),
    });
    await pool.query(`update recovery_commitments set confidence_score = 90 where workspace_id = $1`, [workspaceId]);
    await signStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: second.workspaceVersion,
      idempotencyKey: `integrity-pending-sign-${suffix}`,
    });
    process.env.AUTOPILOT_TEST_NOTICE_PERSIST_CRASH = "true";
    await assert.rejects(queueDueNotices(new Date("2026-08-24T00:00:00.000Z")), /notice-persist-crash/);
    const sent = drainAutopilotTestNoticeSends();
    assert.equal(sent.length, 1);
    const providerMessageId = `test-${createHash("sha256").update(sent[0]!.idempotencyKey).digest("hex").slice(0, 16)}`;
    const pending = await applyAutopilotNoticeEvent({
      providerEventId: `svix-pending-${suffix}`,
      type: "email.delivered",
      providerMessageId,
      occurredAt: "2026-08-24T01:00:00.000Z",
      payloadHash: "d".repeat(64),
      tagged: true,
    });
    assert.equal(pending.status, "pending");
    const beforePersist = await pool.query<{ delivered_at: Date | null }>(
      `select delivered_at from recovery_veto_notices where workspace_id = $1`,
      [workspaceId],
    );
    assert.equal(beforePersist.rows[0]?.delivered_at, null);
    delete process.env.AUTOPILOT_TEST_NOTICE_PERSIST_CRASH;
    const accepted = await sendQueuedAutopilotNotices(new Date("2026-08-24T00:00:00.000Z"), { workspaceId });
    assert.equal(accepted, 1);
    const after = await pool.query<{ delivery_status: string; delivered_at: Date | null }>(
      `select delivery_status, delivered_at from recovery_veto_notices where workspace_id = $1`,
      [workspaceId],
    );
    assert.equal(after.rows[0]?.delivery_status, "DELIVERED");
    assert.ok(after.rows[0]?.delivered_at);
    const clock = await pool.query<{ notice_delivered_at: Date | null }>(
      `select notice_delivered_at from recovery_action_candidates where workspace_id = $1`,
      [workspaceId],
    );
    assert.ok(clock.rows[0]?.notice_delivered_at);
    const leftoverPending = await pool.query<{ n: string }>(
      `select count(*)::text as n from recovery_notice_pending_events where provider_message_id = $1`,
      [providerMessageId],
    );
    assert.equal(leftoverPending.rows[0]?.n, "0");
  } finally {
    delete process.env.AUTOPILOT_TEST_NOTICE_PERSIST_CRASH;
    if (previous.notice === undefined) delete process.env.AUTOPILOT_NOTICE_ENABLED;
    else process.env.AUTOPILOT_NOTICE_ENABLED = previous.notice;
    if (previous.channel === undefined) delete process.env.AUTOPILOT_NOTICE_CHANNEL_READY;
    else process.env.AUTOPILOT_NOTICE_CHANNEL_READY = previous.channel;
    if (previous.adapter === undefined) delete process.env.AUTOPILOT_TEST_ADAPTER;
    else process.env.AUTOPILOT_TEST_ADAPTER = previous.adapter;
    if (previous.secret === undefined) delete process.env.AUTOPILOT_VETO_TOKEN_SECRET;
    else process.env.AUTOPILOT_VETO_TOKEN_SECRET = previous.secret;
    if (previous.proven === undefined) delete process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS;
    else process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = previous.proven;
    if (previous.from === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = previous.from;
    drainAutopilotTestNoticeSends();
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("notice retry after a crash keeps the original from, to, subject, text, and idempotency key", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const previous = {
    notice: process.env.AUTOPILOT_NOTICE_ENABLED,
    channel: process.env.AUTOPILOT_NOTICE_CHANNEL_READY,
    adapter: process.env.AUTOPILOT_TEST_ADAPTER,
    crash: process.env.AUTOPILOT_TEST_NOTICE_PERSIST_CRASH,
    secret: process.env.AUTOPILOT_VETO_TOKEN_SECRET,
    proven: process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS,
    from: process.env.RESEND_FROM_EMAIL,
  };
  process.env.AUTOPILOT_NOTICE_ENABLED = "true";
  process.env.AUTOPILOT_NOTICE_CHANNEL_READY = "true";
  process.env.AUTOPILOT_TEST_ADAPTER = "true";
  process.env.AUTOPILOT_VETO_TOKEN_SECRET = "veto-signing-secret-for-tests-32bytes!!";
  process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = "openai";
  process.env.RESEND_FROM_EMAIL = "notices@vognary.test";
  drainAutopilotTestNoticeSends();
  const { pool, ownerUserId, workspaceId, suffix } = await seedWorkspace();
  try {
    const first = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `integrity-payload-1-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-july-payload",
          text: "OpenAI subscription charged INR 1,999 on 6 July 2026. Renews monthly on 6 September 2026.",
        }],
      },
      now: new Date("2026-08-09T10:00:00.000Z"),
    });
    const second = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: first.workspaceVersion,
      idempotencyKey: `integrity-payload-2-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-august-payload",
          text: "OpenAI subscription charged INR 1,999 on 6 August 2026. Renews monthly on 6 September 2026.",
        }],
      },
      now: new Date("2026-08-09T11:00:00.000Z"),
    });
    await pool.query(`update recovery_commitments set confidence_score = 90 where workspace_id = $1`, [workspaceId]);
    await signStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: second.workspaceVersion,
      idempotencyKey: `integrity-payload-sign-${suffix}`,
    });
    process.env.AUTOPILOT_TEST_NOTICE_PERSIST_CRASH = "true";
    await assert.rejects(queueDueNotices(new Date("2026-08-24T00:00:00.000Z")), /notice-persist-crash/);
    const original = drainAutopilotTestNoticeSends();
    assert.equal(original.length, 1);
    await pool.query(`update users set email = $2 where id = $1`, [ownerUserId, `changed-${suffix}@example.test`]);
    process.env.RESEND_FROM_EMAIL = "other-from@vognary.test";
    delete process.env.AUTOPILOT_TEST_NOTICE_PERSIST_CRASH;
    await sendQueuedAutopilotNotices(new Date("2026-08-24T00:00:00.000Z"), { workspaceId });
    const replay = drainAutopilotTestNoticeSends();
    assert.equal(replay.length, 1);
    assert.equal(replay[0]?.from, original[0]?.from);
    assert.equal(replay[0]?.to, original[0]?.to);
    assert.equal(replay[0]?.subject, original[0]?.subject);
    assert.equal(replay[0]?.text, original[0]?.text);
    assert.equal(replay[0]?.idempotencyKey, original[0]?.idempotencyKey);
    assert.notEqual(replay[0]?.to, `changed-${suffix}@example.test`);
    assert.notEqual(replay[0]?.from, "other-from@vognary.test");
  } finally {
    delete process.env.AUTOPILOT_TEST_NOTICE_PERSIST_CRASH;
    if (previous.notice === undefined) delete process.env.AUTOPILOT_NOTICE_ENABLED;
    else process.env.AUTOPILOT_NOTICE_ENABLED = previous.notice;
    if (previous.channel === undefined) delete process.env.AUTOPILOT_NOTICE_CHANNEL_READY;
    else process.env.AUTOPILOT_NOTICE_CHANNEL_READY = previous.channel;
    if (previous.adapter === undefined) delete process.env.AUTOPILOT_TEST_ADAPTER;
    else process.env.AUTOPILOT_TEST_ADAPTER = previous.adapter;
    if (previous.secret === undefined) delete process.env.AUTOPILOT_VETO_TOKEN_SECRET;
    else process.env.AUTOPILOT_VETO_TOKEN_SECRET = previous.secret;
    if (previous.proven === undefined) delete process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS;
    else process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = previous.proven;
    if (previous.from === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = previous.from;
    drainAutopilotTestNoticeSends();
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("a delivery does not start the veto clock when the signed token expires before the deadline, and stale freezes fail closed", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const previous = {
    notice: process.env.AUTOPILOT_NOTICE_ENABLED,
    channel: process.env.AUTOPILOT_NOTICE_CHANNEL_READY,
    adapter: process.env.AUTOPILOT_TEST_ADAPTER,
    secret: process.env.AUTOPILOT_VETO_TOKEN_SECRET,
    proven: process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS,
    from: process.env.RESEND_FROM_EMAIL,
  };
  process.env.AUTOPILOT_NOTICE_ENABLED = "true";
  process.env.AUTOPILOT_NOTICE_CHANNEL_READY = "true";
  process.env.AUTOPILOT_TEST_ADAPTER = "true";
  process.env.AUTOPILOT_VETO_TOKEN_SECRET = "veto-signing-secret-for-tests-32bytes!!";
  process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = "openai";
  process.env.RESEND_FROM_EMAIL = "notices@vognary.test";
  drainAutopilotTestNoticeSends();
  const { pool, ownerUserId, workspaceId, suffix } = await seedWorkspace();
  try {
    const first = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `integrity-clock-1-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-july-clock",
          text: "OpenAI subscription charged INR 1,999 on 6 July 2026. Renews monthly on 6 September 2026.",
        }],
      },
      now: new Date("2026-08-09T10:00:00.000Z"),
    });
    const second = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: first.workspaceVersion,
      idempotencyKey: `integrity-clock-2-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-august-clock",
          text: "OpenAI subscription charged INR 1,999 on 6 August 2026. Renews monthly on 6 September 2026.",
        }],
      },
      now: new Date("2026-08-09T11:00:00.000Z"),
    });
    await pool.query(`update recovery_commitments set confidence_score = 90 where workspace_id = $1`, [workspaceId]);
    await signStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: second.workspaceVersion,
      idempotencyKey: `integrity-clock-sign-${suffix}`,
    });
    const candidate = await pool.query<{ id: string }>(
      `select id::text from recovery_action_candidates where workspace_id = $1 limit 1`,
      [workspaceId],
    );
    const candidateId = candidate.rows[0]?.id;
    assert.ok(candidateId);
    await pool.query(
      `insert into recovery_veto_notices (workspace_id, candidate_id, channel, delivery_status, veto_expires_at)
       values ($1, $2, 'EMAIL', 'QUEUED', $3)`,
      [workspaceId, candidateId, "2026-08-24T12:00:00.000Z"],
    );
    await pool.query(
      `update recovery_action_candidates set status = 'NOTICE_QUEUED' where id = $1`,
      [candidateId],
    );
    const accepted = await sendQueuedAutopilotNotices(new Date("2026-08-24T00:00:00.000Z"), { workspaceId });
    assert.equal(accepted, 1);
    drainAutopilotTestNoticeSends();
    const notice = await pool.query<{ candidate_id: string; provider_message_id: string | null }>(
      `select candidate_id::text, provider_message_id from recovery_veto_notices where workspace_id = $1`,
      [workspaceId],
    );
    assert.ok(notice.rows[0]?.provider_message_id);
    await applyAutopilotNoticeEvent({
      providerEventId: `svix-clock-${suffix}`,
      type: "email.delivered",
      providerMessageId: notice.rows[0]!.provider_message_id!,
      occurredAt: "2026-08-24T01:00:00.000Z",
      payloadHash: "e".repeat(64),
    });
    const clock = await pool.query<{ notice_delivered_at: Date | null; veto_deadline_at: Date | null }>(
      `select notice_delivered_at, veto_deadline_at from recovery_action_candidates where id = $1`,
      [notice.rows[0]!.candidate_id],
    );
    assert.equal(clock.rows[0]?.notice_delivered_at, null);
    assert.equal(clock.rows[0]?.veto_deadline_at, null);
    await pool.query(
      `update recovery_veto_notices
       set delivery_status = 'QUEUED', provider_message_id = null
       where workspace_id = $1`,
      [workspaceId],
    );
    const stale = await sendQueuedAutopilotNotices(new Date("2026-08-25T02:00:00.000Z"), { workspaceId });
    assert.equal(stale, 0);
    const expired = await pool.query<{ n: string }>(
      `select count(*)::text as n from recovery_autopilot_dead_letters
       where workspace_id = $1 and last_error_code = 'IDEMPOTENCY_WINDOW_EXPIRED'`,
      [workspaceId],
    );
    assert.equal(expired.rows[0]?.n, "1");
  } finally {
    if (previous.notice === undefined) delete process.env.AUTOPILOT_NOTICE_ENABLED;
    else process.env.AUTOPILOT_NOTICE_ENABLED = previous.notice;
    if (previous.channel === undefined) delete process.env.AUTOPILOT_NOTICE_CHANNEL_READY;
    else process.env.AUTOPILOT_NOTICE_CHANNEL_READY = previous.channel;
    if (previous.adapter === undefined) delete process.env.AUTOPILOT_TEST_ADAPTER;
    else process.env.AUTOPILOT_TEST_ADAPTER = previous.adapter;
    if (previous.secret === undefined) delete process.env.AUTOPILOT_VETO_TOKEN_SECRET;
    else process.env.AUTOPILOT_VETO_TOKEN_SECRET = previous.secret;
    if (previous.proven === undefined) delete process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS;
    else process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = previous.proven;
    if (previous.from === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = previous.from;
    drainAutopilotTestNoticeSends();
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("currentlyEligibleAccounts falls when the provider is disabled, route proof is withdrawn, or notice readiness is false", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const previous = {
    notice: process.env.AUTOPILOT_NOTICE_ENABLED,
    channel: process.env.AUTOPILOT_NOTICE_CHANNEL_READY,
    proven: process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS,
  };
  process.env.AUTOPILOT_NOTICE_ENABLED = "true";
  process.env.AUTOPILOT_NOTICE_CHANNEL_READY = "true";
  process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = "openai";
  const { pool, ownerUserId, workspaceId, suffix } = await seedWorkspace();
  try {
    const first = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `integrity-eligible-1-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-july-eligible",
          text: "OpenAI subscription charged INR 1,999 on 6 July 2026. Renews monthly on 6 September 2026.",
        }],
      },
      now: new Date("2026-08-09T10:00:00.000Z"),
    });
    const second = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: first.workspaceVersion,
      idempotencyKey: `integrity-eligible-2-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-august-eligible",
          text: "OpenAI subscription charged INR 1,999 on 6 August 2026. Renews monthly on 6 September 2026.",
        }],
      },
      now: new Date("2026-08-09T11:00:00.000Z"),
    });
    await pool.query(`update recovery_commitments set confidence_score = 90 where workspace_id = $1`, [workspaceId]);
    await signStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: second.workspaceVersion,
      idempotencyKey: `integrity-eligible-sign-${suffix}`,
    });
    const baseline = await queryAutopilotFunnel(pool);
    assert.ok((baseline.currentlyEligibleAccounts ?? 0) >= 1);
    await pool.query(
      `insert into recovery_provider_disables (provider_id, disabled, reason)
       values ('openai', true, 'integrity disable')
       on conflict (provider_id) do update set disabled = true`,
    );
    const disabled = await queryAutopilotFunnel(pool);
    assert.equal(disabled.currentlyEligibleAccounts, baseline.currentlyEligibleAccounts - 1);
    await pool.query(`delete from recovery_provider_disables where provider_id = 'openai'`);
    delete process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS;
    const withdrawn = await queryAutopilotFunnel(pool);
    assert.equal(withdrawn.currentlyEligibleAccounts, 0);
    process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = "openai";
    process.env.AUTOPILOT_NOTICE_CHANNEL_READY = "false";
    const noticeOff = await queryAutopilotFunnel(pool);
    assert.equal(noticeOff.currentlyEligibleAccounts, 0);
  } finally {
    await pool.query(`delete from recovery_provider_disables where provider_id = 'openai'`).catch(() => undefined);
    if (previous.notice === undefined) delete process.env.AUTOPILOT_NOTICE_ENABLED;
    else process.env.AUTOPILOT_NOTICE_ENABLED = previous.notice;
    if (previous.channel === undefined) delete process.env.AUTOPILOT_NOTICE_CHANNEL_READY;
    else process.env.AUTOPILOT_NOTICE_CHANNEL_READY = previous.channel;
    if (previous.proven === undefined) delete process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS;
    else process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = previous.proven;
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("D30 connected-mandate cohort keeps revoked workspaces in the denominator", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const { pool, ownerUserId, workspaceId, suffix } = await seedWorkspace();
  try {
    const first = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `integrity-d30-1-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-july-d30",
          text: "OpenAI subscription charged INR 1,999 on 6 July 2026. Renews monthly on 6 August 2026.",
        }],
      },
      now: new Date("2026-08-09T10:00:00.000Z"),
    });
    const beforeSign = await queryAutopilotFunnel(pool);
    assert.equal(beforeSign.d30ConnectedRetention.status, "measured");
    const baselineEligible = beforeSign.d30ConnectedRetention.eligibleWorkspaces;
    const baselineReturned = beforeSign.d30ConnectedRetention.returned;
    if (typeof baselineEligible !== "number" || typeof baselineReturned !== "number") {
      throw new Error("D30 should be measured with numeric counts once the cohort table exists.");
    }
    await pool.query(
      `insert into recovery_connected_mandate_cohort (workspace_id, started_at, recorded_at)
       values ($1, now() - interval '40 days', now() - interval '40 days')`,
      [workspaceId],
    );
    const signed = await signStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: first.workspaceVersion,
      idempotencyKey: `integrity-d30-sign-${suffix}`,
    });
    const seededOld = await queryAutopilotFunnel(pool);
    assert.equal(seededOld.d30ConnectedRetention.eligibleWorkspaces, baselineEligible + 1);
    assert.equal(seededOld.d30ConnectedRetention.returned, baselineReturned + 1);
    await assert.rejects(
      () => pool.query(
        `update recovery_standing_mandates set signed_at = now() - interval '40 days' where workspace_id = $1`,
        [workspaceId],
      ),
      /Standing mandate terms cannot be mutated/i,
    );
    await pool.query(
      `update recovery_sources set ingested_at = now() - interval '40 days' where workspace_id = $1`,
      [workspaceId],
    );
    const liveDatesDoNotInventHistory = await queryAutopilotFunnel(pool);
    assert.equal(liveDatesDoNotInventHistory.d30ConnectedRetention.eligibleWorkspaces, baselineEligible + 1);
    await assert.rejects(
      () => pool.query(
        `update recovery_connected_mandate_cohort set started_at = now() - interval '90 days' where workspace_id = $1`,
        [workspaceId],
      ),
      isImmutableCohortError,
    );
    await assert.rejects(
      () => pool.query(
        `update recovery_connected_mandate_cohort set recorded_at = now() - interval '90 days' where workspace_id = $1`,
        [workspaceId],
      ),
      isImmutableCohortError,
    );
    await assert.rejects(
      () => pool.query(`delete from recovery_connected_mandate_cohort where workspace_id = $1`, [workspaceId]),
      isImmutableCohortError,
    );
    const source = await pool.query<{ id: string }>(
      `select id::text from recovery_sources where workspace_id = $1 limit 1`,
      [workspaceId],
    );
    assert.ok(source.rows[0]?.id);
    await pool.query(
      `insert into recovery_source_disconnections (workspace_id, source_id) values ($1, $2)`,
      [workspaceId, source.rows[0]!.id],
    );
    const afterDisconnect = await queryAutopilotFunnel(pool);
    assert.equal(afterDisconnect.d30ConnectedRetention.eligibleWorkspaces, seededOld.d30ConnectedRetention.eligibleWorkspaces);
    assert.equal(afterDisconnect.d30ConnectedRetention.returned, seededOld.d30ConnectedRetention.returned - 1);
    const revoked = await revokeStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: signed.workspaceVersion,
      idempotencyKey: `integrity-d30-revoke-${suffix}`,
    });
    const afterRevoke = await queryAutopilotFunnel(pool);
    assert.equal(afterRevoke.d30ConnectedRetention.eligibleWorkspaces, afterDisconnect.d30ConnectedRetention.eligibleWorkspaces);
    assert.equal(afterRevoke.d30ConnectedRetention.returned, afterDisconnect.d30ConnectedRetention.returned);
    await signStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: revoked.workspaceVersion,
      idempotencyKey: `integrity-d30-resign-${suffix}`,
    });
    const afterResign = await queryAutopilotFunnel(pool);
    assert.equal(afterResign.d30ConnectedRetention.eligibleWorkspaces, afterRevoke.d30ConnectedRetention.eligibleWorkspaces);
    assert.equal(afterResign.d30ConnectedRetention.returned, afterRevoke.d30ConnectedRetention.returned);
    const started = await pool.query<{ started_at: Date }>(
      `select started_at from recovery_connected_mandate_cohort where workspace_id = $1`,
      [workspaceId],
    );
    assert.ok(started.rows[0]?.started_at);
    const disconnected = await seedWorkspace();
    try {
      await signStandingMandate({
        workspaceId: disconnected.workspaceId,
        actorUserId: disconnected.ownerUserId,
        expectedVersion: 0,
        idempotencyKey: `integrity-d30-unsigned-source-${disconnected.suffix}`,
      });
      await assert.rejects(
        () => pool.query(
          `update recovery_standing_mandates set signed_at = now() - interval '40 days' where workspace_id = $1`,
          [disconnected.workspaceId],
        ),
        /Standing mandate terms cannot be mutated/i,
      );
      const afterNeverConnected = await queryAutopilotFunnel(pool);
      assert.equal(afterNeverConnected.d30ConnectedRetention.eligibleWorkspaces, afterResign.d30ConnectedRetention.eligibleWorkspaces);
    } finally {
      await disconnected.pool.query(`delete from workspaces where id = $1`, [disconnected.workspaceId]);
      await disconnected.pool.query(`delete from users where id = $1`, [disconnected.ownerUserId]);
    }
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("a short veto token cannot authorize after deliveredAt + 49h and leaves an actionable dead letter", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const previous = {
    notice: process.env.AUTOPILOT_NOTICE_ENABLED,
    channel: process.env.AUTOPILOT_NOTICE_CHANNEL_READY,
    adapter: process.env.AUTOPILOT_TEST_ADAPTER,
    secret: process.env.AUTOPILOT_VETO_TOKEN_SECRET,
    proven: process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS,
    from: process.env.RESEND_FROM_EMAIL,
    execution: process.env.AUTOPILOT_EXECUTION_ENABLED,
    shadow: process.env.AUTOPILOT_TEST_SHADOW_GATE_PASS,
  };
  process.env.AUTOPILOT_NOTICE_ENABLED = "true";
  process.env.AUTOPILOT_NOTICE_CHANNEL_READY = "true";
  process.env.AUTOPILOT_TEST_ADAPTER = "true";
  process.env.AUTOPILOT_VETO_TOKEN_SECRET = "veto-signing-secret-for-tests-32bytes!!";
  process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = "openai";
  process.env.RESEND_FROM_EMAIL = "notices@vognary.test";
  process.env.AUTOPILOT_EXECUTION_ENABLED = "true";
  process.env.AUTOPILOT_TEST_SHADOW_GATE_PASS = "true";
  drainAutopilotTestNoticeSends();
  const { pool, ownerUserId, workspaceId, suffix } = await seedWorkspace();
  try {
    const first = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `integrity-auth-clock-1-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-july-auth-clock",
          text: "OpenAI subscription charged INR 1,999 on 6 July 2026. Renews monthly on 6 September 2026.",
        }],
      },
      now: new Date("2026-08-09T10:00:00.000Z"),
    });
    const second = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: first.workspaceVersion,
      idempotencyKey: `integrity-auth-clock-2-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-august-auth-clock",
          text: "OpenAI subscription charged INR 1,999 on 6 August 2026. Renews monthly on 6 September 2026.",
        }],
      },
      now: new Date("2026-08-09T11:00:00.000Z"),
    });
    await pool.query(`update recovery_commitments set confidence_score = 90 where workspace_id = $1`, [workspaceId]);
    await signStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: second.workspaceVersion,
      idempotencyKey: `integrity-auth-clock-sign-${suffix}`,
    });
    const candidate = await pool.query<{ id: string }>(
      `select id::text from recovery_action_candidates where workspace_id = $1 limit 1`,
      [workspaceId],
    );
    const candidateId = candidate.rows[0]?.id;
    assert.ok(candidateId);
    await pool.query(
      `insert into recovery_veto_notices (workspace_id, candidate_id, channel, delivery_status, veto_expires_at)
       values ($1, $2, 'EMAIL', 'QUEUED', $3)`,
      [workspaceId, candidateId, "2026-08-24T12:00:00.000Z"],
    );
    await pool.query(
      `update recovery_action_candidates set status = 'NOTICE_QUEUED' where id = $1`,
      [candidateId],
    );
    const accepted = await sendQueuedAutopilotNotices(new Date("2026-08-24T00:00:00.000Z"), { workspaceId });
    assert.equal(accepted, 1);
    drainAutopilotTestNoticeSends();
    const notice = await pool.query<{ candidate_id: string; provider_message_id: string | null }>(
      `select candidate_id::text, provider_message_id from recovery_veto_notices where workspace_id = $1`,
      [workspaceId],
    );
    assert.ok(notice.rows[0]?.provider_message_id);
    await applyAutopilotNoticeEvent({
      providerEventId: `svix-auth-clock-${suffix}`,
      type: "email.delivered",
      providerMessageId: notice.rows[0]!.provider_message_id!,
      occurredAt: "2026-08-24T01:00:00.000Z",
      payloadHash: "a".repeat(64),
    });
    const clock = await pool.query<{
      status: string;
      notice_delivered_at: Date | null;
      veto_deadline_at: Date | null;
    }>(
      `select status, notice_delivered_at, veto_deadline_at from recovery_action_candidates where id = $1`,
      [notice.rows[0]!.candidate_id],
    );
    assert.equal(clock.rows[0]?.status, "NOTICE_QUEUED");
    assert.equal(clock.rows[0]?.notice_delivered_at, null);
    assert.equal(clock.rows[0]?.veto_deadline_at, null);
    const coverage = await pool.query<{ n: string }>(
      `select count(*)::text as n from recovery_autopilot_dead_letters
       where workspace_id = $1 and last_error_code = 'NOTICE_TOKEN_COVERAGE_INVALID'`,
      [workspaceId],
    );
    assert.equal(coverage.rows[0]?.n, "1");
    const authorized = await authorizeSilentCases(new Date("2026-08-26T02:00:00.000Z"));
    assert.equal(authorized.authorized, 0);
    const after = await pool.query<{ status: string }>(
      `select status from recovery_action_candidates where id = $1`,
      [notice.rows[0]!.candidate_id],
    );
    assert.equal(after.rows[0]?.status, "NOTICE_QUEUED");
    await assert.rejects(
      recordOperatorExecution({
        workspaceId,
        actorUserId: ownerUserId,
        candidateId: notice.rows[0]!.candidate_id,
        minutes: 6,
        outcome: "EXECUTED",
        proofKind: "MERCHANT_CONFIRMATION_EMAIL",
        proofReference: "msg-short-token",
        idempotencyKey: `integrity-auth-clock-exec-${suffix}`,
        now: new Date("2026-08-26T02:00:00.000Z"),
      }),
      /STATUS_NOT_AUTHORIZED|NOTICE_NOT_DELIVERED/,
    );
  } finally {
    if (previous.notice === undefined) delete process.env.AUTOPILOT_NOTICE_ENABLED;
    else process.env.AUTOPILOT_NOTICE_ENABLED = previous.notice;
    if (previous.channel === undefined) delete process.env.AUTOPILOT_NOTICE_CHANNEL_READY;
    else process.env.AUTOPILOT_NOTICE_CHANNEL_READY = previous.channel;
    if (previous.adapter === undefined) delete process.env.AUTOPILOT_TEST_ADAPTER;
    else process.env.AUTOPILOT_TEST_ADAPTER = previous.adapter;
    if (previous.secret === undefined) delete process.env.AUTOPILOT_VETO_TOKEN_SECRET;
    else process.env.AUTOPILOT_VETO_TOKEN_SECRET = previous.secret;
    if (previous.proven === undefined) delete process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS;
    else process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = previous.proven;
    if (previous.from === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = previous.from;
    if (previous.execution === undefined) delete process.env.AUTOPILOT_EXECUTION_ENABLED;
    else process.env.AUTOPILOT_EXECUTION_ENABLED = previous.execution;
    if (previous.shadow === undefined) delete process.env.AUTOPILOT_TEST_SHADOW_GATE_PASS;
    else process.env.AUTOPILOT_TEST_SHADOW_GATE_PASS = previous.shadow;
    drainAutopilotTestNoticeSends();
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("recovery evidence may be deleted only through whole-workspace privacy erasure", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const { pool, ownerUserId, workspaceId, suffix } = await seedWorkspace();
  try {
    const submitted = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `integrity-evidence-erase-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-erase",
          text: "OpenAI subscription charged INR 1,999 on 6 July 2026. Renews monthly on 6 August 2026.",
        }],
      },
      now: new Date("2026-08-09T10:00:00.000Z"),
    });
    await pool.query(
      `insert into recovery_connected_mandate_cohort (workspace_id, started_at, recorded_at)
       values ($1, now(), now())`,
      [workspaceId],
    );
    const eraseSource = await pool.query<{ id: string }>(
      `select id::text from recovery_sources where workspace_id = $1 limit 1`,
      [workspaceId],
    );
    await disconnectRecoverySource({
      workspaceId,
      actorUserId: ownerUserId,
      sourceId: eraseSource.rows[0]!.id,
      expectedVersion: submitted.workspaceVersion,
      idempotencyKey: `integrity-evidence-erase-disc-${suffix}`,
    });
    await assert.rejects(
      () => pool.query(`delete from recovery_evidence where workspace_id = $1`, [workspaceId]),
      isImmutableEvidenceError,
    );
    await assert.rejects(
      () => pool.query(`delete from recovery_sources where workspace_id = $1`, [workspaceId]),
      isImmutableEvidenceError,
    );
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    const leftover = await pool.query<{ evidence: string; sources: string; cohort: string; disconnections: string }>(
      `select
         (select count(*)::text from recovery_evidence where workspace_id = $1) as evidence,
         (select count(*)::text from recovery_sources where workspace_id = $1) as sources,
         (select count(*)::text from recovery_connected_mandate_cohort where workspace_id = $1) as cohort,
         (select count(*)::text from recovery_source_disconnections where workspace_id = $1) as disconnections`,
      [workspaceId],
    );
    assert.equal(leftover.rows[0]?.evidence, "0");
    assert.equal(leftover.rows[0]?.sources, "0");
    assert.equal(leftover.rows[0]?.cohort, "0");
    assert.equal(leftover.rows[0]?.disconnections, "0");
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]).catch(() => undefined);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("untagged Resend events are ignored, tagged unmatched events stay pending, and stale pending events dead-letter", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const suffix = randomUUID().slice(0, 8);
  const untaggedId = `svix-untagged-${suffix}`;
  const taggedId = `svix-tagged-hold-${suffix}`;
  const staleId = `svix-stale-pending-${suffix}`;
  const messageId = `resend-unbound-${suffix}`;
  try {
    const untagged = await applyAutopilotNoticeEvent({
      providerEventId: untaggedId,
      type: "email.delivered",
      providerMessageId: messageId,
      occurredAt: "2026-08-15T03:00:00.000Z",
      payloadHash: createHash("sha256").update(`untagged-${suffix}`).digest("hex"),
    });
    assert.equal(untagged.status, "ignored");
    const untaggedPending = await pool.query<{ n: string }>(
      `select count(*)::text as n from recovery_notice_pending_events where provider_event_id = $1`,
      [untaggedId],
    );
    assert.equal(untaggedPending.rows[0]?.n, "0");
    const tagged = await applyAutopilotNoticeEvent({
      providerEventId: taggedId,
      type: "email.delivered",
      providerMessageId: `${messageId}-tagged`,
      occurredAt: "2026-08-15T03:00:00.000Z",
      payloadHash: createHash("sha256").update(`tagged-${suffix}`).digest("hex"),
      tagged: true,
    });
    assert.equal(tagged.status, "pending");
    await pool.query(
      `insert into recovery_notice_pending_events (
         provider_event_id, event_type, provider_message_id, occurred_at, payload_hash, created_at
       ) values ($1, 'email.delivered', $2, $3, $4, now() - interval '25 hours')`,
      [staleId, `${messageId}-stale`, "2026-08-14T02:00:00.000Z", "b".repeat(64)],
    );
    const expired = await expireUnboundNoticeEvents();
    assert.ok(expired.expired >= 1);
    const leftover = await pool.query<{ n: string }>(
      `select count(*)::text as n from recovery_notice_pending_events where provider_event_id = $1`,
      [staleId],
    );
    assert.equal(leftover.rows[0]?.n, "0");
    const dead = await pool.query<{ n: string }>(
      `select count(*)::text as n from recovery_autopilot_dead_letters where last_error_code = 'UNBOUND_NOTICE_EVENT' and payload_hash = $1`,
      ["b".repeat(64)],
    );
    assert.equal(dead.rows[0]?.n, "1");
  } finally {
    await pool.query(`delete from recovery_notice_pending_events where provider_event_id = any($1::text[])`, [
      [untaggedId, taggedId, staleId],
    ]).catch(() => undefined);
    await pool.query(`delete from recovery_autopilot_dead_letters where payload_hash = $1`, ["b".repeat(64)]).catch(() => undefined);
  }
});

test("stale pending events that now match an ACCEPTED notice are reconciled instead of dead-lettered", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const previous = {
    notice: process.env.AUTOPILOT_NOTICE_ENABLED,
    channel: process.env.AUTOPILOT_NOTICE_CHANNEL_READY,
    adapter: process.env.AUTOPILOT_TEST_ADAPTER,
    secret: process.env.AUTOPILOT_VETO_TOKEN_SECRET,
    proven: process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS,
    from: process.env.RESEND_FROM_EMAIL,
  };
  process.env.AUTOPILOT_NOTICE_ENABLED = "true";
  process.env.AUTOPILOT_NOTICE_CHANNEL_READY = "true";
  process.env.AUTOPILOT_TEST_ADAPTER = "true";
  process.env.AUTOPILOT_VETO_TOKEN_SECRET = "veto-signing-secret-for-tests-32bytes!!";
  process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = "openai";
  process.env.RESEND_FROM_EMAIL = "notices@vognary.test";
  drainAutopilotTestNoticeSends();
  const { pool, ownerUserId, workspaceId, suffix } = await seedWorkspace();
  const pendingId = `svix-reconcile-${suffix}`;
  const unmatchedId = `svix-unmatched-${suffix}`;
  try {
    const first = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `integrity-reconcile-1-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-july-reconcile",
          text: "OpenAI subscription charged INR 1,999 on 6 July 2026. Renews monthly on 6 September 2026.",
        }],
      },
      now: new Date("2026-08-09T10:00:00.000Z"),
    });
    const second = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: first.workspaceVersion,
      idempotencyKey: `integrity-reconcile-2-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-august-reconcile",
          text: "OpenAI subscription charged INR 1,999 on 6 August 2026. Renews monthly on 6 September 2026.",
        }],
      },
      now: new Date("2026-08-09T11:00:00.000Z"),
    });
    await pool.query(`update recovery_commitments set confidence_score = 90 where workspace_id = $1`, [workspaceId]);
    await signStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: second.workspaceVersion,
      idempotencyKey: `integrity-reconcile-sign-${suffix}`,
    });
    await queueDueNotices(new Date("2026-08-24T00:00:00.000Z"));
    const notice = await pool.query<{ candidate_id: string; provider_message_id: string | null; delivery_status: string }>(
      `select candidate_id::text, provider_message_id, delivery_status
       from recovery_veto_notices where workspace_id = $1`,
      [workspaceId],
    );
    assert.equal(notice.rows[0]?.delivery_status, "ACCEPTED");
    assert.ok(notice.rows[0]?.provider_message_id);
    const payloadHash = createHash("sha256").update(`reconcile-${suffix}`).digest("hex");
    await pool.query(
      `insert into recovery_notice_pending_events (
         provider_event_id, event_type, provider_message_id, occurred_at, payload_hash, created_at
       ) values ($1, 'email.delivered', $2, $3, $4, now() - interval '25 hours')`,
      [pendingId, notice.rows[0]!.provider_message_id, "2026-08-24T00:05:00.000Z", payloadHash],
    );
    await pool.query(
      `insert into recovery_notice_pending_events (
         provider_event_id, event_type, provider_message_id, occurred_at, payload_hash, created_at
       ) values ($1, 'email.delivered', $2, $3, $4, now() - interval '25 hours')`,
      [unmatchedId, `resend-unmatched-${suffix}`, "2026-08-24T00:05:00.000Z", "c".repeat(64)],
    );
    const expired = await expireUnboundNoticeEvents();
    assert.ok(expired.reconciled >= 1);
    assert.ok(expired.expired >= 1);
    const leftoverMatched = await pool.query<{ n: string }>(
      `select count(*)::text as n from recovery_notice_pending_events where provider_event_id = $1`,
      [pendingId],
    );
    assert.equal(leftoverMatched.rows[0]?.n, "0");
    const deadMatched = await pool.query<{ n: string }>(
      `select count(*)::text as n from recovery_autopilot_dead_letters where last_error_code = 'UNBOUND_NOTICE_EVENT' and payload_hash = $1`,
      [payloadHash],
    );
    assert.equal(deadMatched.rows[0]?.n, "0");
    const clock = await pool.query<{
      status: string;
      notice_delivered_at: Date | null;
      veto_deadline_at: Date | null;
      delivery_status: string;
    }>(
      `select candidate.status, candidate.notice_delivered_at, candidate.veto_deadline_at, notice.delivery_status
       from recovery_action_candidates candidate
       join recovery_veto_notices notice
         on notice.workspace_id = candidate.workspace_id and notice.candidate_id = candidate.id
       where candidate.workspace_id = $1`,
      [workspaceId],
    );
    assert.equal(clock.rows[0]?.delivery_status, "DELIVERED");
    assert.ok(clock.rows[0]?.notice_delivered_at);
    assert.ok(clock.rows[0]?.veto_deadline_at);
    const leftoverUnmatched = await pool.query<{ n: string }>(
      `select count(*)::text as n from recovery_notice_pending_events where provider_event_id = $1`,
      [unmatchedId],
    );
    assert.equal(leftoverUnmatched.rows[0]?.n, "0");
    const deadUnmatched = await pool.query<{ n: string }>(
      `select count(*)::text as n from recovery_autopilot_dead_letters where last_error_code = 'UNBOUND_NOTICE_EVENT' and payload_hash = $1`,
      ["c".repeat(64)],
    );
    assert.equal(deadUnmatched.rows[0]?.n, "1");
  } finally {
    if (previous.notice === undefined) delete process.env.AUTOPILOT_NOTICE_ENABLED;
    else process.env.AUTOPILOT_NOTICE_ENABLED = previous.notice;
    if (previous.channel === undefined) delete process.env.AUTOPILOT_NOTICE_CHANNEL_READY;
    else process.env.AUTOPILOT_NOTICE_CHANNEL_READY = previous.channel;
    if (previous.adapter === undefined) delete process.env.AUTOPILOT_TEST_ADAPTER;
    else process.env.AUTOPILOT_TEST_ADAPTER = previous.adapter;
    if (previous.secret === undefined) delete process.env.AUTOPILOT_VETO_TOKEN_SECRET;
    else process.env.AUTOPILOT_VETO_TOKEN_SECRET = previous.secret;
    if (previous.proven === undefined) delete process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS;
    else process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = previous.proven;
    if (previous.from === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = previous.from;
    drainAutopilotTestNoticeSends();
    await pool.query(`delete from recovery_notice_pending_events where provider_event_id = any($1::text[])`, [
      [pendingId, unmatchedId],
    ]).catch(() => undefined);
    await pool.query(`delete from recovery_autopilot_dead_letters where payload_hash = any($1::text[])`, [
      ["c".repeat(64)],
    ]).catch(() => undefined);
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("source disconnect uses the canonical writer: no cohort before sign, retained D30 after, withdrawn queued candidates, explicit reconnect", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const previous = {
    notice: process.env.AUTOPILOT_NOTICE_ENABLED,
    channel: process.env.AUTOPILOT_NOTICE_CHANNEL_READY,
    proven: process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS,
    adapter: process.env.AUTOPILOT_TEST_ADAPTER,
    secret: process.env.AUTOPILOT_VETO_TOKEN_SECRET,
  };
  process.env.AUTOPILOT_NOTICE_ENABLED = "true";
  process.env.AUTOPILOT_NOTICE_CHANNEL_READY = "true";
  process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = "openai";
  process.env.AUTOPILOT_TEST_ADAPTER = "true";
  process.env.AUTOPILOT_VETO_TOKEN_SECRET = "veto-signing-secret-for-tests-32bytes!!";
  const beforeSign = await seedWorkspace();
  const afterCohort = await seedWorkspace();
  try {
    const unsigned = await submitRecoveryEvidence({
      workspaceId: beforeSign.workspaceId,
      actorUserId: beforeSign.ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `integrity-disc-before-1-${beforeSign.suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-july-disc-before",
          text: "OpenAI subscription charged INR 1,999 on 6 July 2026. Renews monthly on 6 August 2026.",
        }],
      },
      now: new Date("2026-08-09T10:00:00.000Z"),
    });
    const sourceBefore = await beforeSign.pool.query<{ id: string }>(
      `select id::text from recovery_sources where workspace_id = $1 limit 1`,
      [beforeSign.workspaceId],
    );
    const shadowBeforeDisconnect = await measureShadowGate();
    const disconnectedBefore = await disconnectRecoverySource({
      workspaceId: beforeSign.workspaceId,
      actorUserId: beforeSign.ownerUserId,
      sourceId: sourceBefore.rows[0]!.id,
      expectedVersion: unsigned.workspaceVersion,
      idempotencyKey: `integrity-disc-before-${beforeSign.suffix}`,
    });
    await signStandingMandate({
      workspaceId: beforeSign.workspaceId,
      actorUserId: beforeSign.ownerUserId,
      expectedVersion: disconnectedBefore.workspaceVersion,
      idempotencyKey: `integrity-disc-before-sign-${beforeSign.suffix}`,
    });
    const cohortBefore = await beforeSign.pool.query<{ n: string }>(
      `select count(*)::text as n from recovery_connected_mandate_cohort where workspace_id = $1`,
      [beforeSign.workspaceId],
    );
    assert.equal(cohortBefore.rows[0]?.n, "0");
    const shadowAfterUnsignedDisconnect = await measureShadowGate();
    assert.equal(shadowAfterUnsignedDisconnect.connectedMandates, shadowBeforeDisconnect.connectedMandates);

    const first = await submitRecoveryEvidence({
      workspaceId: afterCohort.workspaceId,
      actorUserId: afterCohort.ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `integrity-disc-after-1-${afterCohort.suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-july-disc-after",
          text: "OpenAI subscription charged INR 1,999 on 6 July 2026. Renews monthly on 6 September 2026.",
        }],
      },
      now: new Date("2026-08-09T10:00:00.000Z"),
    });
    const second = await submitRecoveryEvidence({
      workspaceId: afterCohort.workspaceId,
      actorUserId: afterCohort.ownerUserId,
      expectedVersion: first.workspaceVersion,
      idempotencyKey: `integrity-disc-after-2-${afterCohort.suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-august-disc-after",
          text: "OpenAI subscription charged INR 1,999 on 6 August 2026. Renews monthly on 6 September 2026.",
        }],
      },
      now: new Date("2026-08-09T11:00:00.000Z"),
    });
    await afterCohort.pool.query(`update recovery_commitments set confidence_score = 90 where workspace_id = $1`, [afterCohort.workspaceId]);
    await afterCohort.pool.query(
      `insert into recovery_connected_mandate_cohort (workspace_id, started_at, recorded_at)
       values ($1, now() - interval '40 days', now() - interval '40 days')`,
      [afterCohort.workspaceId],
    );
    const signed = await signStandingMandate({
      workspaceId: afterCohort.workspaceId,
      actorUserId: afterCohort.ownerUserId,
      expectedVersion: second.workspaceVersion,
      idempotencyKey: `integrity-disc-after-sign-${afterCohort.suffix}`,
    });
    const cohortExists = await afterCohort.pool.query<{ n: string; started_at: Date }>(
      `select count(*)::text as n, min(started_at) as started_at
       from recovery_connected_mandate_cohort where workspace_id = $1`,
      [afterCohort.workspaceId],
    );
    assert.equal(cohortExists.rows[0]?.n, "1");
    assert.ok(cohortExists.rows[0]!.started_at.getTime() < Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sourcesAfter = await afterCohort.pool.query<{ id: string }>(
      `select id::text from recovery_sources where workspace_id = $1 order by ingested_at asc, id asc`,
      [afterCohort.workspaceId],
    );
    assert.ok(sourcesAfter.rows.length >= 2);
    const funnelBefore = await queryAutopilotFunnel(afterCohort.pool);
    const shadowBefore = await measureShadowGate();
    const candidatesBefore = await afterCohort.pool.query<{ id: string; status: string }>(
      `select id::text, status from recovery_action_candidates where workspace_id = $1`,
      [afterCohort.workspaceId],
    );
    assert.ok(candidatesBefore.rows.some((row) => row.status === "SHADOW"));
    const firstDisconnect = await disconnectRecoverySource({
      workspaceId: afterCohort.workspaceId,
      actorUserId: afterCohort.ownerUserId,
      sourceId: sourcesAfter.rows[0]!.id,
      expectedVersion: signed.workspaceVersion,
      idempotencyKey: `integrity-disc-after-first-${afterCohort.suffix}`,
    });
    assert.ok(firstDisconnect.disconnection.withdrawnCandidateIds.length >= 1);
    const stillQueued = await afterCohort.pool.query<{ status: string }>(
      `select status from recovery_action_candidates where workspace_id = $1`,
      [afterCohort.workspaceId],
    );
    assert.ok(stillQueued.rows.every((row) => row.status === "WITHDRAWN"));
    const funnelPartial = await queryAutopilotFunnel(afterCohort.pool);
    assert.equal(funnelPartial.connectedActiveMandates, funnelBefore.connectedActiveMandates);
    let version = firstDisconnect.workspaceVersion;
    let lastDisconnect = firstDisconnect;
    for (const source of sourcesAfter.rows.slice(1)) {
      lastDisconnect = await disconnectRecoverySource({
        workspaceId: afterCohort.workspaceId,
        actorUserId: afterCohort.ownerUserId,
        sourceId: source.id,
        expectedVersion: version,
        idempotencyKey: `integrity-disc-after-${source.id}`,
      });
      version = lastDisconnect.workspaceVersion;
    }
    const candidatesAfter = await afterCohort.pool.query<{ id: string; status: string }>(
      `select id::text, status from recovery_action_candidates where workspace_id = $1`,
      [afterCohort.workspaceId],
    );
    assert.ok(candidatesAfter.rows.every((row) => row.status === "WITHDRAWN"));
    await assert.rejects(
      recordOperatorExecution({
        workspaceId: afterCohort.workspaceId,
        actorUserId: afterCohort.ownerUserId,
        candidateId: candidatesAfter.rows[0]!.id,
        minutes: 12,
        outcome: "EXECUTED",
        proofKind: "MERCHANT_CONFIRMATION_EMAIL",
        proofReference: "msg-disconnected-source",
        idempotencyKey: `integrity-disc-exec-${afterCohort.suffix}`,
      }),
      /SOURCE_DISCONNECTED|STATUS_NOT_AUTHORIZED|FORBIDDEN/,
    );
    const funnelAfter = await queryAutopilotFunnel(afterCohort.pool);
    assert.equal(funnelAfter.d30ConnectedRetention.eligibleWorkspaces, funnelBefore.d30ConnectedRetention.eligibleWorkspaces);
    assert.equal(funnelAfter.d30ConnectedRetention.returned, (funnelBefore.d30ConnectedRetention.returned ?? 0) - 1);
    assert.equal(funnelAfter.connectedActiveMandates, funnelBefore.connectedActiveMandates - 1);
    const shadowAfter = await measureShadowGate();
    assert.equal(shadowAfter.connectedMandates, shadowBefore.connectedMandates - 1);
    assert.ok(shadowAfter.eligibleCandidates < shadowBefore.eligibleCandidates);
    let reconnectVersion = lastDisconnect.workspaceVersion;
    for (const source of sourcesAfter.rows) {
      const reconnected = await reconnectRecoverySource({
        workspaceId: afterCohort.workspaceId,
        actorUserId: afterCohort.ownerUserId,
        sourceId: source.id,
        expectedVersion: reconnectVersion,
        idempotencyKey: `integrity-disc-reconnect-${source.id}`,
      });
      reconnectVersion = reconnected.workspaceVersion;
      assert.ok(reconnected.disconnection.reconnectedAt);
    }
    const funnelReconnected = await queryAutopilotFunnel(afterCohort.pool);
    assert.equal(funnelReconnected.connectedActiveMandates, funnelBefore.connectedActiveMandates);
    const restored = await afterCohort.pool.query<{ status: string }>(
      `select status from recovery_action_candidates where workspace_id = $1`,
      [afterCohort.workspaceId],
    );
    assert.ok(restored.rows.some((row) => row.status === "SHADOW"));
    assert.ok(restored.rows.every((row) => row.status !== "AUTHORIZED_BY_RULE"));
    const shadowReconnected = await measureShadowGate();
    assert.equal(shadowReconnected.connectedMandates, shadowBefore.connectedMandates);
  } finally {
    if (previous.notice === undefined) delete process.env.AUTOPILOT_NOTICE_ENABLED;
    else process.env.AUTOPILOT_NOTICE_ENABLED = previous.notice;
    if (previous.channel === undefined) delete process.env.AUTOPILOT_NOTICE_CHANNEL_READY;
    else process.env.AUTOPILOT_NOTICE_CHANNEL_READY = previous.channel;
    if (previous.proven === undefined) delete process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS;
    else process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = previous.proven;
    if (previous.adapter === undefined) delete process.env.AUTOPILOT_TEST_ADAPTER;
    else process.env.AUTOPILOT_TEST_ADAPTER = previous.adapter;
    if (previous.secret === undefined) delete process.env.AUTOPILOT_VETO_TOKEN_SECRET;
    else process.env.AUTOPILOT_VETO_TOKEN_SECRET = previous.secret;
    await beforeSign.pool.query(`delete from workspaces where id = $1`, [beforeSign.workspaceId]).catch(() => undefined);
    await beforeSign.pool.query(`delete from users where id = $1`, [beforeSign.ownerUserId]).catch(() => undefined);
    await afterCohort.pool.query(`delete from workspaces where id = $1`, [afterCohort.workspaceId]).catch(() => undefined);
    await afterCohort.pool.query(`delete from users where id = $1`, [afterCohort.ownerUserId]).catch(() => undefined);
  }
});

test("disconnecting a cited source withdraws only affected queued candidates and blocks execution while an unrelated source remains", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const previous = {
    notice: process.env.AUTOPILOT_NOTICE_ENABLED,
    channel: process.env.AUTOPILOT_NOTICE_CHANNEL_READY,
    proven: process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS,
    adapter: process.env.AUTOPILOT_TEST_ADAPTER,
    secret: process.env.AUTOPILOT_VETO_TOKEN_SECRET,
    execution: process.env.AUTOPILOT_EXECUTION_ENABLED,
    shadowPass: process.env.AUTOPILOT_TEST_SHADOW_GATE_PASS,
  };
  process.env.AUTOPILOT_NOTICE_ENABLED = "true";
  process.env.AUTOPILOT_NOTICE_CHANNEL_READY = "true";
  process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = "openai,notion";
  process.env.AUTOPILOT_TEST_ADAPTER = "true";
  process.env.AUTOPILOT_VETO_TOKEN_SECRET = "veto-signing-secret-for-tests-32bytes!!";
  process.env.AUTOPILOT_EXECUTION_ENABLED = "true";
  process.env.AUTOPILOT_TEST_SHADOW_GATE_PASS = "true";
  const { pool, ownerUserId, workspaceId, suffix } = await seedWorkspace();
  try {
    const openaiVersion = await submitMerchantReceipts({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      suffix,
      merchant: "OpenAI",
      now: new Date("2026-08-09T10:00:00.000Z"),
    });
    const notionVersion = await submitMerchantReceipts({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: openaiVersion,
      suffix,
      merchant: "Notion",
      now: new Date("2026-08-09T11:00:00.000Z"),
    });
    await pool.query(`update recovery_commitments set confidence_score = 90 where workspace_id = $1`, [workspaceId]);
    const signed = await signStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: notionVersion,
      idempotencyKey: `cited-source-sign-${suffix}`,
    });
    const candidates = await pool.query<{ id: string; status: string; merchant: string; commitment_id: string }>(
      `select candidate.id::text, candidate.status, candidate.commitment_id::text, commitment.effective_merchant as merchant
       from recovery_action_candidates candidate
       join recovery_commitments commitment
         on commitment.workspace_id = candidate.workspace_id and commitment.id = candidate.commitment_id
       where candidate.workspace_id = $1`,
      [workspaceId],
    );
    const openai = candidates.rows.find((row) => /openai/i.test(row.merchant));
    const notion = candidates.rows.find((row) => /notion/i.test(row.merchant));
    assert.ok(openai);
    assert.ok(notion);
    const openaiId = openai.id;
    const notionId = notion.id;
    assert.equal(openai.status, "SHADOW");
    assert.equal(notion.status, "SHADOW");
    await pool.query(
      `update recovery_action_candidates
       set status = 'NOTICE_QUEUED',
           notice_delivered_at = now() - interval '49 hours',
           veto_deadline_at = now() - interval '1 hour'
       where workspace_id = $1 and id = $2`,
      [workspaceId, openaiId],
    );
    await pool.query(
      `insert into recovery_veto_notices (
         workspace_id, candidate_id, channel, delivery_status, provider_message_id,
         delivered_at, provider_timestamp
       ) values ($1, $2, 'EMAIL', 'DELIVERED', $3, now() - interval '49 hours', now() - interval '49 hours')`,
      [workspaceId, openaiId, `stale-classification-notice-${suffix}`],
    );
    const sources = await pool.query<{ id: string; merchant: string }>(
      `select distinct source.id::text, evidence.normalized_merchant as merchant
       from recovery_sources source
       join recovery_evidence evidence
         on evidence.workspace_id = source.workspace_id and evidence.source_id = source.id
       where source.workspace_id = $1`,
      [workspaceId],
    );
    const openaiSources = sources.rows.filter((row) => /openai/i.test(row.merchant));
    const notionSources = sources.rows.filter((row) => /notion/i.test(row.merchant));
    assert.ok(openaiSources.length >= 1);
    assert.ok(notionSources.length >= 1);
    const funnelBefore = await queryAutopilotFunnel(pool);
    let version = signed.workspaceVersion;
    const withdrawnIds = new Set<string>();
    for (const source of openaiSources) {
      const disconnected = await disconnectRecoverySource({
        workspaceId,
        actorUserId: ownerUserId,
        sourceId: source.id,
        expectedVersion: version,
        idempotencyKey: `cited-source-disc-${source.id}`,
      });
      version = disconnected.workspaceVersion;
      for (const id of disconnected.disconnection.withdrawnCandidateIds) withdrawnIds.add(id);
    }
    assert.ok(withdrawnIds.has(openaiId));
    assert.equal(withdrawnIds.has(notionId), false);
    const afterDisconnect = await pool.query<{ id: string; status: string; merchant: string }>(
      `select candidate.id::text, candidate.status, commitment.effective_merchant as merchant
       from recovery_action_candidates candidate
       join recovery_commitments commitment
         on commitment.workspace_id = candidate.workspace_id and commitment.id = candidate.commitment_id
       where candidate.workspace_id = $1`,
      [workspaceId],
    );
    assert.equal(afterDisconnect.rows.find((row) => row.id === openaiId)?.status, "WITHDRAWN");
    assert.equal(afterDisconnect.rows.find((row) => row.id === notionId)?.status, "SHADOW");
    const funnelPartial = await queryAutopilotFunnel(pool);
    assert.equal(funnelPartial.connectedActiveMandates, funnelBefore.connectedActiveMandates);
    await assert.rejects(
      recordOperatorExecution({
        workspaceId,
        actorUserId: ownerUserId,
        candidateId: openaiId,
        minutes: 12,
        outcome: "EXECUTED",
        proofKind: "MERCHANT_CONFIRMATION_EMAIL",
        proofReference: "msg-cited-source-disconnected",
        idempotencyKey: `cited-source-exec-${suffix}`,
      }),
      /SOURCE_DISCONNECTED/,
    );
    await assert.rejects(
      recordOperatorExecution({
        workspaceId,
        actorUserId: ownerUserId,
        candidateId: notionId,
        minutes: 12,
        outcome: "EXECUTED",
        proofKind: "CANCELLATION_RECEIPT",
        proofReference: "msg-unrelated-source-still-connected",
        idempotencyKey: `cited-source-notion-exec-${suffix}`,
      }),
      /STATUS_NOT_AUTHORIZED/,
    );
    const corrected = await createRecoveryCorrection({
      workspaceId,
      actorUserId: ownerUserId,
      commitmentId: openai.commitment_id,
      expectedVersion: version,
      idempotencyKey: `cited-source-correction-${suffix}`,
      request: {
        patch: { field: "AMOUNT", value: { amountMinor: "299900" } },
        reason: "Correction while the cited source is disconnected must invalidate the old candidate snapshot.",
      },
    });
    version = corrected.workspaceVersion;
    for (const source of openaiSources) {
      const reconnected = await reconnectRecoverySource({
        workspaceId,
        actorUserId: ownerUserId,
        sourceId: source.id,
        expectedVersion: version,
        idempotencyKey: `cited-source-reconn-${source.id}`,
      });
      version = reconnected.workspaceVersion;
      const statuses = await pool.query<{ id: string; status: string }>(
        `select id::text, status from recovery_action_candidates where workspace_id = $1`,
        [workspaceId],
      );
      const openaiStatus = statuses.rows.find((row) => row.id === openaiId)?.status;
      const notionStatus = statuses.rows.find((row) => row.id === notionId)?.status;
      assert.equal(notionStatus, "SHADOW");
      assert.equal(openaiStatus, "WITHDRAWN");
    }
    const staleCandidate = await pool.query<{ status: string; eligibility: string; current_snapshot: boolean }>(
      `select candidate.status, candidate.eligibility,
              candidate.classification_snapshot_id = (
                select newer.id from recovery_classification_snapshots newer
                where newer.workspace_id = candidate.workspace_id
                  and newer.commitment_id = candidate.commitment_id
                order by newer.created_at desc, newer.id desc limit 1
              ) as current_snapshot
       from recovery_action_candidates candidate
       where candidate.workspace_id = $1 and candidate.id = $2`,
      [workspaceId, openaiId],
    );
    assert.deepEqual(staleCandidate.rows[0], {
      status: "WITHDRAWN",
      eligibility: "INELIGIBLE",
      current_snapshot: true,
    });
    const authorized = await authorizeSilentCases(new Date());
    assert.equal(authorized.authorized, 0);
    const staleNoticeReuse = await pool.query<{ n: string }>(
      `select count(*)::text as n
       from recovery_candidate_events
       where workspace_id = $1 and candidate_id = $2
         and status in ('NOTICE_QUEUED', 'AUTHORIZED_BY_RULE')
         and reason_code in ('source-reconnected', 'silence-authorized')`,
      [workspaceId, openaiId],
    );
    assert.equal(staleNoticeReuse.rows[0]?.n, "0");
  } finally {
    if (previous.notice === undefined) delete process.env.AUTOPILOT_NOTICE_ENABLED;
    else process.env.AUTOPILOT_NOTICE_ENABLED = previous.notice;
    if (previous.channel === undefined) delete process.env.AUTOPILOT_NOTICE_CHANNEL_READY;
    else process.env.AUTOPILOT_NOTICE_CHANNEL_READY = previous.channel;
    if (previous.proven === undefined) delete process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS;
    else process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = previous.proven;
    if (previous.adapter === undefined) delete process.env.AUTOPILOT_TEST_ADAPTER;
    else process.env.AUTOPILOT_TEST_ADAPTER = previous.adapter;
    if (previous.secret === undefined) delete process.env.AUTOPILOT_VETO_TOKEN_SECRET;
    else process.env.AUTOPILOT_VETO_TOKEN_SECRET = previous.secret;
    if (previous.execution === undefined) delete process.env.AUTOPILOT_EXECUTION_ENABLED;
    else process.env.AUTOPILOT_EXECUTION_ENABLED = previous.execution;
    if (previous.shadowPass === undefined) delete process.env.AUTOPILOT_TEST_SHADOW_GATE_PASS;
    else process.env.AUTOPILOT_TEST_SHADOW_GATE_PASS = previous.shadowPass;
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]).catch(() => undefined);
    await pool.query(`delete from users where id = $1`, [ownerUserId]).catch(() => undefined);
  }
});

test("frozen veto notice payload fields cannot be mutated after frozen_at", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const previous = {
    notice: process.env.AUTOPILOT_NOTICE_ENABLED,
    channel: process.env.AUTOPILOT_NOTICE_CHANNEL_READY,
    adapter: process.env.AUTOPILOT_TEST_ADAPTER,
    secret: process.env.AUTOPILOT_VETO_TOKEN_SECRET,
    proven: process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS,
    from: process.env.RESEND_FROM_EMAIL,
  };
  process.env.AUTOPILOT_NOTICE_ENABLED = "true";
  process.env.AUTOPILOT_NOTICE_CHANNEL_READY = "true";
  process.env.AUTOPILOT_TEST_ADAPTER = "true";
  process.env.AUTOPILOT_VETO_TOKEN_SECRET = "veto-signing-secret-for-tests-32bytes!!";
  process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = "openai";
  process.env.RESEND_FROM_EMAIL = "notices@vognary.test";
  drainAutopilotTestNoticeSends();
  const { pool, ownerUserId, workspaceId, suffix } = await seedWorkspace();
  try {
    const version = await submitMerchantReceipts({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      suffix,
      merchant: "OpenAI",
      now: new Date("2026-08-09T10:00:00.000Z"),
    });
    await pool.query(`update recovery_commitments set confidence_score = 90 where workspace_id = $1`, [workspaceId]);
    await signStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: version,
      idempotencyKey: `frozen-notice-sign-${suffix}`,
    });
    process.env.AUTOPILOT_TEST_NOTICE_PERSIST_CRASH = "true";
    await assert.rejects(
      queueDueNotices(new Date("2026-08-24T00:00:00.000Z")),
      /notice-persist-crash/,
    );
    delete process.env.AUTOPILOT_TEST_NOTICE_PERSIST_CRASH;
    const frozen = await pool.query<{
      notice_text: string;
      notice_tags: unknown;
      frozen_at: Date | null;
    }>(
      `select notice_text, notice_tags, frozen_at from recovery_veto_notices where workspace_id = $1`,
      [workspaceId],
    );
    assert.ok(frozen.rows[0]?.frozen_at);
    const originalText = frozen.rows[0]!.notice_text;
    await assert.rejects(
      pool.query(`update recovery_veto_notices set notice_text = 'mutated after freeze' where workspace_id = $1`, [workspaceId]),
      /frozen notice payload cannot be mutated/i,
    );
    await assert.rejects(
      pool.query(
        `update recovery_veto_notices
         set notice_tags = $2::jsonb
         where workspace_id = $1`,
        [workspaceId, JSON.stringify([{ name: "vognary", value: "mutated-tag" }])],
      ),
      /frozen notice payload cannot be mutated/i,
    );
    await assert.rejects(
      pool.query(`delete from recovery_veto_notices where workspace_id = $1`, [workspaceId]),
      /Frozen notice cannot be deleted directly/i,
    );
    await pool.query(
      `update recovery_veto_notices set delivery_status = 'ACCEPTED', provider_message_id = $2
       where workspace_id = $1`,
      [workspaceId, `msg-frozen-delivery-${suffix}`],
    );
    const stored = await pool.query<{ notice_text: string; delivery_status: string }>(
      `select notice_text, delivery_status from recovery_veto_notices where workspace_id = $1`,
      [workspaceId],
    );
    assert.equal(stored.rows[0]?.notice_text, originalText);
    assert.equal(stored.rows[0]?.delivery_status, "ACCEPTED");
  } finally {
    delete process.env.AUTOPILOT_TEST_NOTICE_PERSIST_CRASH;
    if (previous.notice === undefined) delete process.env.AUTOPILOT_NOTICE_ENABLED;
    else process.env.AUTOPILOT_NOTICE_ENABLED = previous.notice;
    if (previous.channel === undefined) delete process.env.AUTOPILOT_NOTICE_CHANNEL_READY;
    else process.env.AUTOPILOT_NOTICE_CHANNEL_READY = previous.channel;
    if (previous.adapter === undefined) delete process.env.AUTOPILOT_TEST_ADAPTER;
    else process.env.AUTOPILOT_TEST_ADAPTER = previous.adapter;
    if (previous.secret === undefined) delete process.env.AUTOPILOT_VETO_TOKEN_SECRET;
    else process.env.AUTOPILOT_VETO_TOKEN_SECRET = previous.secret;
    if (previous.proven === undefined) delete process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS;
    else process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = previous.proven;
    if (previous.from === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = previous.from;
    drainAutopilotTestNoticeSends();
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]).catch(() => undefined);
    await pool.query(`delete from users where id = $1`, [ownerUserId]).catch(() => undefined);
  }
});

test("retrying a frozen notice after the stored tags change keeps the persisted provider payload", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const previous = {
    notice: process.env.AUTOPILOT_NOTICE_ENABLED,
    channel: process.env.AUTOPILOT_NOTICE_CHANNEL_READY,
    adapter: process.env.AUTOPILOT_TEST_ADAPTER,
    secret: process.env.AUTOPILOT_VETO_TOKEN_SECRET,
    proven: process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS,
    from: process.env.RESEND_FROM_EMAIL,
  };
  process.env.AUTOPILOT_NOTICE_ENABLED = "true";
  process.env.AUTOPILOT_NOTICE_CHANNEL_READY = "true";
  process.env.AUTOPILOT_TEST_ADAPTER = "true";
  process.env.AUTOPILOT_VETO_TOKEN_SECRET = "veto-signing-secret-for-tests-32bytes!!";
  process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = "openai";
  process.env.RESEND_FROM_EMAIL = "notices@vognary.test";
  drainAutopilotTestNoticeSends();
  const { pool, ownerUserId, workspaceId, suffix } = await seedWorkspace();
  try {
    const first = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `integrity-tags-1-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-july-tags",
          text: "OpenAI subscription charged INR 1,999 on 6 July 2026. Renews monthly on 6 September 2026.",
        }],
      },
      now: new Date("2026-08-09T10:00:00.000Z"),
    });
    const second = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: first.workspaceVersion,
      idempotencyKey: `integrity-tags-2-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-august-tags",
          text: "OpenAI subscription charged INR 1,999 on 6 August 2026. Renews monthly on 6 September 2026.",
        }],
      },
      now: new Date("2026-08-09T11:00:00.000Z"),
    });
    await pool.query(`update recovery_commitments set confidence_score = 90 where workspace_id = $1`, [workspaceId]);
    await signStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: second.workspaceVersion,
      idempotencyKey: `integrity-tags-sign-${suffix}`,
    });
    process.env.AUTOPILOT_TEST_NOTICE_PERSIST_CRASH = "true";
    await assert.rejects(
      queueDueNotices(new Date("2026-08-24T00:00:00.000Z")),
      /notice-persist-crash/,
    );
    drainAutopilotTestNoticeSends();
    delete process.env.AUTOPILOT_TEST_NOTICE_PERSIST_CRASH;
    const frozen = await pool.query<{
      notice_from_email: string;
      notice_to_email: string;
      notice_subject: string;
      notice_text: string;
      notice_payload_version: number;
      notice_tags: unknown;
    }>(
      `select notice_from_email, notice_to_email, notice_subject, notice_text, notice_payload_version, notice_tags
       from recovery_veto_notices where workspace_id = $1`,
      [workspaceId],
    );
    const row = frozen.rows[0];
    assert.ok(row);
    const frozenTags = row.notice_tags;
    await assert.rejects(
      pool.query(
        `update recovery_veto_notices
         set notice_tags = $2::jsonb
         where workspace_id = $1`,
        [workspaceId, JSON.stringify([{ name: "vognary", value: "autopilot-notice-v2" }])],
      ),
      /frozen notice payload cannot be mutated/i,
    );
    const accepted = await sendQueuedAutopilotNotices(new Date("2026-08-24T00:00:00.000Z"), { workspaceId });
    assert.equal(accepted, 1);
    const sent = drainAutopilotTestNoticeSends();
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0]?.tags, frozenTags);
  } finally {
    delete process.env.AUTOPILOT_TEST_NOTICE_PERSIST_CRASH;
    if (previous.notice === undefined) delete process.env.AUTOPILOT_NOTICE_ENABLED;
    else process.env.AUTOPILOT_NOTICE_ENABLED = previous.notice;
    if (previous.channel === undefined) delete process.env.AUTOPILOT_NOTICE_CHANNEL_READY;
    else process.env.AUTOPILOT_NOTICE_CHANNEL_READY = previous.channel;
    if (previous.adapter === undefined) delete process.env.AUTOPILOT_TEST_ADAPTER;
    else process.env.AUTOPILOT_TEST_ADAPTER = previous.adapter;
    if (previous.secret === undefined) delete process.env.AUTOPILOT_VETO_TOKEN_SECRET;
    else process.env.AUTOPILOT_VETO_TOKEN_SECRET = previous.secret;
    if (previous.proven === undefined) delete process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS;
    else process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = previous.proven;
    if (previous.from === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = previous.from;
    drainAutopilotTestNoticeSends();
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});


test("a genuinely proven production route can raise currentlyEligibleAccounts while test flags cannot", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const previous = {
    notice: process.env.AUTOPILOT_NOTICE_ENABLED,
    channel: process.env.AUTOPILOT_NOTICE_CHANNEL_READY,
    proven: process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS,
    nodeEnv: process.env.NODE_ENV,
  };
  process.env.AUTOPILOT_NOTICE_ENABLED = "true";
  process.env.AUTOPILOT_NOTICE_CHANNEL_READY = "true";
  process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = "openai";
  const { pool, ownerUserId, workspaceId, suffix } = await seedWorkspace();
  try {
    const first = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `integrity-prod-funnel-1-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-july-prod-funnel",
          text: "OpenAI subscription charged INR 1,999 on 6 July 2026. Renews monthly on 6 September 2026.",
        }],
      },
      now: new Date("2026-08-09T10:00:00.000Z"),
    });
    const second = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: first.workspaceVersion,
      idempotencyKey: `integrity-prod-funnel-2-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-august-prod-funnel",
          text: "OpenAI subscription charged INR 1,999 on 6 August 2026. Renews monthly on 6 September 2026.",
        }],
      },
      now: new Date("2026-08-09T11:00:00.000Z"),
    });
    await pool.query(`update recovery_commitments set confidence_score = 90 where workspace_id = $1`, [workspaceId]);
    await signStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: second.workspaceVersion,
      idempotencyKey: `integrity-prod-funnel-sign-${suffix}`,
    });
    Reflect.set(process.env, "NODE_ENV", "production");
    process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = "openai";
    const production = await queryAutopilotFunnel(pool);
    assert.equal(production.currentlyEligibleAccounts, 0);
    const openai = lookupCatalogProviderById("openai");
    assert.ok(openai);
    const original = {
      routeProven: openai.routeProven,
      proofStatus: openai.proofStatus,
      requiresLogin: openai.requiresLogin,
      requiresOtp: openai.requiresOtp,
      requiresPhone: openai.requiresPhone,
      zeroCustomerWork: openai.zeroCustomerWork,
    };
    try {
      openai.routeProven = true;
      openai.proofStatus = "proven";
      openai.requiresLogin = false;
      openai.requiresOtp = false;
      openai.requiresPhone = false;
      openai.zeroCustomerWork = true;
      const withProvenRoute = await queryAutopilotFunnel(pool);
      assert.ok((withProvenRoute.currentlyEligibleAccounts ?? 0) >= 1);
    } finally {
      openai.routeProven = original.routeProven;
      openai.proofStatus = original.proofStatus;
      openai.requiresLogin = original.requiresLogin;
      openai.requiresOtp = original.requiresOtp;
      openai.requiresPhone = original.requiresPhone;
      openai.zeroCustomerWork = original.zeroCustomerWork;
    }
  } finally {
    if (previous.nodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Reflect.set(process.env, "NODE_ENV", previous.nodeEnv);
    if (previous.notice === undefined) delete process.env.AUTOPILOT_NOTICE_ENABLED;
    else process.env.AUTOPILOT_NOTICE_ENABLED = previous.notice;
    if (previous.channel === undefined) delete process.env.AUTOPILOT_NOTICE_CHANNEL_READY;
    else process.env.AUTOPILOT_NOTICE_CHANNEL_READY = previous.channel;
    if (previous.proven === undefined) delete process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS;
    else process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = previous.proven;
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("withdrawing standing-mandate consent revokes the mandate and cannot revoke a later signed mandate", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const { pool, ownerUserId, workspaceId, suffix } = await seedWorkspace();
  try {
    const version = await submitMerchantReceipts({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      suffix,
      merchant: "OpenAI",
      now: new Date("2026-08-09T10:00:00.000Z"),
    });
    const signed = await signStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: version,
      idempotencyKey: `consent-withdraw-sign-${suffix}`,
    });
    const grant = await pool.query<{ id: string; email: string }>(
      `select consent.id::text, owner.email
       from consent_grants consent
       join users owner on owner.id = consent.user_id
       where consent.workspace_id = $1 and consent.purpose = 'standing-mandate-autopilot' and consent.withdrawn_at is null
       limit 1`,
      [workspaceId],
    );
    assert.equal(await withdrawConsentGrant({
      id: grant.rows[0]!.id,
      userId: ownerUserId,
      email: grant.rows[0]!.email,
      workspaceId,
    }), true);
    const revoked = await pool.query<{ status: string }>(
      `select status from recovery_standing_mandates where workspace_id = $1 and id = $2`,
      [workspaceId, signed.mandate.id],
    );
    assert.equal(revoked.rows[0]?.status, "REVOKED");

    const resigned = await signStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: signed.workspaceVersion + 1,
      idempotencyKey: `consent-withdraw-resign-${suffix}`,
    });
    await pool.query(
      `update recovery_standing_mandates
       set status = 'REVOKED', revoked_at = now(), revoked_by_user_id = $3
       where workspace_id = $1 and id = $2`,
      [workspaceId, resigned.mandate.id, ownerUserId],
    );
    const third = await signStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: resigned.workspaceVersion,
      idempotencyKey: `consent-withdraw-third-${suffix}`,
    });
    const staleGrant = await pool.query<{ id: string }>(
      `select id::text from consent_grants
       where workspace_id = $1 and purpose = 'standing-mandate-autopilot' and resource_key = $2`,
      [workspaceId, resigned.mandate.id],
    );
    const owner = await pool.query<{ email: string }>(`select email from users where id = $1`, [ownerUserId]);
    assert.equal(await withdrawConsentGrant({
      id: staleGrant.rows[0]!.id,
      userId: ownerUserId,
      email: owner.rows[0]!.email,
      workspaceId,
    }), true);
    const later = await pool.query<{ status: string }>(
      `select status from recovery_standing_mandates where workspace_id = $1 and id = $2`,
      [workspaceId, third.mandate.id],
    );
    assert.equal(later.rows[0]?.status, "ACTIVE");
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("an active mandate with withdrawn standing-mandate consent cannot queue notices", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const previous = {
    notice: process.env.AUTOPILOT_NOTICE_ENABLED,
    channel: process.env.AUTOPILOT_NOTICE_CHANNEL_READY,
    adapter: process.env.AUTOPILOT_TEST_ADAPTER,
    secret: process.env.AUTOPILOT_VETO_TOKEN_SECRET,
    proven: process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS,
    from: process.env.RESEND_FROM_EMAIL,
  };
  process.env.AUTOPILOT_NOTICE_ENABLED = "true";
  process.env.AUTOPILOT_NOTICE_CHANNEL_READY = "true";
  process.env.AUTOPILOT_TEST_ADAPTER = "true";
  process.env.AUTOPILOT_VETO_TOKEN_SECRET = "veto-signing-secret-for-tests-32bytes!!";
  process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = "openai";
  process.env.RESEND_FROM_EMAIL = "notices@vognary.test";
  drainAutopilotTestNoticeSends();
  const { pool, ownerUserId, workspaceId, suffix } = await seedWorkspace();
  try {
    const first = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `consent-queue-1-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-july-consent-queue",
          text: "OpenAI subscription charged INR 1,999 on 6 July 2026. Renews monthly on 6 September 2026.",
        }],
      },
      now: new Date("2026-08-09T10:00:00.000Z"),
    });
    const second = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: first.workspaceVersion,
      idempotencyKey: `consent-queue-2-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-august-consent-queue",
          text: "OpenAI subscription charged INR 1,999 on 6 August 2026. Renews monthly on 6 September 2026.",
        }],
      },
      now: new Date("2026-08-09T11:00:00.000Z"),
    });
    await pool.query(`update recovery_commitments set confidence_score = 90 where workspace_id = $1`, [workspaceId]);
    await signStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: second.workspaceVersion,
      idempotencyKey: `consent-queue-sign-${suffix}`,
    });
    await pool.query(
      `update consent_grants
       set withdrawn_at = now()
       where workspace_id = $1 and purpose = 'standing-mandate-autopilot' and withdrawn_at is null`,
      [workspaceId],
    );
    const mandate = await pool.query<{ status: string }>(
      `select status from recovery_standing_mandates where workspace_id = $1`,
      [workspaceId],
    );
    assert.equal(mandate.rows[0]?.status, "ACTIVE");
    const queued = await queueDueNotices(new Date("2026-08-24T00:00:00.000Z"));
    assert.equal(queued.queued, 0);
    const authorized = await authorizeSilentCases(new Date("2026-08-26T12:00:00.000Z"));
    assert.equal(authorized.authorized, 0);
  } finally {
    if (previous.notice === undefined) delete process.env.AUTOPILOT_NOTICE_ENABLED;
    else process.env.AUTOPILOT_NOTICE_ENABLED = previous.notice;
    if (previous.channel === undefined) delete process.env.AUTOPILOT_NOTICE_CHANNEL_READY;
    else process.env.AUTOPILOT_NOTICE_CHANNEL_READY = previous.channel;
    if (previous.adapter === undefined) delete process.env.AUTOPILOT_TEST_ADAPTER;
    else process.env.AUTOPILOT_TEST_ADAPTER = previous.adapter;
    if (previous.secret === undefined) delete process.env.AUTOPILOT_VETO_TOKEN_SECRET;
    else process.env.AUTOPILOT_VETO_TOKEN_SECRET = previous.secret;
    if (previous.proven === undefined) delete process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS;
    else process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = previous.proven;
    if (previous.from === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = previous.from;
    drainAutopilotTestNoticeSends();
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("fee invoices require an explicit currency and finalized rows cannot be deleted while the workspace exists", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const { pool, ownerUserId, workspaceId } = await seedWorkspace();
  try {
    await assert.rejects(
      invoiceWorkspacePeriod({ workspaceId, periodStart: "2026-01-01", periodEnd: "2026-01-31" }),
      /explicit currency/i,
    );
    const first = await invoiceWorkspacePeriod({
      workspaceId,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      currency: "INR",
    });
    assert.equal(first.replayed, false);
    await assert.rejects(
      pool.query(`delete from recovery_fee_ledger where workspace_id = $1`, [workspaceId]),
      /cannot be deleted directly/i,
    );
    await assert.rejects(
      pool.query(`delete from recovery_billing_year_anchors where workspace_id = $1`, [workspaceId]),
      /cannot be deleted directly/i,
    );
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("a later delivered webhook cannot start the veto clock after bounce", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const previous = {
    execution: process.env.AUTOPILOT_EXECUTION_ENABLED,
    notice: process.env.AUTOPILOT_NOTICE_ENABLED,
    channel: process.env.AUTOPILOT_NOTICE_CHANNEL_READY,
    adapter: process.env.AUTOPILOT_TEST_ADAPTER,
    secret: process.env.AUTOPILOT_VETO_TOKEN_SECRET,
    proven: process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS,
    from: process.env.RESEND_FROM_EMAIL,
  };
  process.env.AUTOPILOT_EXECUTION_ENABLED = "true";
  process.env.AUTOPILOT_NOTICE_ENABLED = "true";
  process.env.AUTOPILOT_NOTICE_CHANNEL_READY = "true";
  process.env.AUTOPILOT_TEST_ADAPTER = "true";
  process.env.AUTOPILOT_VETO_TOKEN_SECRET = "veto-signing-secret-for-tests-32bytes!!";
  process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = "openai";
  process.env.RESEND_FROM_EMAIL = "notices@vognary.test";
  drainAutopilotTestNoticeSends();
  const { pool, ownerUserId, workspaceId, suffix } = await seedWorkspace();
  try {
    const first = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `bounce-clock-1-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-july-bounce",
          text: "OpenAI subscription charged INR 1,999 on 6 July 2026. Renews monthly on 6 September 2026.",
        }],
      },
      now: new Date("2026-08-09T10:00:00.000Z"),
    });
    const second = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: first.workspaceVersion,
      idempotencyKey: `bounce-clock-2-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-august-bounce",
          text: "OpenAI subscription charged INR 1,999 on 6 August 2026. Renews monthly on 6 September 2026.",
        }],
      },
      now: new Date("2026-08-09T11:00:00.000Z"),
    });
    await pool.query(`update recovery_commitments set confidence_score = 90 where workspace_id = $1`, [workspaceId]);
    await signStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: second.workspaceVersion,
      idempotencyKey: `bounce-clock-sign-${suffix}`,
    });
    await queueDueNotices(new Date("2026-08-24T00:00:00.000Z"));
    const notice = await pool.query<{ candidate_id: string; provider_message_id: string | null }>(
      `select candidate_id::text, provider_message_id from recovery_veto_notices where workspace_id = $1`,
      [workspaceId],
    );
    assert.ok(notice.rows[0]?.provider_message_id);
    const bounced = await applyAutopilotNoticeEvent({
      providerEventId: `svix-bounce-${suffix}`,
      type: "email.bounced",
      providerMessageId: notice.rows[0]!.provider_message_id!,
      occurredAt: "2026-08-24T00:05:00.000Z",
      payloadHash: createHash("sha256").update(`bounce-${suffix}`).digest("hex"),
      tagged: true,
    });
    assert.equal(bounced.status, "applied");
    const delivered = await applyAutopilotNoticeEvent({
      providerEventId: `svix-bounce-delivered-${suffix}`,
      type: "email.delivered",
      providerMessageId: notice.rows[0]!.provider_message_id!,
      occurredAt: "2026-08-24T00:10:00.000Z",
      payloadHash: createHash("sha256").update(`bounce-delivered-${suffix}`).digest("hex"),
      tagged: true,
    });
    assert.equal(delivered.status, "applied");
    const clock = await pool.query<{
      delivery_status: string;
      delivered_at: Date | null;
      veto_deadline_at: Date | null;
    }>(
      `select notice.delivery_status, candidate.notice_delivered_at as delivered_at, candidate.veto_deadline_at
       from recovery_veto_notices notice
       join recovery_action_candidates candidate
         on candidate.workspace_id = notice.workspace_id and candidate.id = notice.candidate_id
       where notice.workspace_id = $1`,
      [workspaceId],
    );
    assert.equal(clock.rows[0]?.delivery_status, "BOUNCED");
    assert.equal(clock.rows[0]?.delivered_at, null);
    assert.equal(clock.rows[0]?.veto_deadline_at, null);
    const authorized = await authorizeSilentCases(new Date("2026-08-26T12:00:00.000Z"));
    assert.equal(authorized.authorized, 0);
  } finally {
    if (previous.execution === undefined) delete process.env.AUTOPILOT_EXECUTION_ENABLED;
    else process.env.AUTOPILOT_EXECUTION_ENABLED = previous.execution;
    if (previous.notice === undefined) delete process.env.AUTOPILOT_NOTICE_ENABLED;
    else process.env.AUTOPILOT_NOTICE_ENABLED = previous.notice;
    if (previous.channel === undefined) delete process.env.AUTOPILOT_NOTICE_CHANNEL_READY;
    else process.env.AUTOPILOT_NOTICE_CHANNEL_READY = previous.channel;
    if (previous.adapter === undefined) delete process.env.AUTOPILOT_TEST_ADAPTER;
    else process.env.AUTOPILOT_TEST_ADAPTER = previous.adapter;
    if (previous.secret === undefined) delete process.env.AUTOPILOT_VETO_TOKEN_SECRET;
    else process.env.AUTOPILOT_VETO_TOKEN_SECRET = previous.secret;
    if (previous.proven === undefined) delete process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS;
    else process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = previous.proven;
    if (previous.from === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = previous.from;
    drainAutopilotTestNoticeSends();
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

async function withAutopilotNoticeEnv(run: () => Promise<void>) {
  const previous = {
    execution: process.env.AUTOPILOT_EXECUTION_ENABLED,
    notice: process.env.AUTOPILOT_NOTICE_ENABLED,
    channel: process.env.AUTOPILOT_NOTICE_CHANNEL_READY,
    adapter: process.env.AUTOPILOT_TEST_ADAPTER,
    secret: process.env.AUTOPILOT_VETO_TOKEN_SECRET,
    proven: process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS,
    from: process.env.RESEND_FROM_EMAIL,
  };
  process.env.AUTOPILOT_EXECUTION_ENABLED = "true";
  process.env.AUTOPILOT_NOTICE_ENABLED = "true";
  process.env.AUTOPILOT_NOTICE_CHANNEL_READY = "true";
  process.env.AUTOPILOT_TEST_ADAPTER = "true";
  process.env.AUTOPILOT_VETO_TOKEN_SECRET = "veto-signing-secret-for-tests-32bytes!!";
  process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = "openai";
  process.env.RESEND_FROM_EMAIL = "notices@vognary.test";
  drainAutopilotTestNoticeSends();
  try {
    await run();
  } finally {
    setAutopilotNoticeSendInterleaveForTests(null);
    drainAutopilotTestNoticeSends();
    if (previous.execution === undefined) delete process.env.AUTOPILOT_EXECUTION_ENABLED;
    else process.env.AUTOPILOT_EXECUTION_ENABLED = previous.execution;
    if (previous.notice === undefined) delete process.env.AUTOPILOT_NOTICE_ENABLED;
    else process.env.AUTOPILOT_NOTICE_ENABLED = previous.notice;
    if (previous.channel === undefined) delete process.env.AUTOPILOT_NOTICE_CHANNEL_READY;
    else process.env.AUTOPILOT_NOTICE_CHANNEL_READY = previous.channel;
    if (previous.adapter === undefined) delete process.env.AUTOPILOT_TEST_ADAPTER;
    else process.env.AUTOPILOT_TEST_ADAPTER = previous.adapter;
    if (previous.secret === undefined) delete process.env.AUTOPILOT_VETO_TOKEN_SECRET;
    else process.env.AUTOPILOT_VETO_TOKEN_SECRET = previous.secret;
    if (previous.proven === undefined) delete process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS;
    else process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = previous.proven;
    if (previous.from === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = previous.from;
  }
}

test("a same-timestamp complaint, bounce, or failure takes precedence over an earlier delivered event", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  await withAutopilotNoticeEnv(async () => {
    for (const type of ["email.complained", "email.bounced", "email.failed"] as const) {
      const { pool, ownerUserId, workspaceId, suffix } = await seedWorkspace();
      try {
        const version = await submitMerchantReceipts({
          workspaceId,
          actorUserId: ownerUserId,
          expectedVersion: 0,
          suffix: `${suffix}-${type}`,
          merchant: "OpenAI",
          now: new Date("2026-08-09T10:00:00.000Z"),
        });
        await pool.query(`update recovery_commitments set confidence_score = 90 where workspace_id = $1`, [workspaceId]);
        await signStandingMandate({
          workspaceId,
          actorUserId: ownerUserId,
          expectedVersion: version,
          idempotencyKey: `same-t-sign-${suffix}-${type}`,
        });
        await queueDueNotices(new Date("2026-08-24T00:00:00.000Z"));
        const notice = await pool.query<{ candidate_id: string; provider_message_id: string | null }>(
          `select candidate_id::text, provider_message_id from recovery_veto_notices where workspace_id = $1`,
          [workspaceId],
        );
        assert.ok(notice.rows[0]?.provider_message_id);
        const occurredAt = "2026-08-24T00:05:00.000Z";
        const delivered = await applyAutopilotNoticeEvent({
          providerEventId: `svix-same-t-delivered-${suffix}-${type}`,
          type: "email.delivered",
          providerMessageId: notice.rows[0]!.provider_message_id!,
          occurredAt,
          payloadHash: createHash("sha256").update(`same-t-delivered-${suffix}-${type}`).digest("hex"),
          tagged: true,
        });
        assert.equal(delivered.status, "applied");
        const terminal = await applyAutopilotNoticeEvent({
          providerEventId: `svix-same-t-terminal-${suffix}-${type}`,
          type,
          providerMessageId: notice.rows[0]!.provider_message_id!,
          occurredAt,
          payloadHash: createHash("sha256").update(`same-t-terminal-${suffix}-${type}`).digest("hex"),
          tagged: true,
        });
        assert.equal(terminal.status, "applied");
        const clock = await pool.query<{
          delivery_status: string;
          delivered_at: Date | null;
          veto_deadline_at: Date | null;
        }>(
          `select notice.delivery_status, candidate.notice_delivered_at as delivered_at, candidate.veto_deadline_at
           from recovery_veto_notices notice
           join recovery_action_candidates candidate
             on candidate.workspace_id = notice.workspace_id and candidate.id = notice.candidate_id
           where notice.workspace_id = $1`,
          [workspaceId],
        );
        const expectedStatus = type === "email.complained" ? "COMPLAINED" : type === "email.bounced" ? "BOUNCED" : "FAILED";
        assert.equal(clock.rows[0]?.delivery_status, expectedStatus);
        assert.equal(clock.rows[0]?.delivered_at, null);
        assert.equal(clock.rows[0]?.veto_deadline_at, null);
        const authorized = await authorizeSilentCases(new Date("2026-08-26T12:00:00.000Z"));
        assert.equal(authorized.authorized, 0);
      } finally {
        await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
        await pool.query(`delete from users where id = $1`, [ownerUserId]);
      }
    }
  });
});

test("signed mandates and Autopilot audit facts reject illegal mutation while the workspace exists", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const { pool, ownerUserId, workspaceId, suffix } = await seedWorkspace();
  try {
    const version = await submitMerchantReceipts({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      suffix,
      merchant: "OpenAI",
      now: new Date("2026-08-09T10:00:00.000Z"),
    });
    await pool.query(`update recovery_commitments set confidence_score = 90 where workspace_id = $1`, [workspaceId]);
    const signed = await signStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: version,
      idempotencyKey: `mandate-immut-${suffix}`,
    });
    await assert.rejects(
      pool.query(
        `update recovery_standing_mandates
         set signed_text = 'Tampered standing-mandate terms that still satisfy the length check.'
         where workspace_id = $1`,
        [workspaceId],
      ),
      /Standing mandate terms cannot be mutated/i,
    );
    await assert.rejects(
      pool.query(`update recovery_standing_mandates set per_action_ceiling_minor = 1 where workspace_id = $1`, [workspaceId]),
      /Standing mandate terms cannot be mutated/i,
    );
    await assert.rejects(
      pool.query(`delete from recovery_standing_mandates where workspace_id = $1`, [workspaceId]),
      /cannot be deleted while the workspace exists/i,
    );
    await revokeStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: signed.workspaceVersion,
      idempotencyKey: `mandate-immut-revoke-${suffix}`,
    });
    const revoked = await pool.query<{ status: string }>(
      `select status from recovery_standing_mandates where workspace_id = $1`,
      [workspaceId],
    );
    assert.equal(revoked.rows[0]?.status, "REVOKED");
    await assert.rejects(
      pool.query(`update recovery_standing_mandates set status = 'ACTIVE' where workspace_id = $1`, [workspaceId]),
      /Revoked standing mandates cannot be mutated/i,
    );

    await assert.rejects(
      pool.query(`update recovery_classification_snapshots set cited_category = 'Insurance' where workspace_id = $1`, [workspaceId]),
      /cannot be updated/i,
    );
    await assert.rejects(
      pool.query(`delete from recovery_classification_snapshots where workspace_id = $1`, [workspaceId]),
      /cannot be deleted while the workspace exists/i,
    );
    await assert.rejects(
      pool.query(`update recovery_standing_mandate_events set kind = 'REVOKED' where workspace_id = $1`, [workspaceId]),
      /cannot be updated/i,
    );
    const candidate = await pool.query<{ id: string }>(
      `select id::text from recovery_action_candidates where workspace_id = $1 limit 1`,
      [workspaceId],
    );
    assert.ok(candidate.rows[0]);
    await pool.query(
      `insert into recovery_candidate_events (workspace_id, candidate_id, previous_status, status, actor_kind, reason_code)
       values ($1, $2, null, 'SHADOW', 'SYSTEM', 'immutability-fixture')`,
      [workspaceId, candidate.rows[0]!.id],
    );
    await assert.rejects(
      pool.query(`update recovery_candidate_events set reason_code = 'tampered' where workspace_id = $1`, [workspaceId]),
      /cannot be updated/i,
    );
    await assert.rejects(
      pool.query(`delete from recovery_candidate_events where workspace_id = $1`, [workspaceId]),
      /cannot be deleted while the workspace exists/i,
    );

    await pool.query(
      `insert into recovery_fee_ledger (
         workspace_id, period_start, period_end, currency, monitoring_minor, verified_saving_minor,
         outcome_fee_minor, retained_minor, refund_credit_minor, additional_charge_minor,
         razorpay_charge_status, inputs_hash, year_start
       ) values ($1, '2026-08-01', '2026-08-31', 'INR', 0, 0, 0, 0, 0, 0, 'FAIL_CLOSED', $2, '2026-08-01')`,
      [workspaceId, "d".repeat(64)],
    );
    await assert.rejects(
      pool.query(`update recovery_fee_ledger set razorpay_charge_status = 'CHARGED' where workspace_id = $1`, [workspaceId]),
      /cannot be mutated/i,
    );
    const attempt = await pool.query<{ id: string }>(
      `insert into recovery_execution_attempts (
         workspace_id, candidate_id, attempt_no, operation_key, request_hash, provider_id, status
       ) values ($1, $2, 1, $3, $4, 'openai', 'PENDING')
       returning id::text`,
      [workspaceId, candidate.rows[0]!.id, `op-immut-${suffix}-xxxxxxxx`, "e".repeat(64)],
    );
    await pool.query(
      `update recovery_execution_attempts set status = 'AUTHORIZED' where id = $1`,
      [attempt.rows[0]!.id],
    );
    await pool.query(
      `update recovery_execution_attempts set status = 'FAILED', failure_reason = 'provider-timeout' where id = $1`,
      [attempt.rows[0]!.id],
    );
    await assert.rejects(
      pool.query(`update recovery_execution_attempts set status = 'AUTHORIZED' where id = $1`, [attempt.rows[0]!.id]),
      /Terminal execution attempts cannot be mutated/i,
    );
    await assert.rejects(
      pool.query(`delete from recovery_execution_attempts where workspace_id = $1`, [workspaceId]),
      /cannot be deleted while the workspace exists/i,
    );
    await pool.query(
      `insert into recovery_operator_actions (workspace_id, candidate_id, actor_user_id, minutes, outcome)
       values ($1, $2, $3, 1, 'EXCEPTION')`,
      [workspaceId, candidate.rows[0]!.id, ownerUserId],
    );
    await assert.rejects(
      pool.query(`update recovery_operator_actions set minutes = 9 where workspace_id = $1`, [workspaceId]),
      /cannot be updated/i,
    );
    await pool.query(
      `insert into recovery_executions (
         workspace_id, candidate_id, provider_id, route, actor_kind, outcome, attempt_no
       ) values ($1, $2, 'openai', 'unsupported', 'OPERATOR', 'EXCEPTION', 1)`,
      [workspaceId, candidate.rows[0]!.id],
    );
    await assert.rejects(
      pool.query(`update recovery_executions set outcome = 'FAILED' where workspace_id = $1`, [workspaceId]),
      /cannot be updated/i,
    );

    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    const leftover = await pool.query<{ mandates: string; snapshots: string; attempts: string }>(
      `select
         (select count(*)::text from recovery_standing_mandates where workspace_id = $1) as mandates,
         (select count(*)::text from recovery_classification_snapshots where workspace_id = $1) as snapshots,
         (select count(*)::text from recovery_execution_attempts where workspace_id = $1) as attempts`,
      [workspaceId],
    );
    assert.deepEqual(leftover.rows[0], { mandates: "0", snapshots: "0", attempts: "0" });
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]).catch(() => undefined);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("a newly signed mandate keeps historical mandate terms on the prior version", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const { pool, ownerUserId, workspaceId, suffix } = await seedWorkspace();
  try {
    const historicalText = "Historical standing-mandate terms without published monetary ceilings.";
    await pool.query(
      `insert into recovery_standing_mandates (
         workspace_id, version, status, terms_version, signed_text, signed_text_hash,
         currency, per_action_ceiling_minor, rolling_30d_ceiling_minor, veto_window_hours,
         signed_by_user_id, signed_at, revoked_at, revoked_by_user_id
       ) values ($1, 1, 'REVOKED', 'standing-mandate-v1', $2, $3, 'INR', 500000, 2000000, 48, $4, now() - interval '30 days', now() - interval '10 days', $4)`,
      [workspaceId, historicalText, "a".repeat(64), ownerUserId],
    );
    const version = await submitMerchantReceipts({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      suffix,
      merchant: "OpenAI",
      now: new Date("2026-08-09T10:00:00.000Z"),
    });
    await pool.query(`update recovery_commitments set confidence_score = 90 where workspace_id = $1`, [workspaceId]);
    const signed = await signStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: version,
      idempotencyKey: `historical-terms-${suffix}`,
    });
    assert.equal(signed.mandate.termsVersion, "standing-mandate-2026-08-16");
    assert.match(signed.mandate.signedText, /INR ₹50,000 per action/);
    assert.match(signed.mandate.signedText, /INR ₹2,00,000 rolling 30-day ceiling/);
    const historical = await pool.query<{ terms_version: string; signed_text: string; signed_text_hash: string }>(
      `select terms_version, signed_text, signed_text_hash from recovery_standing_mandates where workspace_id = $1 and version = 1`,
      [workspaceId],
    );
    assert.equal(historical.rows[0]?.terms_version, "standing-mandate-v1");
    assert.equal(historical.rows[0]?.signed_text, historicalText);
    assert.equal(historical.rows[0]?.signed_text_hash, "a".repeat(64));
    assert.notEqual(signed.mandate.signedTextHash, historical.rows[0]?.signed_text_hash);
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("obsolete queued notices are not sent after mandate revoke, source disconnect, or newer classification", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  await withAutopilotNoticeEnv(async () => {
    const cases = [
      { phase: "after-select" as const, kind: "revoke" as const },
      { phase: "after-freeze" as const, kind: "disconnect" as const },
      { phase: "after-select" as const, kind: "classification" as const },
      { phase: "after-freeze" as const, kind: "provider" as const },
      { phase: "after-freeze" as const, kind: "currency" as const },
      { phase: "after-freeze" as const, kind: "provider-proof" as const },
    ];
    for (const { phase, kind } of cases) {
      const { pool, ownerUserId, workspaceId, suffix } = await seedWorkspace();
      try {
        const version = await submitMerchantReceipts({
          workspaceId,
          actorUserId: ownerUserId,
          expectedVersion: 0,
          suffix: `${suffix}-${phase}-${kind}`,
          merchant: "OpenAI",
          now: new Date("2026-08-09T10:00:00.000Z"),
        });
        await pool.query(`update recovery_commitments set confidence_score = 90 where workspace_id = $1`, [workspaceId]);
        const signed = await signStandingMandate({
          workspaceId,
          actorUserId: ownerUserId,
          expectedVersion: version,
          idempotencyKey: `obsolete-sign-${suffix}-${phase}-${kind}`,
        });
        process.env.AUTOPILOT_NOTICE_CHANNEL_READY = "false";
        await queueDueNotices(new Date("2026-08-24T00:00:00.000Z"));
        process.env.AUTOPILOT_NOTICE_CHANNEL_READY = "true";
        drainAutopilotTestNoticeSends();
        setAutopilotNoticeSendInterleaveForTests(async (hookPhase, input) => {
          if (hookPhase !== phase) return;
          if (kind === "revoke") {
            await revokeStandingMandate({
              workspaceId: input.workspaceId,
              actorUserId: ownerUserId,
              expectedVersion: signed.workspaceVersion,
              idempotencyKey: `obsolete-revoke-${suffix}-${phase}`,
            });
            return;
          }
          if (kind === "disconnect") {
            const source = await pool.query<{ id: string }>(
              `select id::text from recovery_sources where workspace_id = $1 limit 1`,
              [workspaceId],
            );
            await disconnectRecoverySource({
              workspaceId,
              actorUserId: ownerUserId,
              sourceId: source.rows[0]!.id,
              expectedVersion: signed.workspaceVersion,
              idempotencyKey: `obsolete-disconnect-${suffix}-${phase}`,
            });
            return;
          }
          if (kind === "classification") {
            const insurance = await pool.query<{ id: string; commitment_id: string }>(
              `insert into recovery_classification_snapshots (
                 workspace_id, commitment_id, commitment_class, protected_override, cited_category,
                 cited_merchant, confidence_score, evidence_ids
               )
               select workspace_id, commitment_id, 'insurance', true, 'Insurance', 'LIC', confidence_score, evidence_ids
               from recovery_classification_snapshots
               where workspace_id = $1
               order by created_at desc, id desc
               limit 1
               returning id, commitment_id`,
              [workspaceId],
            );
            await pool.query(
              `update recovery_action_candidates
               set classification_snapshot_id = $2
               where workspace_id = $1 and commitment_id = $3`,
              [workspaceId, insurance.rows[0]!.id, insurance.rows[0]!.commitment_id],
            );
            return;
          }
          if (kind === "currency") {
            await pool.query(
              `update recovery_action_candidates set currency = 'USD' where workspace_id = $1`,
              [workspaceId],
            );
            return;
          }
          if (kind === "provider-proof") {
            process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = "";
            return;
          }
          await pool.query(
            `insert into recovery_provider_disables (provider_id, disabled, reason)
             values ('openai', true, 'obsolete-notice-test')
             on conflict (provider_id) do update set disabled = true, reason = excluded.reason`,
          );
        });
        const accepted = await sendQueuedAutopilotNotices(new Date("2026-08-24T00:01:00.000Z"), { workspaceId });
        assert.equal(accepted, 0);
        const sent = drainAutopilotTestNoticeSends();
        assert.equal(sent.length, 0);
        const clock = await pool.query<{ notice_delivered_at: Date | null; veto_deadline_at: Date | null }>(
          `select notice_delivered_at, veto_deadline_at from recovery_action_candidates where workspace_id = $1`,
          [workspaceId],
        );
        assert.equal(clock.rows[0]?.notice_delivered_at, null);
        assert.equal(clock.rows[0]?.veto_deadline_at, null);
      } finally {
        setAutopilotNoticeSendInterleaveForTests(null);
        await pool.query(`delete from recovery_provider_disables where provider_id = 'openai' and reason = 'obsolete-notice-test'`).catch(() => undefined);
        await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
        await pool.query(`delete from users where id = $1`, [ownerUserId]);
      }
    }
  });
});

test("concurrent notice workers call the provider once", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  await withAutopilotNoticeEnv(async () => {
    const { pool, ownerUserId, workspaceId, suffix } = await seedWorkspace();
    try {
      const version = await submitMerchantReceipts({
        workspaceId,
        actorUserId: ownerUserId,
        expectedVersion: 0,
        suffix: `${suffix}-duplicate-worker`,
        merchant: "OpenAI",
        now: new Date("2026-08-09T10:00:00.000Z"),
      });
      await pool.query(`update recovery_commitments set confidence_score = 90 where workspace_id = $1`, [workspaceId]);
      await signStandingMandate({
        workspaceId,
        actorUserId: ownerUserId,
        expectedVersion: version,
        idempotencyKey: `duplicate-worker-sign-${suffix}`,
      });
      process.env.AUTOPILOT_NOTICE_CHANNEL_READY = "false";
      await queueDueNotices(new Date("2026-08-24T00:00:00.000Z"));
      process.env.AUTOPILOT_NOTICE_CHANNEL_READY = "true";
      drainAutopilotTestNoticeSends();

      const accepted = await Promise.all([
        sendQueuedAutopilotNotices(new Date("2026-08-24T00:01:00.000Z"), { workspaceId }),
        sendQueuedAutopilotNotices(new Date("2026-08-24T00:01:00.000Z"), { workspaceId }),
      ]);
      assert.equal(accepted.reduce((total, count) => total + count, 0), 1);
      assert.equal(drainAutopilotTestNoticeSends().length, 1);
      const notice = await pool.query<{ delivery_status: string; provider_message_id: string | null }>(
        `select delivery_status, provider_message_id from recovery_veto_notices where workspace_id = $1`,
        [workspaceId],
      );
      assert.equal(notice.rows[0]?.delivery_status, "ACCEPTED");
      assert.ok(notice.rows[0]?.provider_message_id);
    } finally {
      await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
      await pool.query(`delete from users where id = $1`, [ownerUserId]);
    }
  });
});

test("notice send serializes with concurrent mandate revocation", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  await withAutopilotNoticeEnv(async () => {
    const { pool, ownerUserId, workspaceId, suffix } = await seedWorkspace();
    try {
      const version = await submitMerchantReceipts({
        workspaceId,
        actorUserId: ownerUserId,
        expectedVersion: 0,
        suffix: `${suffix}-send-revoke-race`,
        merchant: "OpenAI",
        now: new Date("2026-08-09T10:00:00.000Z"),
      });
      await pool.query(`update recovery_commitments set confidence_score = 90 where workspace_id = $1`, [workspaceId]);
      const signed = await signStandingMandate({
        workspaceId,
        actorUserId: ownerUserId,
        expectedVersion: version,
        idempotencyKey: `send-revoke-sign-${suffix}`,
      });
      process.env.AUTOPILOT_NOTICE_CHANNEL_READY = "false";
      await queueDueNotices(new Date("2026-08-24T00:00:00.000Z"));
      process.env.AUTOPILOT_NOTICE_CHANNEL_READY = "true";
      drainAutopilotTestNoticeSends();

      let revokeFinished = false;
      let revokePromise: ReturnType<typeof revokeStandingMandate> | null = null;
      setAutopilotNoticeSendInterleaveForTests(async (phase) => {
        if (phase !== "after-authority") return;
        revokePromise = revokeStandingMandate({
          workspaceId,
          actorUserId: ownerUserId,
          expectedVersion: signed.workspaceVersion,
          idempotencyKey: `send-revoke-race-${suffix}`,
        });
        void revokePromise.then(() => { revokeFinished = true; });
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(revokeFinished, false, "revocation must wait while the provider-send authority gate is held");
      });

      const accepted = await sendQueuedAutopilotNotices(new Date("2026-08-24T00:01:00.000Z"), { workspaceId });
      assert.equal(accepted, 1);
      assert.equal(drainAutopilotTestNoticeSends().length, 1);
      assert.ok(revokePromise);
      await revokePromise;
      assert.equal(revokeFinished, true);
      const candidate = await pool.query<{ status: string }>(
        `select status from recovery_action_candidates where workspace_id = $1`,
        [workspaceId],
      );
      assert.equal(candidate.rows[0]?.status, "REVOKED");
    } finally {
      setAutopilotNoticeSendInterleaveForTests(null);
      await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
      await pool.query(`delete from users where id = $1`, [ownerUserId]);
    }
  });
});

test("notice send serializes with concurrent account deletion", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  await withAutopilotNoticeEnv(async () => {
    const previous = {
      sessionSecret: process.env.SESSION_SECRET,
      inMemoryRateLimits: process.env.ALLOW_IN_MEMORY_RATE_LIMITS,
    };
    process.env.SESSION_SECRET = "profile-delete-race-session-secret-at-least-32-bytes";
    process.env.ALLOW_IN_MEMORY_RATE_LIMITS = "true";
    const { pool, ownerUserId, workspaceId, suffix } = await seedWorkspace();
    try {
      const version = await submitMerchantReceipts({
        workspaceId,
        actorUserId: ownerUserId,
        expectedVersion: 0,
        suffix: `${suffix}-send-delete-race`,
        merchant: "OpenAI",
        now: new Date("2026-08-09T10:00:00.000Z"),
      });
      await pool.query(`update recovery_commitments set confidence_score = 90 where workspace_id = $1`, [workspaceId]);
      await signStandingMandate({
        workspaceId,
        actorUserId: ownerUserId,
        expectedVersion: version,
        idempotencyKey: `send-delete-sign-${suffix}`,
      });
      process.env.AUTOPILOT_NOTICE_CHANNEL_READY = "false";
      await queueDueNotices(new Date("2026-08-24T00:00:00.000Z"));
      process.env.AUTOPILOT_NOTICE_CHANNEL_READY = "true";
      drainAutopilotTestNoticeSends();

      const { NextRequest } = await import("next/server");
      const { DELETE: deleteProfile } = await import("../../src/app/api/profile/route");
      const { createSessionCookie } = await import("../../src/lib/server/session");
      const cookie = await createSessionCookie({ userId: ownerUserId, workspaceId });
      const deletion = { promise: null as Promise<Response> | null, finished: false };
      setAutopilotNoticeSendInterleaveForTests(async (phase) => {
        if (phase !== "after-authority") return;
        deletion.promise = deleteProfile(new NextRequest("https://vognary.test/api/profile", {
          method: "DELETE",
          headers: {
            cookie: `${cookie.name}=${encodeURIComponent(cookie.value)}`,
            origin: "https://vognary.test",
            "content-type": "application/json",
          },
          body: JSON.stringify({ confirm: "DELETE MY VOGNARY DATA" }),
        }));
        void deletion.promise.then(() => { deletion.finished = true; });
        let waiting = false;
        for (let attempt = 0; attempt < 100 && !waiting; attempt += 1) {
          const locks = await pool.query<{ waiting: number }>(
            `select count(*)::int as waiting from pg_locks where locktype = 'advisory' and not granted`,
          );
          waiting = (locks.rows[0]?.waiting ?? 0) > 0;
          if (!waiting) await new Promise<void>((resolve) => setImmediate(resolve));
        }
        assert.equal(waiting, true, "account deletion must wait on the notice-send authority gate");
        assert.equal(deletion.finished, false);
      });

      const accepted = await sendQueuedAutopilotNotices(new Date("2026-08-24T00:01:00.000Z"), { workspaceId });
      assert.equal(accepted, 1);
      assert.equal(drainAutopilotTestNoticeSends().length, 1);
      assert.ok(deletion.promise);
      const response = await deletion.promise;
      assert.equal(response.status, 200, await response.text());
      assert.equal(deletion.finished, true);
      assert.equal(Number((await pool.query<{ total: number }>(
        `select count(*)::int as total from workspaces where id = $1`,
        [workspaceId],
      )).rows[0]?.total ?? -1), 0);
    } finally {
      setAutopilotNoticeSendInterleaveForTests(null);
      await pool.query(`delete from workspaces where id = $1`, [workspaceId]).catch(() => undefined);
      await pool.query(`delete from users where id = $1`, [ownerUserId]).catch(() => undefined);
      if (previous.sessionSecret === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = previous.sessionSecret;
      if (previous.inMemoryRateLimits === undefined) delete process.env.ALLOW_IN_MEMORY_RATE_LIMITS;
      else process.env.ALLOW_IN_MEMORY_RATE_LIMITS = previous.inMemoryRateLimits;
    }
  });
});

function isImmutableEvidenceError(error: unknown) {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "55000"
    && "message" in error
    && typeof error.message === "string"
    && /Recovery evidence is immutable/i.test(error.message),
  );
}

function isImmutableCohortError(error: unknown) {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "55000"
    && "message" in error
    && typeof error.message === "string"
    && /Connected-mandate cohort is immutable/i.test(error.message),
  );
}
