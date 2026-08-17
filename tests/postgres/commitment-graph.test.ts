import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { getDatabasePool } from "../../src/lib/server/database";

const databaseConfigured = Boolean(process.env.DATABASE_URL);
const skip = databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.";

type Seed = Awaited<ReturnType<typeof seedGraph>>;

async function seedGraph() {
  const pool = getDatabasePool();
  const ownerUserId = randomUUID();
  const workspaceId = randomUUID();
  const submissionId = randomUUID();
  const sourceId = randomUUID();
  const evidenceId = randomUUID();
  const commitmentId = randomUUID();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);

  await pool.query(`insert into users (id, email, display_name) values ($1, $2, 'Graph owner')`, [
    ownerUserId, `graph-owner-${suffix}@example.test`,
  ]);
  await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Graph workspace')`, [
    workspaceId, ownerUserId,
  ]);
  await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [
    workspaceId, ownerUserId,
  ]);
  await pool.query(
    `insert into recovery_submissions (id, workspace_id, submitted_by_user_id, source_type, accepted_evidence_count)
     values ($1, $2, $3, 'RECEIPT_PASTE', 1)`,
    [submissionId, workspaceId, ownerUserId],
  );
  await pool.query(
    `insert into recovery_sources (id, workspace_id, submission_id, source_type, client_ref, label, content_hash, raw_evidence, coverage_start, coverage_end)
     values ($1, $2, $3, 'FORWARDED_EMAIL', $4, 'Forwarded receipts', $5, '{}'::jsonb, '2026-04-01', '2026-08-14')`,
    [sourceId, workspaceId, submissionId, `ref-${suffix}`, suffix.padEnd(64, "0")],
  );
  await pool.query(
    `insert into recovery_evidence (
       id, workspace_id, source_id, fingerprint, evidence_kind, row_number, observed_at, excerpt, merchant, normalized_merchant,
       category, amount_minor, currency, evidence_date, direction, provenance_kind, provenance_reference,
       confidence_state, confidence_score
     ) values ($1, $2, $3, $4, 'RECEIPT', 1, now(), 'Netflix INR 649.00', 'Netflix', 'netflix',
       'Entertainment', 64900, 'INR', '2026-08-05', 'debit', 'PROVIDER_RECEIVED', $5, 'HIGH', 90)`,
    [evidenceId, workspaceId, sourceId, suffix.padEnd(64, "1"), `ref-${suffix}`],
  );
  await pool.query(
    `insert into recovery_commitments (
       id, workspace_id, identity_key, base_status, base_merchant, base_category, base_cadence, base_currency,
       base_amount_minor, base_monthly_minor, base_next_expected_date, effective_status, effective_merchant,
       effective_cadence, effective_amount_minor, effective_monthly_minor, effective_next_expected_date,
       confidence_score, recommended_decision, recommendation_reason
     ) values ($1, $2, $3, 'ACTIVE', 'Netflix', 'Entertainment', 'MONTHLY', 'INR',
       64900, 64900, '2026-09-05', 'ACTIVE', 'Netflix', 'MONTHLY', 64900, 64900, '2026-09-05',
       90, 'MONITOR', 'Seen three times in a row.')`,
    [commitmentId, workspaceId, `netflix-${suffix}`],
  );
  return { pool, ownerUserId, workspaceId, sourceId, evidenceId, commitmentId, suffix };
}

async function createMerchant(seed: Seed, currency: string) {
  const merchantId = randomUUID();
  await seed.pool.query(
    `insert into recovery_merchants (id, workspace_id, currency, display_name) values ($1, $2, $3, $4)`,
    [merchantId, seed.workspaceId, currency, `Netflix ${currency} ${randomUUID().slice(0, 6)}`],
  );
  return merchantId;
}

async function eraseWorkspace(seed: Seed) {
  await seed.pool.query(`delete from workspaces where id = $1`, [seed.workspaceId]);
  await seed.pool.query(`delete from users where id = $1`, [seed.ownerUserId]);
}

test("a merchant link may never cross currency", { skip }, async () => {
  const seed = await seedGraph();
  try {
    const inrMerchant = await createMerchant(seed, "INR");
    const usdMerchant = await createMerchant(seed, "USD");
    await seed.pool.query(
      `insert into recovery_merchant_links (workspace_id, commitment_id, merchant_id, decision, score, strongest_signal_kind, cited_evidence_ids)
       values ($1, $2, $3, 'AUTO_MERGE', 100, 'GSTIN', array[$4::uuid])`,
      [seed.workspaceId, seed.commitmentId, inrMerchant, seed.evidenceId],
    );
    await assert.rejects(
      seed.pool.query(
        `insert into recovery_merchant_links (workspace_id, commitment_id, merchant_id, decision, score, strongest_signal_kind, cited_evidence_ids)
         values ($1, $2, $3, 'AUTO_MERGE', 100, 'GSTIN', array[$4::uuid])`,
        [seed.workspaceId, seed.commitmentId, usdMerchant, seed.evidenceId],
      ),
      /may not cross currency/,
    );
  } finally {
    await eraseWorkspace(seed);
  }
});

test("a commitment belongs to at most one merchant until the link is reversed", { skip }, async () => {
  const seed = await seedGraph();
  try {
    const first = await createMerchant(seed, "INR");
    const second = await createMerchant(seed, "INR");
    const link = (merchantId: string) => seed.pool.query(
      `insert into recovery_merchant_links (workspace_id, commitment_id, merchant_id, decision, score, strongest_signal_kind, cited_evidence_ids)
       values ($1, $2, $3, 'AUTO_MERGE', 100, 'BILLING_DOMAIN', array[$4::uuid])`,
      [seed.workspaceId, seed.commitmentId, merchantId, seed.evidenceId],
    );
    await link(first);
    await assert.rejects(link(second), /recovery_merchant_links_active_idx/);
    await seed.pool.query(
      `update recovery_merchant_links set reversed_at = now(), reversed_by_user_id = $3
       where workspace_id = $1 and merchant_id = $2`,
      [seed.workspaceId, first, seed.ownerUserId],
    );
    await link(second);
  } finally {
    await eraseWorkspace(seed);
  }
});

test("a merge citing nothing cannot be stored", { skip }, async () => {
  const seed = await seedGraph();
  try {
    const merchantId = await createMerchant(seed, "INR");
    await assert.rejects(
      seed.pool.query(
        `insert into recovery_merchant_links (workspace_id, commitment_id, merchant_id, decision, score, strongest_signal_kind)
         values ($1, $2, $3, 'AUTO_MERGE', 100, 'BILLING_DOMAIN')`,
        [seed.workspaceId, seed.commitmentId, merchantId],
      ),
      /cited_evidence_ids/,
    );
  } finally {
    await eraseWorkspace(seed);
  }
});

test("identity signals are append-only but still cascade on erasure", { skip }, async () => {
  const seed = await seedGraph();
  try {
    const merchantId = await createMerchant(seed, "INR");
    await seed.pool.query(
      `insert into recovery_merchant_signals (workspace_id, merchant_id, evidence_id, signal_kind, signal_key)
       values ($1, $2, $3, 'BILLING_DOMAIN', 'netflix.com')`,
      [seed.workspaceId, merchantId, seed.evidenceId],
    );
    await assert.rejects(
      seed.pool.query(`update recovery_merchant_signals set signal_key = 'evil.tld' where workspace_id = $1`, [seed.workspaceId]),
      /append-only/,
    );
    await assert.rejects(
      seed.pool.query(`delete from recovery_merchant_signals where workspace_id = $1`, [seed.workspaceId]),
      /append-only/,
    );
    await eraseWorkspace(seed);
    const remaining = await seed.pool.query(
      `select count(*)::text as total from recovery_merchant_signals where workspace_id = $1`,
      [seed.workspaceId],
    );
    assert.equal(remaining.rows[0]?.total, "0");
  } finally {
    await eraseWorkspace(seed);
  }
});

test("a commitment can never be recorded as settled by the database", { skip }, async () => {
  const seed = await seedGraph();
  try {
    const insertState = (cancellationState: string) => seed.pool.query(
      `insert into recovery_commitment_states (
         workspace_id, commitment_id, lifecycle_state, coverage_state, conflict_state, prediction_state,
         cancellation_state, belief, evaluated_on, expected_window_start, expected_window_end
       ) values ($1, $2, 'ESTABLISHED', 'CURRENT', 'NONE', 'PREDICTED', $3,
         'Netflix is billing you on a steady rhythm.', '2026-08-17', '2026-09-04', '2026-09-10')
       on conflict (workspace_id, commitment_id) do update set cancellation_state = excluded.cancellation_state`,
      [seed.workspaceId, seed.commitmentId, cancellationState],
    );
    await insertState("CANCELLATION_CLAIMED");
    await assert.rejects(insertState("CONFIRMED_BY_SETTLEMENT"), /settlement_reserved/);
    await assert.rejects(
      seed.pool.query(
        `insert into recovery_cancellation_events (workspace_id, commitment_id, idempotency_key, event_kind, from_state, to_state, proof)
         values ($1, $2, 'k1', 'CHARGE_EVALUATED', 'WAITING_FOR_EXPECTED_WINDOW', 'CONFIRMED_BY_SETTLEMENT', 'NONE')`,
        [seed.workspaceId, seed.commitmentId],
      ),
      /to_state_check/,
    );
  } finally {
    await eraseWorkspace(seed);
  }
});

test("covered absence is the only proof a cancellation event may claim", { skip }, async () => {
  const seed = await seedGraph();
  try {
    await assert.rejects(
      seed.pool.query(
        `insert into recovery_cancellation_events (workspace_id, commitment_id, idempotency_key, event_kind, from_state, to_state, proof)
         values ($1, $2, 'k1', 'CHARGE_EVALUATED', 'WAITING_FOR_EXPECTED_WINDOW', 'CHARGED_AGAIN', 'SETTLEMENT')`,
        [seed.workspaceId, seed.commitmentId],
      ),
      /proof_check/,
    );
    await assert.rejects(
      seed.pool.query(
        `insert into recovery_cancellation_events (workspace_id, commitment_id, idempotency_key, event_kind, from_state, to_state, proof)
         values ($1, $2, 'k2', 'CHARGE_EVALUATED', 'WAITING_FOR_EXPECTED_WINDOW', 'CHARGED_AGAIN', 'COVERED_ABSENCE')`,
        [seed.workspaceId, seed.commitmentId],
      ),
      /covered_absence_check/,
    );
    await seed.pool.query(
      `insert into recovery_cancellation_events (workspace_id, commitment_id, idempotency_key, event_kind, from_state, to_state, proof)
       values ($1, $2, 'k3', 'CHARGE_EVALUATED', 'WAITING_FOR_EXPECTED_WINDOW', 'LIKELY_STOPPED_BY_COVERED_ABSENCE', 'COVERED_ABSENCE')`,
      [seed.workspaceId, seed.commitmentId],
    );
    await assert.rejects(
      seed.pool.query(
        `insert into recovery_cancellation_events (workspace_id, commitment_id, idempotency_key, event_kind, from_state, to_state, proof)
         values ($1, $2, 'k3', 'CHARGE_EVALUATED', 'WAITING_FOR_EXPECTED_WINDOW', 'LIKELY_STOPPED_BY_COVERED_ABSENCE', 'COVERED_ABSENCE')`,
        [seed.workspaceId, seed.commitmentId],
      ),
      /duplicate key value violates unique constraint "recovery_cancellation_events_workspace_id_commitment_id_ide/,
    );
  } finally {
    await eraseWorkspace(seed);
  }
});

test("a published prediction must publish the window it rests on", { skip }, async () => {
  const seed = await seedGraph();
  try {
    await assert.rejects(
      seed.pool.query(
        `insert into recovery_commitment_states (
           workspace_id, commitment_id, lifecycle_state, coverage_state, conflict_state, prediction_state,
           belief, evaluated_on
         ) values ($1, $2, 'ESTABLISHED', 'CURRENT', 'NONE', 'PREDICTED', 'Steady.', '2026-08-17')`,
        [seed.workspaceId, seed.commitmentId],
      ),
      /prediction_check/,
    );
  } finally {
    await eraseWorkspace(seed);
  }
});

test("a one-off import can never be recorded as a live source", { skip }, async () => {
  const seed = await seedGraph();
  try {
    await assert.rejects(
      seed.pool.query(
        `insert into recovery_source_health (workspace_id, source_id, liveness_state, automatic)
         values ($1, $2, 'CURRENT', false)`,
        [seed.workspaceId, seed.sourceId],
      ),
      /automatic_check/,
    );
    await seed.pool.query(
      `insert into recovery_source_health (workspace_id, source_id, liveness_state, automatic)
       values ($1, $2, 'BASELINE_ONLY', false)`,
      [seed.workspaceId, seed.sourceId],
    );
  } finally {
    await eraseWorkspace(seed);
  }
});

test("a change signal that cites nothing cannot be stored", { skip }, async () => {
  const seed = await seedGraph();
  try {
    const insert = (columns: string, values: string, params: unknown[]) => seed.pool.query(
      `insert into recovery_change_signals (workspace_id, dedupe_key, kind, commitment_id, materiality, confidence, title, detail, citation_kind${columns})
       values ($1, $2, $3, $4, 'HIGH', 100, 'Netflix costs more', 'The latest charge was higher.', $5${values})`,
      params,
    );
    await assert.rejects(
      insert("", "", [seed.workspaceId, "k1", "PRICE_INCREASE", seed.commitmentId, "EVIDENCE"]),
      /citation_check/,
    );
    await assert.rejects(
      insert(", cited_source_ids", ", array[$6::uuid]", [seed.workspaceId, "k2", "EXPECTED_CHARGE_MISSING", seed.commitmentId, "COVERED_ABSENCE", seed.sourceId]),
      /citation_check/,
    );
    await insert(", cited_evidence_ids", ", array[$6::uuid]", [seed.workspaceId, "k3", "PRICE_INCREASE", seed.commitmentId, "EVIDENCE", seed.evidenceId]);
    await assert.rejects(
      insert(", cited_evidence_ids", ", array[$6::uuid]", [seed.workspaceId, "k3", "PRICE_INCREASE", seed.commitmentId, "EVIDENCE", seed.evidenceId]),
      /dedupe_key/,
    );
  } finally {
    await eraseWorkspace(seed);
  }
});

test("only a workspace-wide problem may exist without a subscription", { skip }, async () => {
  const seed = await seedGraph();
  try {
    await assert.rejects(
      seed.pool.query(
        `insert into recovery_change_signals (workspace_id, dedupe_key, kind, materiality, confidence, title, detail, citation_kind, cited_evidence_ids)
         values ($1, 'k1', 'PRICE_INCREASE', 'HIGH', 100, 'Netflix costs more', 'Higher.', 'EVIDENCE', array[$2::uuid])`,
        [seed.workspaceId, seed.evidenceId],
      ),
      /scope_check/,
    );
    await seed.pool.query(
      `insert into recovery_change_signals (workspace_id, dedupe_key, kind, materiality, confidence, title, detail, citation_kind, cited_source_ids)
       values ($1, 'k2', 'COVERAGE_BROKEN', 'CRITICAL', 100, 'A source stopped working', 'Reconnect it.', 'SOURCE_HEALTH', array[$2::uuid])`,
      [seed.workspaceId, seed.sourceId],
    );
  } finally {
    await eraseWorkspace(seed);
  }
});

test("no notification may be recorded as delivered without provider proof", { skip }, async () => {
  const seed = await seedGraph();
  try {
    const signalId = randomUUID();
    await seed.pool.query(
      `insert into recovery_change_signals (id, workspace_id, dedupe_key, kind, commitment_id, materiality, confidence, title, detail, citation_kind, cited_evidence_ids)
       values ($1, $2, 'k1', 'PRICE_INCREASE', $3, 'HIGH', 100, 'Netflix costs more', 'Higher.', 'EVIDENCE', array[$4::uuid])`,
      [signalId, seed.workspaceId, seed.commitmentId, seed.evidenceId],
    );
    const insertNotification = (columns: string, values: string, params: unknown[]) => seed.pool.query(
      `insert into recovery_change_notifications (workspace_id, change_signal_id, channel, delivery_state${columns})
       values ($1, $2, 'EMAIL', $3${values})`,
      params,
    );
    // Provider acceptance alone is not delivery: without a message id and a
    // delivery timestamp the row cannot exist, so nothing can claim an inbox.
    await assert.rejects(
      insertNotification(", provider_accepted_at", ", now()", [seed.workspaceId, signalId, "DELIVERED"]),
      /delivery_proof_check/,
    );
    await assert.rejects(
      insertNotification(", provider_message_id, provider_accepted_at", ", 'msg-1', now()", [seed.workspaceId, signalId, "DELIVERED"]),
      /delivery_proof_check/,
    );
    await assert.rejects(
      insertNotification("", "", [seed.workspaceId, signalId, "DELIVERED"]),
      /delivery_proof_check|accepted_check/,
    );
    await insertNotification(
      ", provider_message_id, provider_accepted_at, delivered_at",
      ", 'msg-1', now(), now()",
      [seed.workspaceId, signalId, "DELIVERED"],
    );
  } finally {
    await eraseWorkspace(seed);
  }
});

test("suppression and retry states must carry the fact that explains them", { skip }, async () => {
  const seed = await seedGraph();
  try {
    const signalId = randomUUID();
    await seed.pool.query(
      `insert into recovery_change_signals (id, workspace_id, dedupe_key, kind, commitment_id, materiality, confidence, title, detail, citation_kind, cited_evidence_ids)
       values ($1, $2, 'k1', 'PRICE_INCREASE', $3, 'HIGH', 100, 'Netflix costs more', 'Higher.', 'EVIDENCE', array[$4::uuid])`,
      [signalId, seed.workspaceId, seed.commitmentId, seed.evidenceId],
    );
    await assert.rejects(
      seed.pool.query(
        `insert into recovery_change_notifications (workspace_id, change_signal_id, channel, delivery_state)
         values ($1, $2, 'EMAIL', 'SUPPRESSED')`,
        [seed.workspaceId, signalId],
      ),
      /suppression_check/,
    );
    await assert.rejects(
      seed.pool.query(
        `insert into recovery_change_notifications (workspace_id, change_signal_id, channel, delivery_state)
         values ($1, $2, 'EMAIL', 'RETRY_SCHEDULED')`,
        [seed.workspaceId, signalId],
      ),
      /retry_check/,
    );
    await seed.pool.query(
      `insert into recovery_change_notifications (workspace_id, change_signal_id, channel, delivery_state, suppression_reason)
       values ($1, $2, 'EMAIL', 'SUPPRESSED', 'CHANNEL_NOT_READY')`,
      [seed.workspaceId, signalId],
    );
    await assert.rejects(
      seed.pool.query(
        `insert into recovery_change_notifications (workspace_id, change_signal_id, channel, delivery_state, suppression_reason)
         values ($1, $2, 'EMAIL', 'SUPPRESSED', 'CHANNEL_NOT_READY')`,
        [seed.workspaceId, signalId],
      ),
      /duplicate key value violates unique constraint "recovery_change_notifications_workspace_id_change_signal_id/,
    );
  } finally {
    await eraseWorkspace(seed);
  }
});

test("the learning dataset refuses anything that is not a structural feature", { skip }, async () => {
  const seed = await seedGraph();
  try {
    const insert = (features: unknown, key: string) => seed.pool.query(
      `insert into recovery_correction_outcomes (workspace_id, kind, label, feature_version, features, commitment_id, idempotency_key, cited_evidence_ids)
       values ($1, 'DUPLICATE_MERGE_REJECTED', 'REJECTED', 'correction-features-1', $2::jsonb, $3, $4, array[$5::uuid])`,
      [seed.workspaceId, JSON.stringify(features), seed.commitmentId, key, seed.evidenceId],
    );
    await assert.rejects(insert({ merchant: "Netflix India Services" }, "a"), /features_check|structural/);
    await assert.rejects(insert({ contact: "billing@netflix.com" }, "b"), /features_check|structural/);
    await assert.rejects(insert({ nested: { score: 1 } }, "c"), /features_check|structural/);
    await insert({ matchScoreBucket: "60_79", signalCount: 1, onlyFuzzySignal: true, currency: "INR" }, "d");
    await assert.rejects(
      seed.pool.query(
        `update recovery_correction_outcomes set label = 'ACCEPTED' where workspace_id = $1`,
        [seed.workspaceId],
      ),
      /append-only/,
    );
  } finally {
    await eraseWorkspace(seed);
  }
});

test("erasing a workspace removes every commitment graph row", { skip }, async () => {
  const seed = await seedGraph();
  const merchantId = await createMerchant(seed, "INR");
  const signalId = randomUUID();
  await seed.pool.query(
    `insert into recovery_merchant_signals (workspace_id, merchant_id, evidence_id, signal_kind, signal_key)
     values ($1, $2, $3, 'BILLING_DOMAIN', 'netflix.com')`,
    [seed.workspaceId, merchantId, seed.evidenceId],
  );
  await seed.pool.query(
    `insert into recovery_merchant_links (workspace_id, commitment_id, merchant_id, decision, score, strongest_signal_kind, cited_evidence_ids)
     values ($1, $2, $3, 'AUTO_MERGE', 100, 'BILLING_DOMAIN', array[$4::uuid])`,
    [seed.workspaceId, seed.commitmentId, merchantId, seed.evidenceId],
  );
  await seed.pool.query(
    `insert into recovery_merchant_merge_rejections (workspace_id, commitment_id, merchant_id, rejected_by_user_id)
     values ($1, $2, $3, $4)`,
    [seed.workspaceId, seed.commitmentId, merchantId, seed.ownerUserId],
  );
  await seed.pool.query(
    `insert into recovery_commitment_states (
       workspace_id, commitment_id, lifecycle_state, coverage_state, conflict_state, prediction_state, belief, evaluated_on
     ) values ($1, $2, 'AT_RISK', 'CURRENT', 'NONE', 'WITHHELD_INSUFFICIENT_EVIDENCE', 'Nothing arrived.', '2026-08-17')`,
    [seed.workspaceId, seed.commitmentId],
  );
  await seed.pool.query(
    `insert into recovery_cancellation_events (workspace_id, commitment_id, idempotency_key, event_kind, from_state, to_state, proof)
     values ($1, $2, 'k1', 'INTENT_RECORDED', 'NONE', 'CANCELLATION_INTENT_RECORDED', 'NONE')`,
    [seed.workspaceId, seed.commitmentId],
  );
  await seed.pool.query(
    `insert into recovery_source_health (workspace_id, source_id, liveness_state, automatic)
     values ($1, $2, 'CURRENT', true)`,
    [seed.workspaceId, seed.sourceId],
  );
  await seed.pool.query(
    `insert into recovery_change_signals (id, workspace_id, dedupe_key, kind, commitment_id, materiality, confidence, title, detail, citation_kind, cited_evidence_ids)
     values ($1, $2, 'k1', 'PRICE_INCREASE', $3, 'HIGH', 100, 'Netflix costs more', 'Higher.', 'EVIDENCE', array[$4::uuid])`,
    [signalId, seed.workspaceId, seed.commitmentId, seed.evidenceId],
  );
  await seed.pool.query(
    `insert into recovery_change_notifications (workspace_id, change_signal_id, channel, delivery_state, suppression_reason)
     values ($1, $2, 'EMAIL', 'SUPPRESSED', 'CHANNEL_NOT_READY')`,
    [seed.workspaceId, signalId],
  );
  await seed.pool.query(
    `insert into recovery_notification_preferences (workspace_id, user_id, product_emails) values ($1, $2, true)`,
    [seed.workspaceId, seed.ownerUserId],
  );
  await seed.pool.query(
    `insert into recovery_correction_outcomes (workspace_id, kind, label, feature_version, features, commitment_id, idempotency_key)
     values ($1, 'CADENCE_CORRECTED', 'CHANGED', 'correction-features-1', '{"cadence":"MONTHLY"}'::jsonb, $2, 'k1')`,
    [seed.workspaceId, seed.commitmentId],
  );

  await eraseWorkspace(seed);

  for (const table of [
    "recovery_merchants",
    "recovery_merchant_signals",
    "recovery_merchant_links",
    "recovery_merchant_merge_rejections",
    "recovery_commitment_states",
    "recovery_cancellation_events",
    "recovery_source_health",
    "recovery_change_signals",
    "recovery_change_notifications",
    "recovery_notification_preferences",
    "recovery_correction_outcomes",
  ]) {
    const remaining = await seed.pool.query<{ total: string }>(
      `select count(*)::text as total from ${table} where workspace_id = $1`,
      [seed.workspaceId],
    );
    assert.equal(remaining.rows[0]?.total, "0", `${table} did not cascade`);
  }
});
