import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;

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
