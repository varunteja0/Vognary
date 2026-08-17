import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { getDatabasePool } from "../../src/lib/server/database";
import { RecoveryServiceError } from "../../src/lib/server/recovery-api";
import {
  createRecoveryCorrection,
  getRecoveryCommitment,
  getRecoveryHome,
  getRecoveryCutoverStatus,
  listRecoveryCommitments,
  putRecoveryDecision,
  reverseRecoveryCorrection,
  submitRecoveryEvidence,
} from "../../src/lib/server/recovery-store";

const databaseConfigured = Boolean(process.env.DATABASE_URL);

test("Recovery v1 persists the canonical Customer #0 lifecycle with isolation and replay", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const ownerUserId = randomUUID();
  const outsiderUserId = randomUUID();
  const viewerUserId = randomUUID();
  const workspaceId = randomUUID();
  const outsiderWorkspaceId = randomUUID();
  const suffix = randomUUID().slice(0, 8);

  await pool.query(
    `insert into users (id, email, display_name) values
       ($1, $2, 'Recovery owner'),
       ($3, $4, 'Recovery outsider'),
       ($5, $6, 'Recovery viewer')`,
    [
      ownerUserId,
      `recovery-owner-${suffix}@example.test`,
      outsiderUserId,
      `recovery-outsider-${suffix}@example.test`,
      viewerUserId,
      `recovery-viewer-${suffix}@example.test`,
    ],
  );
  await pool.query(
    `insert into workspaces (id, owner_user_id, name) values
       ($1, $2, 'Recovery Customer Zero'),
       ($3, $4, 'Other workspace')`,
    [workspaceId, ownerUserId, outsiderWorkspaceId, outsiderUserId],
  );
  await pool.query(
    `insert into workspace_members (workspace_id, user_id, role) values
       ($1, $2, 'owner'),
       ($3, $4, 'owner'),
       ($1, $5, 'viewer')`,
    [workspaceId, ownerUserId, outsiderWorkspaceId, outsiderUserId, viewerUserId],
  );

  try {
    const firstRequest = {
      kind: "RECEIPT_PASTE" as const,
      receipts: [{
        clientRef: "someone@okhdfcbank",
        text: "Customer: Alice Example. Billing address: 12 Lake Road Hyderabad 500001. Account 001234567890 phone 9876543210 UPI someone@okhdfcbank. OpenAI subscription charged INR 1,999 on 6 July 2026. Renews monthly on 6 August 2026.",
      }],
    };
    const first = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `recovery-first-${suffix}`,
      request: firstRequest,
      now: new Date("2026-08-09T10:00:00.000Z"),
    });
    assert.equal(first.workspaceVersion, 1);
    assert.equal(first.data.submission.acceptedEvidenceCount, 1);
    assert.equal(first.data.home.changed.state, "NO_PRIOR_BASELINE");
    assert.deepEqual(first.data.home.changed.items, []);
    assert.equal(first.data.commitments.length, 1);
    const redactedPlaintext = await pool.query<{ client_ref: string; label: string; excerpt: string; provenance_reference: string }>(
      `select source.client_ref, source.label, evidence.excerpt, evidence.provenance_reference
       from recovery_sources source
       join recovery_evidence evidence
         on evidence.workspace_id = source.workspace_id and evidence.source_id = source.id
       where source.workspace_id = $1
       order by evidence.created_at asc
       limit 1`,
      [workspaceId],
    );
    assert.doesNotMatch(JSON.stringify(redactedPlaintext.rows[0]), /001234567890|9876543210|someone@okhdfcbank|Alice Example|12 Lake Road|Hyderabad/i);
    assert.match(redactedPlaintext.rows[0].excerpt, /ACCT-XX7890|PHONE-REDACTED|HANDLE-REDACTED/);
    assert.match(redactedPlaintext.rows[0].client_ref, /^client-[a-f0-9]{16}$/);
    assert.doesNotMatch(redactedPlaintext.rows[0].provenance_reference, /someone|okhdfcbank/i);
    const redactedJson = await pool.query<{ results: string; replay: string }>(
      `select submission.results::text as results, idempotency.response_payload::text as replay
       from recovery_submissions submission
       join recovery_idempotency_keys idempotency
         on idempotency.workspace_id = submission.workspace_id
        and idempotency.operation = 'recovery.submit-evidence'
       where submission.workspace_id = $1
       order by submission.ingested_at asc
       limit 1`,
      [workspaceId],
    );
    assert.doesNotMatch(`${redactedJson.rows[0].results}${redactedJson.rows[0].replay}`, /someone@okhdfcbank|Alice Example|12 Lake Road|Hyderabad/i);

    const replay = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `recovery-first-${suffix}`,
      request: firstRequest,
      now: new Date("2026-08-09T10:01:00.000Z"),
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.workspaceVersion, 1);
    assert.equal(replay.data.submission.id, first.data.submission.id);

    const second = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 1,
      idempotencyKey: `recovery-second-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-august",
          text: "OpenAI invoice paid INR 2,099 on 6 August 2026. Subscription renews monthly on 6 September 2026.",
        }],
      },
      now: new Date("2026-08-10T10:00:00.000Z"),
    });
    assert.equal(second.workspaceVersion, 2);
    assert.equal(second.data.home.changed.state, "COMPARED");
    assert.ok(second.data.home.changed.items.length >= 1);
    assert.ok(second.data.home.changed.items.every((change) => (
      change.provenance.kind === "EVIDENCE"
      && change.provenance.submissionId === second.data.submission.id
      && change.provenance.evidenceIds.length > 0
    )));
    const evidenceChangeIds = second.data.home.changed.items.map((change) => change.id);

    const listed = await listRecoveryCommitments({ workspaceId, actorUserId: ownerUserId, limit: 1 });
    assert.equal(listed.items.length, 1);
    assert.equal(listed.total, 1);
    const commitmentId = listed.items[0].id;

    const corrected = await createRecoveryCorrection({
      workspaceId,
      actorUserId: ownerUserId,
      commitmentId,
      expectedVersion: 2,
      idempotencyKey: `recovery-correction-1-${suffix}`,
      request: { patch: { field: "AMOUNT", value: { amountMinor: "175000" } }, reason: "Confirmed from invoice." },
      now: new Date("2026-08-10T10:05:00.000Z"),
    });
    assert.equal(corrected.workspaceVersion, 3);
    assert.equal(corrected.data.commitment.amount.minor, "175000");
    assert.deepEqual(corrected.data.correction.authoritativeAmount, corrected.data.commitment.amount);
    assert.ok(corrected.data.home.changed.items.every((change) => (
      change.provenance.kind === "CORRECTION"
      && change.provenance.correctionId === corrected.data.correction.id
      && change.provenance.evidenceIds.length === 0
    )));

    const superseding = await createRecoveryCorrection({
      workspaceId,
      actorUserId: ownerUserId,
      commitmentId,
      expectedVersion: 3,
      idempotencyKey: `recovery-correction-2-${suffix}`,
      request: { patch: { field: "AMOUNT", value: { amountMinor: "180000" } } },
      now: new Date("2026-08-10T10:06:00.000Z"),
    });
    assert.equal(superseding.workspaceVersion, 4);
    assert.equal(superseding.data.commitment.corrections.some((correction) => correction.status === "SUPERSEDED"), true);

    const reversed = await reverseRecoveryCorrection({
      workspaceId,
      actorUserId: ownerUserId,
      commitmentId,
      correctionId: superseding.data.correction.id,
      expectedVersion: 4,
      idempotencyKey: `recovery-reverse-${suffix}`,
      now: new Date("2026-08-10T10:07:00.000Z"),
    });
    assert.equal(reversed.workspaceVersion, 5);
    assert.equal(reversed.data.correction.status, "REVERSED");
    assert.deepEqual(reversed.data.correction.authoritativeAmount, { currency: "INR", minor: "180000", exponent: 2, display: "₹1,800.00" });
    assert.notEqual(reversed.data.commitment.amount.minor, "180000");
    assert.ok(reversed.data.home.changed.items.every((change) => (
      change.provenance.kind === "CORRECTION_REVERSAL"
      && change.provenance.correctionId === superseding.data.correction.id
      && change.provenance.evidenceIds.length === 0
    )));

    const decision = await putRecoveryDecision({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 5,
      idempotencyKey: `recovery-decision-${suffix}`,
      request: { commitmentId, decision: "INVESTIGATE" },
      now: new Date("2026-08-10T10:08:00.000Z"),
    });
    assert.equal(decision.workspaceVersion, 6);
    assert.equal(decision.data.decision.value, "INVESTIGATE");
    assert.deepEqual(decision.data.home.changed, reversed.data.home.changed, "a decision must not hide the last meaningful Changed comparison");
    const evidenceHistory = await pool.query<{ id: string; provenance_kind: string; evidence_submission_id: string }>(
      `select id, provenance_kind, evidence_submission_id
       from recovery_changes
       where workspace_id = $1 and id = any($2::uuid[])
       order by id`,
      [workspaceId, evidenceChangeIds],
    );
    assert.deepEqual(evidenceHistory.rows.map((row) => row.id).sort(), [...evidenceChangeIds].sort());
    assert.ok(evidenceHistory.rows.every((row) => row.provenance_kind === "EVIDENCE" && row.evidence_submission_id === second.data.submission.id));

    const detail = await getRecoveryCommitment({
      workspaceId,
      actorUserId: ownerUserId,
      commitmentId,
      evidenceLimit: 1,
    });
    assert.equal(detail.commitment.evidence.items.length, 1);
    assert.equal(detail.commitment.evidence.total, 2);
    assert.ok(detail.commitment.evidence.nextCursor);
    assert.equal(detail.commitment.evidence.items[0].excerpt.length <= 500, true);
    assert.equal(detail.commitment.evidence.items[0].immutable, true);
    assert.equal(detail.commitment.evidence.items[0].observedAt, "2026-08-06T00:00:00.000Z", "observedAt must be the paid date, never the future renewal");
    assert.equal(detail.commitment.evidence.items[0].date, "2026-08-06");
    assert.equal((await getRecoveryCommitment({ workspaceId, actorUserId: viewerUserId, commitmentId })).commitment.id, commitmentId);
    await assert.rejects(
      putRecoveryDecision({
        workspaceId,
        actorUserId: viewerUserId,
        expectedVersion: 6,
        idempotencyKey: `recovery-viewer-write-${suffix}`,
        request: { commitmentId, decision: "KEEP" },
      }),
      (error: unknown) => error instanceof RecoveryServiceError && error.code === "FORBIDDEN",
    );

    const home = await getRecoveryHome({ workspaceId, actorUserId: ownerUserId, generatedAt: new Date("2026-08-10T10:09:00.000Z") });
    assert.equal(home.workspace.version, 6);

    const merchantCorrection = await createRecoveryCorrection({
      workspaceId,
      actorUserId: ownerUserId,
      commitmentId,
      expectedVersion: 6,
      idempotencyKey: `recovery-merchant-${suffix}`,
      request: { patch: { field: "MERCHANT", value: { merchant: "OpenAI India" } } },
    });
    assert.equal(merchantCorrection.workspaceVersion, 7);
    assert.equal(merchantCorrection.data.commitment.merchant, "OpenAI India");

    const dateCorrection = await createRecoveryCorrection({
      workspaceId,
      actorUserId: ownerUserId,
      commitmentId,
      expectedVersion: 7,
      idempotencyKey: `recovery-date-${suffix}`,
      request: { patch: { field: "NEXT_EXPECTED_DATE", value: { date: "2026-09-07" } } },
    });
    assert.equal(dateCorrection.workspaceVersion, 8);
    assert.equal(dateCorrection.data.commitment.nextExpectedDate, "2026-09-07");

    const cadenceCorrection = await createRecoveryCorrection({
      workspaceId,
      actorUserId: ownerUserId,
      commitmentId,
      expectedVersion: 8,
      idempotencyKey: `recovery-cadence-${suffix}`,
      request: { patch: { field: "CADENCE", value: { cadence: "YEARLY" } } },
    });
    assert.equal(cadenceCorrection.workspaceVersion, 9);
    assert.equal(cadenceCorrection.data.commitment.cadence, "YEARLY");

    const notRecurring = await createRecoveryCorrection({
      workspaceId,
      actorUserId: ownerUserId,
      commitmentId,
      expectedVersion: 9,
      idempotencyKey: `recovery-not-recurring-${suffix}`,
      request: { patch: { field: "IS_RECURRING", value: { isRecurring: false } } },
    });
    assert.equal(notRecurring.workspaceVersion, 10);
    assert.equal(notRecurring.data.commitment.status, "NOT_RECURRING");
    assert.equal(notRecurring.data.home.monthlyTotals.some((total) => total.commitmentIds.includes(commitmentId)), false);

    const recurringAgain = await createRecoveryCorrection({
      workspaceId,
      actorUserId: ownerUserId,
      commitmentId,
      expectedVersion: 10,
      idempotencyKey: `recovery-recurring-again-${suffix}`,
      request: { patch: { field: "IS_RECURRING", value: { isRecurring: true } } },
    });
    assert.equal(recurringAgain.workspaceVersion, 11);
    assert.equal(recurringAgain.data.commitment.status, "ACTIVE");
    assert.equal(recurringAgain.data.commitment.corrections.some((correction) => (
      correction.patch.field === "IS_RECURRING" && correction.status === "SUPERSEDED"
    )), true);

    await assert.rejects(
      getRecoveryCommitment({ workspaceId, actorUserId: outsiderUserId, commitmentId }),
      (error: unknown) => error instanceof RecoveryServiceError && error.code === "FORBIDDEN",
    );
    await assert.rejects(
      submitRecoveryEvidence({
        workspaceId,
        actorUserId: ownerUserId,
        expectedVersion: 1,
        idempotencyKey: `recovery-stale-${suffix}`,
        request: firstRequest,
      }),
      (error: unknown) => error instanceof RecoveryServiceError && error.code === "STALE_STATE" && error.currentVersion === 11,
    );

    const persisted = await pool.query<{
      sources: string;
      evidence: string;
      versions: string;
      raw_encrypted: boolean;
    }>(
      `select
         (select count(*)::text from recovery_sources where workspace_id = $1) as sources,
         (select count(*)::text from recovery_evidence where workspace_id = $1) as evidence,
         (select count(*)::text from recovery_workspace_versions where workspace_id = $1) as versions,
         bool_and((raw_evidence ->> 'encrypted')::boolean) as raw_encrypted
       from recovery_sources where workspace_id = $1`,
      [workspaceId],
    );
    assert.deepEqual(persisted.rows[0], { sources: "2", evidence: "2", versions: "11", raw_encrypted: true });
  } finally {
    await pool.query(`delete from workspaces where id = any($1::uuid[])`, [[workspaceId, outsiderWorkspaceId]]);
    await pool.query(`delete from users where id = any($1::uuid[])`, [[ownerUserId, outsiderUserId, viewerUserId]]);
  }
});

test("two realistic receipt observations infer one canonical monthly subscription", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const ownerUserId = randomUUID();
  const workspaceId = randomUUID();
  const suffix = randomUUID().slice(0, 8);

  await pool.query(`insert into users (id, email) values ($1, $2)`, [ownerUserId, `recovery-observed-${suffix}@example.test`]);
  await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Observed receipt workspace')`, [workspaceId, ownerUserId]);
  await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, ownerUserId]);

  try {
    const first = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `observed-first-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-july",
          text: "OpenAI\n\nChatGPT Plus subscription\n\nAmount: INR 1,999.00\n\nCharged on 6 July 2026",
        }],
      },
      now: new Date("2026-08-09T10:00:00.000Z"),
    });
    assert.equal(first.data.submission.acceptedEvidenceCount, 1);
    assert.equal(first.data.commitments.length, 0, "one observed charge must not fabricate recurrence");
    assert.equal(first.data.home.recentObservations.length, 1);
    assert.ok(first.data.home.recentObservations[0]?.evidenceId);
    assert.equal(first.data.home.recentObservations[0]?.merchant, "OpenAI");
    assert.equal(first.data.home.recentObservations[0]?.amount?.minor, "199900");
    assert.equal(first.data.home.recentObservations[0]?.amount?.currency, "INR");
    assert.equal(first.data.home.recentObservations[0]?.date, "2026-07-06");

    const second = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 1,
      idempotencyKey: `observed-second-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-august",
          text: "OpenAI ChatGPT Plus subscription\nAmount: INR 1,999.00\nCharged on 6 August 2026",
        }],
      },
      now: new Date("2026-08-10T10:00:00.000Z"),
    });

    assert.equal(second.data.submission.acceptedEvidenceCount, 1);
    assert.equal(second.data.commitments.length, 1);
    assert.equal(second.data.commitments[0]?.merchant, "OpenAI");
    assert.equal(second.data.commitments[0]?.cadence, "MONTHLY");
    assert.equal(second.data.commitments[0]?.amount.minor, "199900");
    assert.equal(second.data.commitments[0]?.evidenceCount, 2);
    assert.equal(second.data.commitments[0]?.nextExpectedDate, "2026-09-06");
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("observed receipt persistence keeps explicit merchants attached to their own dates", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const ownerUserId = randomUUID();
  const workspaceId = randomUUID();
  const suffix = randomUUID().slice(0, 8);

  await pool.query(`insert into users (id, email) values ($1, $2)`, [ownerUserId, `recovery-merchant-${suffix}@example.test`]);
  await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Merchant identity workspace')`, [workspaceId, ownerUserId]);
  await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, ownerUserId]);

  try {
    await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `merchant-identity-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "out-of-order-receipts",
          text: [
            "MERCHANT: Notion Labs; Payment date: 6 August 2026; Software subscription payment. Total: USD 10.00",
            "Merchant: Acme Cloud; Payment date: 6 July 2026; Software subscription payment. Total: INR 1,499.00",
          ].join("\n\n"),
        }],
      },
      now: new Date("2026-08-10T10:00:00.000Z"),
    });

    const evidence = await pool.query<{ merchant: string; category: string; evidence_date: string }>(
      `select merchant, category, evidence_date::text
       from recovery_evidence
       where workspace_id = $1
       order by evidence_date`,
      [workspaceId],
    );
    assert.deepEqual(evidence.rows, [
      { merchant: "Acme Cloud", category: "Cloud hosting", evidence_date: "2026-07-06" },
      { merchant: "Notion Labs", category: "Productivity", evidence_date: "2026-08-06" },
    ]);
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("upcoming-only receipt evidence never appears as a recent observed charge", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const ownerUserId = randomUUID();
  const workspaceId = randomUUID();
  const suffix = randomUUID().slice(0, 8);

  await pool.query(`insert into users (id, email) values ($1, $2)`, [ownerUserId, `recovery-upcoming-${suffix}@example.test`]);
  await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Upcoming-only workspace')`, [workspaceId, ownerUserId]);
  await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, ownerUserId]);

  try {
    const submitted = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `upcoming-only-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "future-mandate",
          text: "Pre-debit notification: mandate towards MAX BUPA HEALTH for INR 50,000 will be debited on 20 August 2026.",
        }],
      },
      now: new Date("2026-08-10T10:00:00.000Z"),
    });

    assert.equal(submitted.data.submission.acceptedEvidenceCount, 1);
    assert.equal(submitted.data.home.recentObservations.length, 0);
    assert.equal(submitted.data.home.next[0]?.date, "2026-08-20");
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("Recovery Home never combines workspace version v with commitment rows from v+1", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const ownerUserId = randomUUID();
  const workspaceId = randomUUID();
  const suffix = randomUUID().slice(0, 8);

  await pool.query(`insert into users (id, email) values ($1, $2)`, [ownerUserId, `recovery-coherence-${suffix}@example.test`]);
  await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Recovery coherence')`, [workspaceId, ownerUserId]);
  await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, ownerUserId]);

  const writer = await pool.connect();
  try {
    const baseline = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `coherence-baseline-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "coherence-openai",
          text: "OpenAI subscription charged INR 1,999 on 6 July 2026. Renews monthly on 6 August 2026.",
        }],
      },
      now: new Date("2026-08-09T10:00:00.000Z"),
    });
    assert.equal(baseline.workspaceVersion, 1);

    await writer.query("begin");
    const writerPid = (await writer.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
    await writer.query("lock table recovery_commitments in access exclusive mode");
    const readPromise = getRecoveryHome({ workspaceId, actorUserId: ownerUserId, generatedAt: new Date("2026-08-09T10:01:00.000Z") });
    await waitForBlockedCommitmentRead(pool, writerPid);

    await writer.query(
      `update recovery_commitments
       set effective_amount_minor = 209900,
           effective_monthly_minor = 209900,
           version = version + 1,
           updated_at = now()
       where workspace_id = $1`,
      [workspaceId],
    );
    await writer.query(`update recovery_workspace_states set version = 2 where workspace_id = $1`, [workspaceId]);
    await writer.query("commit");

    const home = await readPromise;
    assert.equal(home.workspace.version, 1);
    assert.equal(home.monthlyTotals.find((total) => total.amount.currency === "INR")?.amount.minor, "199900");
  } finally {
    await writer.query("rollback").catch(() => undefined);
    writer.release();
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("Recovery persists JPY, KWD, and PostgreSQL-bigint corrections without JS-number loss", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const ownerUserId = randomUUID();
  const workspaceId = randomUUID();
  const suffix = randomUUID().slice(0, 8);

  await pool.query(`insert into users (id, email) values ($1, $2)`, [ownerUserId, `recovery-money-${suffix}@example.test`]);
  await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Recovery exact money')`, [workspaceId, ownerUserId]);
  await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, ownerUserId]);

  try {
    const submitted = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `exact-money-${suffix}`,
      request: {
        kind: "CSV_IMPORT",
        sources: [{
          clientRef: "exact-money-csv",
          name: "exact-money.csv",
          text: [
            "Date,Description,Debit,Credit,Currency",
            "2026-06-01,NETFLIX SUBSCRIPTION,1999,,JPY",
            "2026-07-01,NETFLIX SUBSCRIPTION,1999,,JPY",
            "2026-06-02,NOTION SUBSCRIPTION,1.234,,KWD",
            "2026-07-02,NOTION SUBSCRIPTION,1.234,,KWD",
          ].join("\n"),
        }],
      },
      now: new Date("2026-08-09T10:00:00.000Z"),
    });
    assert.equal(submitted.workspaceVersion, 1);
    const listed = await listRecoveryCommitments({ workspaceId, actorUserId: ownerUserId, limit: 10 });
    assert.equal(listed.total, 2);
    const jpy = listed.items.find((item) => item.amount.currency === "JPY");
    const kwd = listed.items.find((item) => item.amount.currency === "KWD");
    assert.deepEqual(jpy?.amount, { currency: "JPY", minor: "1999", exponent: 0, display: "JP¥1,999" });
    assert.equal(kwd?.amount.minor, "1234");
    assert.equal(kwd?.amount.exponent, 3);
    assert.match(kwd?.amount.display ?? "", /1\.234/);

    assert.ok(jpy);
    const corrected = await createRecoveryCorrection({
      workspaceId,
      actorUserId: ownerUserId,
      commitmentId: jpy.id,
      expectedVersion: 1,
      idempotencyKey: `exact-money-correction-${suffix}`,
      request: { patch: { field: "AMOUNT", value: { amountMinor: "9007199254740993" } } },
    });
    assert.equal(corrected.data.commitment.amount.minor, "9007199254740993");
    assert.equal(corrected.data.commitment.amount.exponent, 0);
    assert.equal((await pool.query<{ amount: string }>(
      `select effective_amount_minor::text as amount
       from recovery_commitments where workspace_id = $1 and id = $2`,
      [workspaceId, jpy.id],
    )).rows[0]?.amount, "9007199254740993");
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("Recovery cutover proceeds only when the signed workspace has zero legacy authority rows", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const recurringItemId = randomUUID();
  try {
    await pool.query(`insert into users (id, email) values ($1, $2)`, [userId, `${userId}@cutover.test`]);
    await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Cutover test')`, [workspaceId, userId]);
    await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, userId]);
    assert.deepEqual(await getRecoveryCutoverStatus({ workspaceId, actorUserId: userId }), {
      status: "CLEAR",
      counts: { workspaceSnapshots: 0, recurringItems: 0, evidenceLinks: 0, decisions: 0, transactions: 0, dataSources: 0, connectorEvidence: 0, connectedAccounts: 0 },
    });

    await pool.query(
      `insert into recurring_items (
         id, workspace_id, merchant, normalized_merchant, category, frequency,
         currency, amount_min, amount_max, average_amount, monthly_cost,
         annual_cost, confidence_score, status
       ) values ($1, $2, 'Legacy Merchant', 'legacy merchant', 'Software', 'monthly',
         'INR', 499, 499, 499, 499, 5988, 95, 'keep')`,
      [recurringItemId, workspaceId],
    );
    const blocked = await getRecoveryCutoverStatus({ workspaceId, actorUserId: userId });
    assert.equal(blocked.status, "LEGACY_DATA_REQUIRES_MIGRATION");
    assert.equal(blocked.counts.recurringItems, 1);
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [userId]);
  }
});

async function waitForBlockedCommitmentRead(pool: ReturnType<typeof getDatabasePool>, writerPid: number) {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const waiting = await pool.query<{ blocked: boolean }>(
      `select exists (
         select 1 from pg_stat_activity
         where datname = current_database()
           and $1 = any(pg_blocking_pids(pid))
       ) as blocked`,
      [writerPid],
    );
    if (waiting.rows[0]?.blocked) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Home did not reach the commitment read while the deterministic test lock was held.");
}
