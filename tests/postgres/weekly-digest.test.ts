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
      `insert into recurring_items (
         workspace_id, merchant, normalized_merchant, category, frequency,
         currency, amount_min, amount_max, average_amount, monthly_cost,
         annual_cost, next_expected_date, confidence_score
       ) values
         ($1, 'Primary Plan', 'primary plan', 'Productivity', 'monthly', 'INR', 1000, 1000, 1000, 1000, 12000, current_date + 1, 90),
         ($1, 'Foreign Plan', 'foreign plan', 'Cloud hosting', 'monthly', 'USD', 20, 20, 20, 20, 240, current_date + 2, 90)`,
      [workspaceId],
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
    assert.equal(claims[0]?.monthlyBurn, 1000);
    assert.equal(claims[0]?.foreignMonthlyTotals.USD, 20);
    assert.equal(claims[0]?.renewalCountNext7Days, 2);
    assert.equal(claims[0]?.renewalTotalNext7Days, 1000);
    assert.deepEqual(claims[0]?.suggestion, { merchant: "Primary Plan", monthlyCost: 1000 });
    assert.equal(await isWeeklyDigestStillDeliverable(claims[0]!.deliveryId, workerId), true);
    await markWeeklyDigestSent(claims[0]!.deliveryId, workerId);
    assert.equal((await claimDueWeeklyDigests({ limit: 5, workerId, invocation: "internal-api" })).length, 0);
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from consent_grants where user_id = $1`, [userId]);
    await pool.query(`delete from users where id = $1`, [userId]);
  }
});
