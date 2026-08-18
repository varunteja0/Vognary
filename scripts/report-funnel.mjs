import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
const receiptAliasHmacKeyId = process.env.RECEIPT_INBOX_ALIAS_HMAC_KEY_ID?.trim() || null;

if (!databaseUrl) {
  console.error("DATABASE_URL is required to report the Vognary funnel.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.POSTGRES_SSL === "true" ? {
    ca: process.env.POSTGRES_CA_CERT || undefined,
    rejectUnauthorized: process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED !== "false",
  } : undefined,
});

const count = async (client, sql, params = []) => Number((await client.query(sql, params)).rows[0]?.n ?? 0);

try {
  const client = await pool.connect();
  try {
    const signups = {
      total: await count(client, "select count(*)::text as n from users"),
      last7Days: await count(client, "select count(*)::text as n from users where created_at >= now() - interval '7 days'"),
      last30Days: await count(client, "select count(*)::text as n from users where created_at >= now() - interval '30 days'"),
      googleIdentities: await count(client, "select count(*)::text as n from auth_identities"),
    };

    const dailySignups = (await client.query(
      `select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day, count(*)::text as n
       from users
       where created_at >= now() - interval '14 days'
       group by 1 order by 1`,
    )).rows.map((row) => ({ day: row.day, signups: Number(row.n) }));

    const activation = {
      workspacesWithEvidence: await count(
        client,
        "select count(distinct workspace_id)::text as n from recovery_submissions",
      ),
      activationEvents: await count(
        client,
        "select count(*)::text as n from product_events where event_name = 'workspace.activated'",
      ),
      commitments: await count(client, "select count(*)::text as n from recovery_commitments"),
      decisions: await count(client, "select count(*)::text as n from recovery_decisions"),
    };

    const first10Row = (await client.query(
      `select
         (select count(distinct workspace_id)::text from recovery_inbound_aliases) as setup_started,
         (select count(distinct workspace_id)::text from recovery_inbound_aliases where setup_completed_at is not null) as setup_completed,
         (select count(distinct workspace_id)::text from recovery_inbound_aliases where forwarding_verified_at is not null) as forwarding_verified,
         (select count(distinct workspace_id)::text from recovery_inbound_aliases where backfill_completed_at is not null) as backfill_completed,
         (select count(distinct workspace_id)::text from recovery_commitments) as commitments_detected,
         (select count(*)::text from recovery_corrections) as user_correction_count,
         (select count(distinct workspace_id)::text from recovery_inbound_events where status = 'PROCESSED') as first_automatic_receipt,
         (select count(*)::text from (
            select workspace_id
            from recovery_inbound_events
            where status = 'PROCESSED'
            group by workspace_id
            having count(*) >= 2
          ) second_receipt) as second_automatic_receipt,
         (select percentile_cont(0.5) within group (
            order by duration_ms
          )
          from product_events
          where event_name = 'receipt_setup.completed'
            and duration_ms is not null) as median_setup_duration_ms,
         (select percentile_cont(0.5) within group (
            order by (metrics ->> 'secondsToTrustworthyPicture')::double precision
          )
          from product_events
          where event_name = 'workspace.activated'
            and metrics ? 'secondsToTrustworthyPicture') as median_seconds_to_trustworthy_picture,
         (select count(distinct alias.workspace_id)::text
          from recovery_inbound_aliases alias
          where alias.status = 'ACTIVE'
              and $1::text is not null
              and alias.hmac_key_id = $1
            and alias.setup_completed_at is not null
            and exists (
              select 1
              from recovery_inbound_events event
              where event.workspace_id = alias.workspace_id
                and event.alias_id = alias.id
                and event.status = 'PROCESSED'
                and event.processed_at >= now() - interval '45 days'
            )) as sources_remaining_healthy,
         (select count(*)::text from product_events where event_name = 'workspace.returned') as return_visits,
            (select count(*)::text from product_events where event_name = 'billing.checkout_started') as checkout_attempts,
            (select count(*)::text from product_events where event_name = 'billing.payment_settled') as payments_completed`,
         [receiptAliasHmacKeyId],
          )).rows[0] ?? {};
    const first10Experiment = {
      setupStarted: Number(first10Row.setup_started ?? 0),
      setupCompleted: Number(first10Row.setup_completed ?? 0),
      forwardingVerified: Number(first10Row.forwarding_verified ?? 0),
      backfillCompleted: Number(first10Row.backfill_completed ?? 0),
      firstAutomaticReceipt: Number(first10Row.first_automatic_receipt ?? 0),
      secondAutomaticReceipt: Number(first10Row.second_automatic_receipt ?? 0),
      medianSetupDurationMs: first10Row.median_setup_duration_ms === null
        || first10Row.median_setup_duration_ms === undefined
        ? null
        : Number(first10Row.median_setup_duration_ms),
      commitmentsDetected: Number(first10Row.commitments_detected ?? 0),
      userCorrectionCount: Number(first10Row.user_correction_count ?? 0),
      medianSecondsToTrustworthyPicture: first10Row.median_seconds_to_trustworthy_picture === null
        || first10Row.median_seconds_to_trustworthy_picture === undefined
        ? null
        : Number(first10Row.median_seconds_to_trustworthy_picture),
      sourcesRemainingHealthy: Number(first10Row.sources_remaining_healthy ?? 0),
      returnVisits: Number(first10Row.return_visits ?? 0),
      checkoutAttempts: Number(first10Row.checkout_attempts ?? 0),
      paymentsCompleted: Number(first10Row.payments_completed ?? 0),
    };

    const dailyActiveUsers = (await client.query(
      `select to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD') as day,
              count(distinct user_id)::text as n
       from product_events
       where event_name = 'ledger.viewed'
         and user_id is not null
         and occurred_at >= now() - interval '14 days'
       group by 1 order by 1`,
    )).rows.map((row) => ({ day: row.day, activeUsers: Number(row.n) }));

    const returningUsers = await count(
      client,
      `select count(*)::text as n from (
         select user_id from product_events
         where event_name = 'ledger.viewed' and user_id is not null
         group by user_id having count(distinct date_trunc('day', occurred_at)) >= 2
       ) repeat_visitors`,
    );

    // Cohort return: only users old enough for the window can be judged.
    const cohortReturn = async (days) => {
      const eligible = await count(
        client,
        "select count(*)::text as n from users where created_at <= now() - ($1 || ' days')::interval",
        [String(days)],
      );
      const returned = await count(
        client,
        `select count(distinct u.id)::text as n
         from users u
         join product_events e on e.user_id = u.id
         where u.created_at <= now() - ($1 || ' days')::interval
           and e.event_name = 'ledger.viewed'
           and e.occurred_at > u.created_at + interval '1 day'
           and e.occurred_at <= u.created_at + ($1 || ' days')::interval`,
        [String(days)],
      );
      return { eligibleUsers: eligible, returned, rate: eligible ? Number((returned / eligible).toFixed(3)) : null };
    };

    const report = {
      generatedAt: new Date().toISOString(),
      signups,
      dailySignups,
      activation,
      first10Experiment,
      returnVisits: {
        dailyActiveUsers,
        usersWithTwoOrMoreActiveDays: returningUsers,
        d7: await cohortReturn(7),
        d30: await cohortReturn(30),
      },
      leads: {
        privateAudit: await count(client, "select count(*)::text as n from private_audit_leads"),
        waitlist: await count(client, "select count(*)::text as n from waitlist_leads"),
      },
    };

    console.log(JSON.stringify(report, null, 2));
    console.log("");
    console.log(`Signups: ${signups.total} total (${signups.last7Days} in 7d, ${signups.last30Days} in 30d)`);
    console.log(`Activated workspaces (saved evidence): ${activation.workspacesWithEvidence}`);
    console.log(`Receipt setup: ${first10Experiment.setupCompleted}/${first10Experiment.setupStarted} completed`);
    console.log(`Forwarding verified: ${first10Experiment.forwardingVerified}; backfills completed: ${first10Experiment.backfillCompleted}`);
    console.log(`Processed inbound workspaces: ${first10Experiment.firstAutomaticReceipt}; two-or-more processed: ${first10Experiment.secondAutomaticReceipt}`);
    console.log("Inbound processed counts do not distinguish Gmail-filter mail from manual forwards.");
    console.log(`Checkout attempts: ${first10Experiment.checkoutAttempts}; payments settled: ${first10Experiment.paymentsCompleted}`);
    console.log(`Users returning on 2+ days: ${returningUsers}`);
    console.log(
      report.returnVisits.d30.rate === null || report.returnVisits.d30.eligibleUsers === 0
        ? "D30 return: not measurable yet (no user is 30 days old)"
        : `D30 return: ${(report.returnVisits.d30.rate * 100).toFixed(1)}% of ${report.returnVisits.d30.eligibleUsers} eligible users`,
    );
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
