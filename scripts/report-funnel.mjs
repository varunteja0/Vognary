import pg from "pg";
import { queryAutopilotFunnel } from "./lib/autopilot-funnel.mjs";

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
      activatedWorkspaces: await count(
        client,
        "select count(distinct workspace_id)::text as n from product_events where event_name = 'workspace.activated' and workspace_id is not null",
      ),
      commitments: await count(client, "select count(*)::text as n from recovery_commitments"),
      decisions: await count(client, "select count(*)::text as n from recovery_decisions"),
    };

    const connectedFunnel = await queryAutopilotFunnel(client);
    const autopilot = {
      sourcesConnected: await count(client, "select count(*)::text as n from product_events where event_name = 'source.connected'"),
      mandatesSigned: await count(client, "select count(*)::text as n from product_events where event_name = 'mandate.signed'"),
      mandatesRevoked: await count(client, "select count(*)::text as n from product_events where event_name = 'mandate.revoked'"),
      candidatesEvaluated: await count(client, "select count(*)::text as n from product_events where event_name = 'candidate.evaluated'"),
      noticesQueued: await count(client, "select count(*)::text as n from product_events where event_name = 'notice.queued'"),
      noticesDelivered: await count(client, "select count(*)::text as n from product_events where event_name = 'notice.delivered'"),
      noticesFailed: await count(client, "select count(*)::text as n from product_events where event_name = 'notice.failed'"),
      vetoes: await count(client, "select count(*)::text as n from product_events where event_name = 'candidate.vetoed'"),
      authorized: await count(client, "select count(*)::text as n from product_events where event_name = 'candidate.authorized'"),
      executionStarted: await count(client, "select count(*)::text as n from product_events where event_name = 'execution.started'"),
      executionCompleted: await count(client, "select count(*)::text as n from product_events where event_name = 'execution.completed'"),
      executionFailed: await count(client, "select count(*)::text as n from product_events where event_name = 'execution.failed'"),
      exceptions: await count(client, "select count(*)::text as n from product_events where event_name = 'exception.opened'"),
      verificationPending: await count(client, "select count(*)::text as n from product_events where event_name = 'verification.pending'"),
      windowsVerified: await count(client, "select count(*)::text as n from product_events where event_name = 'window.verified'"),
      invoicesCreated: await count(client, "select count(*)::text as n from product_events where event_name = 'invoice.created'"),
      paymentsSettled: await count(client, "select count(*)::text as n from product_events where event_name = 'billing.payment_settled'"),
      paymentsRefunded: await count(client, "select count(*)::text as n from product_events where event_name = 'billing.payment_refunded'"),
      activeMandates: connectedFunnel.connectedActiveMandates,
      eligibleCandidates: connectedFunnel.currentlyEligibleAccounts,
      verifiedWindows: await count(client, "select count(*)::text as n from recovery_covered_windows where status = 'COVERED_CLEAN'"),
      d30ConnectedRetention: connectedFunnel.d30ConnectedRetention,
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
         where event_name in ('ledger.viewed', 'source.connected', 'mandate.signed', 'candidate.evaluated') and user_id is not null
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
           and e.event_name in ('ledger.viewed', 'source.connected', 'mandate.signed', 'candidate.evaluated')
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
      autopilot,
      returnVisits: {
        dailyActiveUsers,
        usersWithTwoOrMoreActiveDays: returningUsers,
        d7: await cohortReturn(7),
        d30: connectedFunnel.d30ConnectedRetention,
      },
      leads: {
        privateAudit: await count(client, "select count(*)::text as n from private_audit_leads"),
        waitlist: await count(client, "select count(*)::text as n from waitlist_leads"),
      },
    };

    console.log(JSON.stringify(report, null, 2));
    console.log("");
    console.log(`Signups: ${signups.total} total (${signups.last7Days} in 7d, ${signups.last30Days} in 30d)`);
    console.log(`Workspaces with saved evidence: ${activation.workspacesWithEvidence}`);
    console.log(`Activated workspaces (cited recurring picture): ${activation.activatedWorkspaces}`);
    console.log(`Users returning on 2+ days: ${returningUsers}`);
    const d30 = report.returnVisits.d30;
    console.log(
      d30.status === "unmeasured"
        ? "D30 connected retention: unmeasured (durable cohort facts are not available)"
        : d30.rate === null || d30.eligibleWorkspaces === 0
          ? "D30 connected retention: not measurable yet (no connected mandate is 30 days old)"
          : `D30 connected retention: ${(d30.rate * 100).toFixed(1)}% of ${d30.eligibleWorkspaces} connected workspaces`,
    );
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
