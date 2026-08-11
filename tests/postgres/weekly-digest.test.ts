import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  claimDueWeeklyDigests,
  isWeeklyDigestStillDeliverable,
  markWeeklyDigestSent,
  updateRenewalAlertPreference,
} from "../../src/lib/server/renewal-alert-store";
import { getDatabasePool } from "../../src/lib/server/database";

const databaseConfigured = Boolean(process.env.DATABASE_URL);

test("weekly digest claims one privacy-safe aggregate per week and remains consent gated", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const email = `${userId}@weekly-digest.test`;
  const workerId = `digest-test-${randomUUID()}`;
  const keptCommitmentId = randomUUID();
  const reviewCommitmentId = randomUUID();
  const foreignCommitmentId = randomUUID();
  const lowConfidenceCommitmentId = randomUUID();

  try {
    await pool.query(`insert into users (id, email) values ($1, $2)`, [userId, email]);
    await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Weekly digest test')`, [workspaceId, userId]);
    await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, userId]);
    await updateRenewalAlertPreference({
      workspaceId,
      userId,
      email,
      preference: {
        enabled: false,
        weeklyDigestEnabled: true,
        sevenDayEnabled: true,
        oneDayEnabled: true,
        timeZone: "UTC",
        sendHourLocal: 9,
      },
    });
    await pool.query(
      `insert into recovery_commitments (
         id, workspace_id, identity_key, base_status, base_merchant, base_category,
         base_cadence, base_currency, base_amount_minor, base_monthly_minor,
         base_next_expected_date, effective_status, effective_merchant, effective_cadence,
         effective_amount_minor, effective_monthly_minor, effective_next_expected_date,
         confidence_score, recommended_decision, recommendation_reason
       ) values
         ($2, $1, 'primary-plan', 'ACTIVE', 'Primary Plan', 'Productivity', 'MONTHLY', 'INR', 100000, 100000,
          current_date + 1, 'ACTIVE', 'Primary Plan', 'MONTHLY', 100000, 100000, current_date + 1, 90, 'MONITOR', 'Review the commitment.'),
         ($3, $1, 'review-plan', 'ACTIVE', 'Review Plan', 'Productivity', 'MONTHLY', 'INR', 50000, 50000,
          current_date + 2, 'ACTIVE', 'Review Plan', 'MONTHLY', 50000, 50000, current_date + 2, 90, 'MONITOR', 'Review the commitment.'),
         ($4, $1, 'foreign-plan', 'ACTIVE', 'Foreign Plan', 'Cloud hosting', 'MONTHLY', 'USD', 2000, 2000,
          current_date + 2, 'ACTIVE', 'Foreign Plan', 'MONTHLY', 2000, 2000, current_date + 2, 90, 'MONITOR', 'Review the commitment.'),
         ($5, $1, 'low-confidence-plan', 'ACTIVE', 'Low Confidence Plan', 'Productivity', 'MONTHLY', 'INR', 25000, 25000,
          current_date + 3, 'ACTIVE', 'Low Confidence Plan', 'MONTHLY', 25000, 25000, current_date + 3, 60, 'INVESTIGATE', 'Needs more proof.')`,
      [workspaceId, keptCommitmentId, reviewCommitmentId, foreignCommitmentId, lowConfidenceCommitmentId],
    );
    await pool.query(
      `insert into recovery_decisions (workspace_id, commitment_id, decided_by_user_id, decision)
       values ($1, $2, $3, 'KEEP')`,
      [workspaceId, keptCommitmentId, userId],
    );
    await pool.query(
      `insert into weekly_digest_deliveries (
         workspace_id, user_id, preference_id, consent_grant_id,
         week_start, scheduled_for, next_attempt_at
       )
       select workspace_id, user_id, id, consent_grant_id,
              current_date, now() - interval '1 minute', now() - interval '1 minute'
       from renewal_alert_preferences
       where workspace_id = $1 and user_id = $2`,
      [workspaceId, userId],
    );

    const claims = await claimDueWeeklyDigests({ limit: 5, workerId, invocation: "internal-api" });
    assert.equal(claims.length, 1);
    assert.equal(claims[0]?.email, email);
    assert.deepEqual(claims[0]?.monthlyTotals.map((total) => [total.currency, total.minor]), [["INR", "175000"], ["USD", "2000"]]);
    assert.equal(claims[0]?.renewalCountNext7Days, 4);
    assert.deepEqual(claims[0]?.renewalTotalsNext7Days.map((total) => [total.currency, total.minor]), [["INR", "175000"], ["USD", "2000"]]);
    assert.deepEqual(claims[0]?.suggestion && {
      merchant: claims[0].suggestion.merchant,
      currency: claims[0].suggestion.monthlyCost.currency,
      minor: claims[0].suggestion.monthlyCost.minor,
    }, { merchant: "Review Plan", currency: "INR", minor: "50000" });
    assert.equal(await isWeeklyDigestStillDeliverable(claims[0]!.deliveryId, workerId), true);
    await markWeeklyDigestSent(claims[0]!.deliveryId, workerId);
    assert.equal((await claimDueWeeklyDigests({ limit: 5, workerId, invocation: "internal-api" })).length, 0);
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from consent_grants where user_id = $1`, [userId]);
    await pool.query(`delete from users where id = $1`, [userId]);
  }
});
