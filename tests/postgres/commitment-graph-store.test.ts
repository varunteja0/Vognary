import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { getDatabasePool } from "../../src/lib/server/database";
import {
  acknowledgeChangeSignal,
  answerDuplicateSuspicion,
  readCommitmentGraph,
  recordCancellationEvent,
  refreshCommitmentGraph,
} from "../../src/lib/server/recovery-graph-store";

const databaseConfigured = Boolean(process.env.DATABASE_URL);
const skip = databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.";

const now = new Date("2026-08-17T09:00:00.000Z");

type Workspace = Awaited<ReturnType<typeof seedWorkspace>>;

async function seedWorkspace() {
  const pool = getDatabasePool();
  const ownerUserId = randomUUID();
  const workspaceId = randomUUID();
  const submissionId = randomUUID();
  const sourceId = randomUUID();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);

  await pool.query(`insert into users (id, email, display_name) values ($1, $2, 'Graph owner')`, [
    ownerUserId, `graph-store-${suffix}@example.test`,
  ]);
  await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Graph store workspace')`, [
    workspaceId, ownerUserId,
  ]);
  await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [
    workspaceId, ownerUserId,
  ]);
  await pool.query(
    `insert into recovery_submissions (id, workspace_id, submitted_by_user_id, source_type, accepted_evidence_count)
     values ($1, $2, $3, 'RECEIPT_PASTE', 3)`,
    [submissionId, workspaceId, ownerUserId],
  );
  await pool.query(
    `insert into recovery_sources (id, workspace_id, submission_id, source_type, client_ref, label, content_hash, raw_evidence, coverage_start, coverage_end, ingested_at)
     values ($1, $2, $3, 'FORWARDED_EMAIL', $4, 'Forwarded receipts', $5, '{}'::jsonb, '2026-04-01', '2026-08-05', '2026-08-14T09:00:00Z')`,
    [sourceId, workspaceId, submissionId, `ref-${suffix}`, suffix.padEnd(64, "0")],
  );
  return { pool, ownerUserId, workspaceId, sourceId, suffix };
}

let evidenceCounter = 0;

async function addCommitment(workspace: Workspace, input: {
  merchant: string;
  amountMinor: number;
  nextExpectedDate: string | null;
  observations: readonly { date: string; amountMinor: number }[];
  firstDetectedAt?: string;
}) {
  const commitmentId = randomUUID();
  const normalized = input.merchant.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  await workspace.pool.query(
    `insert into recovery_commitments (
       id, workspace_id, identity_key, base_status, base_merchant, base_category, base_cadence, base_currency,
       base_amount_minor, base_monthly_minor, base_next_expected_date, effective_status, effective_merchant,
       effective_cadence, effective_amount_minor, effective_monthly_minor, effective_next_expected_date,
       confidence_score, recommended_decision, recommendation_reason, first_detected_at
     ) values ($1, $2, $3, 'ACTIVE', $4, 'Entertainment', 'MONTHLY', 'INR',
       $5, $5, $6, 'ACTIVE', $4, 'MONTHLY', $5, $5, $6, 90, 'MONITOR', 'Seen repeatedly.', $7)`,
    [
      commitmentId, workspace.workspaceId, `${normalized}-${randomUUID().slice(0, 8)}`, input.merchant,
      input.amountMinor, input.nextExpectedDate, input.firstDetectedAt ?? "2026-07-20T00:00:00Z",
    ],
  );
  for (const observation of input.observations) {
    evidenceCounter += 1;
    const evidenceId = randomUUID();
    await workspace.pool.query(
      `insert into recovery_evidence (
         id, workspace_id, source_id, fingerprint, evidence_kind, row_number, observed_at, excerpt, merchant,
         normalized_merchant, category, amount_minor, currency, evidence_date, direction, provenance_kind,
         provenance_reference, confidence_state, confidence_score, created_at
       ) values ($1, $2, $3, $4, 'RECEIPT', $5, $6::timestamptz, $7, $8, $9, 'Entertainment', $10, 'INR', $6::date, 'debit',
         'PROVIDER_RECEIVED', $11, 'HIGH', 90, '2026-08-14T09:00:00Z')`,
      [
        evidenceId, workspace.workspaceId, workspace.sourceId,
        randomUUID().replaceAll("-", "").padEnd(64, "0").slice(0, 64).replace(/[^0-9a-f]/g, "0"),
        evidenceCounter, observation.date, `${input.merchant} INR receipt`, input.merchant, normalized,
        observation.amountMinor, `ref-${workspace.suffix}`,
      ],
    );
    await workspace.pool.query(
      `insert into recovery_commitment_evidence (workspace_id, commitment_id, evidence_id) values ($1, $2, $3)`,
      [workspace.workspaceId, commitmentId, evidenceId],
    );
  }
  return commitmentId;
}

async function erase(workspace: Workspace) {
  await workspace.pool.query(`delete from workspaces where id = $1`, [workspace.workspaceId]);
  await workspace.pool.query(`delete from users where id = $1`, [workspace.ownerUserId]);
}

function actor(workspace: Workspace) {
  return { workspaceId: workspace.workspaceId, actorUserId: workspace.ownerUserId };
}

async function openSignalKinds(workspace: Workspace) {
  const result = await workspace.pool.query<{ kind: string }>(
    `select kind from recovery_change_signals where workspace_id = $1 and state = 'OPEN' order by kind`,
    [workspace.workspaceId],
  );
  return result.rows.map((row) => row.kind);
}

test("a refresh derives belief, coverage and change from persisted evidence alone", { skip }, async () => {
  const workspace = await seedWorkspace();
  try {
    const commitmentId = await addCommitment(workspace, {
      merchant: "Netflix",
      amountMinor: 64900,
      nextExpectedDate: "2026-08-05",
      observations: [
        { date: "2026-06-05", amountMinor: 64900 },
        { date: "2026-07-05", amountMinor: 64900 },
        { date: "2026-08-05", amountMinor: 64900 },
      ],
    });

    const first = await refreshCommitmentGraph({ ...actor(workspace), now });
    assert.equal(first.commitmentCount, 1);
    assert.equal(first.sourceCount, 1);

    const state = await workspace.pool.query<{
      lifecycle_state: string; coverage_state: string; prediction_state: string;
      last_verified_on: string; next_verification_due_on: string; belief: string;
    }>(
      `select lifecycle_state, coverage_state, prediction_state,
              last_verified_on::text as last_verified_on,
              next_verification_due_on::text as next_verification_due_on, belief
       from recovery_commitment_states where workspace_id = $1 and commitment_id = $2`,
      [workspace.workspaceId, commitmentId],
    );
    assert.equal(state.rows[0]?.lifecycle_state, "ESTABLISHED");
    assert.equal(state.rows[0]?.coverage_state, "CURRENT");
    assert.equal(state.rows[0]?.prediction_state, "PREDICTED");
    assert.equal(state.rows[0]?.last_verified_on, "2026-08-05");
    assert.equal(state.rows[0]?.next_verification_due_on, "2026-08-10");
    assert.match(state.rows[0]!.belief, /Netflix/);
    assert.deepEqual(await openSignalKinds(workspace), ["NEW_RECURRING_COMMITMENT"]);
  } finally {
    await erase(workspace);
  }
});

test("refreshing twice against unchanged facts writes no new change", { skip }, async () => {
  const workspace = await seedWorkspace();
  try {
    await addCommitment(workspace, {
      merchant: "Netflix",
      amountMinor: 64900,
      nextExpectedDate: "2026-08-05",
      observations: [{ date: "2026-07-05", amountMinor: 64900 }, { date: "2026-08-05", amountMinor: 64900 }],
    });
    const first = await refreshCommitmentGraph({ ...actor(workspace), now });
    assert.equal(first.openedSignals, 1);
    const second = await refreshCommitmentGraph({ ...actor(workspace), now });
    assert.equal(second.openedSignals, 0);
    assert.equal(second.reopenedSignals, 0);
    assert.equal(second.resolvedSignals, 0);
    assert.equal(second.supersededSignals, 0);
  } finally {
    await erase(workspace);
  }
});

test("a price rise is raised with an exact delta and cites the newer receipt", { skip }, async () => {
  const workspace = await seedWorkspace();
  try {
    await addCommitment(workspace, {
      merchant: "Netflix",
      amountMinor: 74900,
      nextExpectedDate: "2026-08-05",
      firstDetectedAt: "2026-01-05T00:00:00Z",
      observations: [
        { date: "2026-06-05", amountMinor: 64900 },
        { date: "2026-07-05", amountMinor: 64900 },
        { date: "2026-08-05", amountMinor: 74900 },
      ],
    });
    await refreshCommitmentGraph({ ...actor(workspace), now });
    const signal = await workspace.pool.query<{ kind: string; delta_minor: string; citation_kind: string; cited: string[] }>(
      `select kind, delta_minor::text as delta_minor, citation_kind, cited_evidence_ids as cited
       from recovery_change_signals where workspace_id = $1 and kind = 'PRICE_INCREASE'`,
      [workspace.workspaceId],
    );
    assert.equal(signal.rows[0]?.delta_minor, "10000");
    assert.equal(signal.rows[0]?.citation_kind, "EVIDENCE");
    assert.equal(signal.rows[0]?.cited.length, 1);
  } finally {
    await erase(workspace);
  }
});

test("a missing charge is raised only while its own coverage is current", { skip }, async () => {
  const workspace = await seedWorkspace();
  try {
    const commitmentId = await addCommitment(workspace, {
      merchant: "Netflix",
      amountMinor: 64900,
      nextExpectedDate: "2026-08-05",
      firstDetectedAt: "2026-01-05T00:00:00Z",
      observations: [{ date: "2026-06-05", amountMinor: 64900 }, { date: "2026-07-05", amountMinor: 64900 }],
    });
    await refreshCommitmentGraph({ ...actor(workspace), now });
    assert.deepEqual(await openSignalKinds(workspace), ["EXPECTED_CHARGE_MISSING"]);
    const absence = await workspace.pool.query<{ citation_kind: string; cited: string[]; start: string; finish: string }>(
      `select citation_kind, cited_source_ids as cited,
              absence_window_start::text as start, absence_window_end::text as finish
       from recovery_change_signals where workspace_id = $1 and kind = 'EXPECTED_CHARGE_MISSING'`,
      [workspace.workspaceId],
    );
    assert.equal(absence.rows[0]?.citation_kind, "COVERED_ABSENCE");
    assert.deepEqual(absence.rows[0]?.cited, [workspace.sourceId]);
    assert.equal(absence.rows[0]?.start, "2026-08-04");
    assert.equal(absence.rows[0]?.finish, "2026-08-10");

    await workspace.pool.query(
      `insert into recovery_source_disconnections (workspace_id, source_id) values ($1, $2)`,
      [workspace.workspaceId, workspace.sourceId],
    );
    await refreshCommitmentGraph({ ...actor(workspace), now });
    assert.deepEqual(await openSignalKinds(workspace), ["COVERAGE_BROKEN"]);
    const broken = await workspace.pool.query<{ lifecycle_state: string; coverage_state: string }>(
      `select lifecycle_state, coverage_state from recovery_commitment_states where workspace_id = $1 and commitment_id = $2`,
      [workspace.workspaceId, commitmentId],
    );
    assert.equal(broken.rows[0]?.lifecycle_state, "UNVERIFIABLE");
    assert.equal(broken.rows[0]?.coverage_state, "BROKEN");

    await workspace.pool.query(
      `update recovery_source_disconnections set reconnected_at = now() where workspace_id = $1 and source_id = $2`,
      [workspace.workspaceId, workspace.sourceId],
    );
    // The charge is still missing, so restoring the source must bring it back
    // rather than leaving a real problem silently closed by an outage.
    const restored = await refreshCommitmentGraph({ ...actor(workspace), now });
    assert.equal(restored.reopenedSignals, 1);
    assert.deepEqual(await openSignalKinds(workspace), ["EXPECTED_CHARGE_MISSING"]);
    const resolved = await workspace.pool.query<{ state: string }>(
      `select state from recovery_change_signals where workspace_id = $1 and kind = 'COVERAGE_BROKEN'`,
      [workspace.workspaceId],
    );
    assert.equal(resolved.rows[0]?.state, "RESOLVED");
  } finally {
    await erase(workspace);
  }
});

test("the attention feed reads back in plain language with a next step", { skip }, async () => {
  const workspace = await seedWorkspace();
  try {
    await addCommitment(workspace, {
      merchant: "Netflix",
      amountMinor: 64900,
      nextExpectedDate: "2026-08-05",
      observations: [{ date: "2026-07-05", amountMinor: 64900 }, { date: "2026-08-05", amountMinor: 64900 }],
    });
    await refreshCommitmentGraph({ ...actor(workspace), now });
    const view = await readCommitmentGraph({ ...actor(workspace), evaluatedOn: "2026-08-17" });
    assert.equal(view.attention.length, 1);
    assert.equal(view.attention[0]?.nextStep, "REVIEW_SUBSCRIPTION");
    assert.match(view.attention[0]!.headline, /Netflix/);
    assert.doesNotMatch(view.attention[0]!.headline, /[A-Z]{3,}_[A-Z]/);
    assert.equal(view.coverage.state, "CURRENT");
    assert.equal(view.sources.length, 1);
    assert.equal(view.commitments.length, 1);
    assert.ok(view.commitments[0]!.falsifiability.length > 0);

    const acknowledged = await acknowledgeChangeSignal({ ...actor(workspace), dedupeKey: view.attention[0]!.id });
    assert.equal(acknowledged.acknowledged, true);
    const again = await acknowledgeChangeSignal({ ...actor(workspace), dedupeKey: view.attention[0]!.id });
    assert.equal(again.acknowledged, false);
    const afterAck = await readCommitmentGraph({ ...actor(workspace), evaluatedOn: "2026-08-17" });
    assert.equal(afterAck.attention.length, 0);
  } finally {
    await erase(workspace);
  }
});

test("the cancellation lifecycle is appended as auditable events and can never claim settlement", { skip }, async () => {
  const workspace = await seedWorkspace();
  try {
    const commitmentId = await addCommitment(workspace, {
      merchant: "Netflix",
      amountMinor: 64900,
      nextExpectedDate: "2026-09-05",
      observations: [{ date: "2026-07-05", amountMinor: 64900 }, { date: "2026-08-05", amountMinor: 64900 }],
    });
    await refreshCommitmentGraph({ ...actor(workspace), now });

    const intent = await recordCancellationEvent({
      ...actor(workspace), commitmentId, idempotencyKey: "intent-1",
      event: { kind: "INTENT_RECORDED", at: now.toISOString() },
    });
    assert.equal(intent.state, "CANCELLATION_INTENT_RECORDED");

    const claimed = await recordCancellationEvent({
      ...actor(workspace), commitmentId, idempotencyKey: "claim-1",
      event: { kind: "CANCELLATION_CLAIMED", at: now.toISOString(), claimSource: "USER_REPORTED", evidenceIds: [] },
    });
    assert.equal(claimed.state, "CANCELLATION_CLAIMED");
    assert.equal(claimed.proof, "NONE");

    await assert.rejects(
      recordCancellationEvent({
        ...actor(workspace), commitmentId, idempotencyKey: "settle-1",
        event: { kind: "SETTLEMENT_CONFIRMED", at: now.toISOString(), sourceKind: "REGULATED_ACCOUNT_FEED", evidenceIds: [] },
      }),
      /regulated money feed/,
    );

    const events = await workspace.pool.query<{ event_kind: string; to_state: string; proof: string }>(
      `select event_kind, to_state, proof from recovery_cancellation_events
       where workspace_id = $1 and commitment_id = $2 order by recorded_at, idempotency_key`,
      [workspace.workspaceId, commitmentId],
    );
    assert.deepEqual(events.rows.map((row) => row.to_state), ["CANCELLATION_INTENT_RECORDED", "CANCELLATION_CLAIMED"]);
    assert.ok(events.rows.every((row) => row.proof === "NONE"));

    const state = await workspace.pool.query<{ cancellation_state: string; lifecycle_state: string }>(
      `select cancellation_state, lifecycle_state from recovery_commitment_states where workspace_id = $1 and commitment_id = $2`,
      [workspace.workspaceId, commitmentId],
    );
    assert.equal(state.rows[0]?.cancellation_state, "CANCELLATION_CLAIMED");
    await refreshCommitmentGraph({ ...actor(workspace), now });
    const afterRefresh = await workspace.pool.query<{ lifecycle_state: string }>(
      `select lifecycle_state from recovery_commitment_states where workspace_id = $1 and commitment_id = $2`,
      [workspace.workspaceId, commitmentId],
    );
    assert.equal(afterRefresh.rows[0]?.lifecycle_state, "ENDING");
  } finally {
    await erase(workspace);
  }
});

test("a suspected duplicate is asked about, answered, remembered and learned from", { skip }, async () => {
  const workspace = await seedWorkspace();
  try {
    const first = await addCommitment(workspace, {
      merchant: "Netflix",
      amountMinor: 64900,
      nextExpectedDate: "2026-09-05",
      firstDetectedAt: "2026-01-05T00:00:00Z",
      observations: [{ date: "2026-07-05", amountMinor: 64900 }, { date: "2026-08-05", amountMinor: 64900 }],
    });
    const second = await addCommitment(workspace, {
      merchant: "Netflix Ltd",
      amountMinor: 64900,
      nextExpectedDate: "2026-09-06",
      firstDetectedAt: "2026-01-05T00:00:00Z",
      observations: [{ date: "2026-07-06", amountMinor: 64900 }, { date: "2026-08-06", amountMinor: 64900 }],
    });
    await refreshCommitmentGraph({ ...actor(workspace), now });
    assert.ok((await openSignalKinds(workspace)).includes("DUPLICATE_SUSPECTED"));

    const answered = await answerDuplicateSuspicion({
      ...actor(workspace), commitmentId: first, otherCommitmentId: second, sameSubscription: false, now,
    });
    assert.equal(answered.sameSubscription, false);

    const rejection = await workspace.pool.query<{ total: string }>(
      `select count(*)::text as total from recovery_merchant_merge_rejections where workspace_id = $1`,
      [workspace.workspaceId],
    );
    assert.equal(rejection.rows[0]?.total, "1");

    const learned = await workspace.pool.query<{ kind: string; label: string; features: Record<string, unknown> }>(
      `select kind, label, features from recovery_correction_outcomes where workspace_id = $1`,
      [workspace.workspaceId],
    );
    assert.equal(learned.rows[0]?.kind, "DUPLICATE_MERGE_REJECTED");
    assert.equal(learned.rows[0]?.label, "REJECTED");
    assert.equal(learned.rows[0]?.features.onlyFuzzySignal, true);

    await refreshCommitmentGraph({ ...actor(workspace), now });
    const stillAsked = await workspace.pool.query<{ state: string }>(
      `select state from recovery_change_signals where workspace_id = $1 and kind = 'DUPLICATE_SUSPECTED'`,
      [workspace.workspaceId],
    );
    assert.deepEqual(stillAsked.rows.map((row) => row.state), ["RESOLVED"]);
  } finally {
    await erase(workspace);
  }
});

test("a member of another workspace cannot read or refresh this graph", { skip }, async () => {
  const workspace = await seedWorkspace();
  const outsider = await seedWorkspace();
  try {
    await addCommitment(workspace, {
      merchant: "Netflix", amountMinor: 64900, nextExpectedDate: "2026-08-05",
      observations: [{ date: "2026-08-05", amountMinor: 64900 }],
    });
    await assert.rejects(
      refreshCommitmentGraph({ workspaceId: workspace.workspaceId, actorUserId: outsider.ownerUserId, now }),
      /cannot perform that action/i,
    );
    await assert.rejects(
      readCommitmentGraph({ workspaceId: workspace.workspaceId, actorUserId: outsider.ownerUserId }),
      /cannot perform that action/i,
    );
  } finally {
    await erase(workspace);
    await erase(outsider);
  }
});
