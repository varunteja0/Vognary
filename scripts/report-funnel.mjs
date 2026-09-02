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
      workspacesWithSubmittedEvidence: await count(
        client,
        `select count(distinct source.workspace_id)::text as n
         from recovery_sources source
         join recovery_evidence evidence
           on evidence.workspace_id = source.workspace_id and evidence.source_id = source.id
         where source.source_type in ('RECEIPT_PASTE', 'CSV_IMPORT')`,
      ),
      recurringPictureWorkspaces: await count(
        client,
        "select count(distinct workspace_id)::text as n from product_events where event_name = 'workspace.activated'",
      ),
      commitments: await count(client, "select count(*)::text as n from recovery_commitments"),
      decisionRecords: await count(client, "select count(*)::text as n from recovery_decisions"),
      decisionCycles: await count(client, "select count(*)::text as n from recovery_decision_cycles"),
    };

    const controlSchemaInstalled = Boolean((await client.query(
      `select
         to_regclass('public.commitment_control_policies') is not null
         and to_regclass('public.commitment_control_proposals') is not null
         and to_regclass('public.commitment_control_evaluations') is not null
         and to_regclass('public.commitment_control_decisions') is not null
         and to_regclass('public.commitment_control_reconciliations') is not null
         as installed`,
    )).rows[0]?.installed);
    const commitmentControl = controlSchemaInstalled
      ? controlMetricsFromRow((await client.query(
        `select
           (select count(distinct workspace_id)::text from commitment_control_policies) as policy_workspaces,
           (select count(distinct workspace_id)::text from commitment_control_proposals) as proposal_workspaces,
           (select count(*)::text from commitment_control_proposals) as proposals_submitted,
           (select count(*)::text from commitment_control_proposals where created_at >= now() - interval '7 days') as proposals_last_7_days,
           (select count(*)::text from commitment_control_proposals where created_at >= now() - interval '30 days') as proposals_last_30_days,
           (select count(*)::text from commitment_control_evaluations) as evaluations_completed,
           (select count(*)::text from commitment_control_evaluations where status = 'WITHIN_POLICY') as within_policy,
           (select count(*)::text from commitment_control_evaluations where status = 'REVIEW_REQUIRED') as review_required,
           (select count(*)::text from commitment_control_evaluations where status = 'OUTSIDE_POLICY') as outside_policy,
           (select count(distinct workspace_id)::text from commitment_control_decisions) as decision_workspaces,
           (select count(*)::text from commitment_control_decisions) as human_decisions,
           (select count(*)::text from commitment_control_decisions where action = 'APPROVE') as approved,
           (select count(*)::text from commitment_control_decisions where action = 'APPROVE_WITH_CAP') as approved_with_cap,
           (select count(*)::text from commitment_control_decisions where action = 'DECLINE') as declined,
           (select count(*)::text from commitment_control_decisions where action in ('APPROVE_WITH_CAP', 'DECLINE')) as capped_or_declined,
           (select count(distinct workspace_id)::text from commitment_control_reconciliations) as reconciliation_workspaces,
           (select count(*)::text from commitment_control_reconciliations) as reconciliations,
           (select count(*)::text from commitment_control_reconciliations where verdict = 'MATCHED') as matched,
           (select count(*)::text from commitment_control_reconciliations where verdict = 'WITHIN_CAP') as within_cap,
           (select count(*)::text from commitment_control_reconciliations where verdict = 'OVER_CAP') as over_cap,
           (select count(*)::text from commitment_control_reconciliations where verdict = 'CURRENCY_MISMATCH') as currency_mismatch,
           (select count(*)::text from commitment_control_reconciliations where verdict = 'CANNOT_EVALUATE') as cannot_evaluate`,
      )).rows[0] ?? {})
      : unavailableControlMetrics();

    const first10Row = (await client.query(
      `select
         (select count(distinct workspace_id)::text from recovery_inbound_aliases) as setup_started,
         (select count(distinct workspace_id)::text from recovery_inbound_aliases where setup_completed_at is not null) as setup_completed,
         (select count(distinct workspace_id)::text from recovery_inbound_aliases where forwarding_verified_at is not null) as forwarding_verified,
         (select count(distinct workspace_id)::text from recovery_inbound_aliases where backfill_completed_at is not null) as backfill_completed,
         (select count(distinct workspace_id)::text from recovery_commitments) as commitments_detected,
         (select count(*)::text from recovery_corrections) as user_correction_count,
         (select count(distinct cycle.workspace_id)::text
          from recovery_decision_cycles cycle
          where exists (
            select 1
            from recovery_commitment_evidence link
            join recovery_evidence evidence
              on evidence.workspace_id = link.workspace_id and evidence.id = link.evidence_id
            join recovery_sources source
              on source.workspace_id = evidence.workspace_id and source.id = evidence.source_id
            where link.workspace_id = cycle.workspace_id
              and link.commitment_id = cycle.commitment_id
              and source.source_type in ('RECEIPT_PASTE', 'CSV_IMPORT')
          )) as first_value_workspaces,
         (select count(distinct cycle.id)::text
          from recovery_decision_cycles cycle
          where exists (
            select 1
            from recovery_commitment_evidence link
            join recovery_evidence evidence
              on evidence.workspace_id = link.workspace_id and evidence.id = link.evidence_id
            join recovery_sources source
              on source.workspace_id = evidence.workspace_id and source.id = evidence.source_id
            where link.workspace_id = cycle.workspace_id
              and link.commitment_id = cycle.commitment_id
              and source.source_type in ('RECEIPT_PASTE', 'CSV_IMPORT')
          )) as decisions_on_submitted_evidence,
         (select count(distinct workspace_id)::text
          from product_events where event_name = 'workspace.activated') as recurring_picture_workspaces,
         (select count(*)::text
          from recovery_decision_cycles
          where user_action in ('KEEP', 'PLAN_TO_CANCEL')
            and verification_outcome is null) as decision_cycles_awaiting_outcome,
         (select count(*)::text
          from recovery_decision_cycles
          where user_action = 'KEEP'
            and verification_outcome = 'CHARGE_ARRIVED') as continued_as_planned,
         (select count(*)::text
          from recovery_decision_cycles
          where user_action = 'PLAN_TO_CANCEL'
            and verification_outcome = 'CHARGE_ARRIVED') as charge_after_cancel_plan,
         (select count(*)::text
          from recovery_decision_cycles
          where user_action = 'PLAN_TO_CANCEL'
            and verification_outcome = 'NO_CHARGE_IN_WINDOW') as no_charge_in_window,
         (select count(*)::text
          from recovery_decision_cycles
          where user_action in ('KEEP', 'PLAN_TO_CANCEL')
            and verification_outcome = 'CANNOT_EVALUATE') as cannot_evaluate,
         (select count(distinct workspace_id)::text
          from recovery_inbound_events where status = 'PROCESSED') as processed_inbound_workspaces,
         (select count(*)::text from (
            select workspace_id
            from recovery_inbound_events
            where status = 'PROCESSED'
            group by workspace_id
            having count(*) >= 2
          ) repeated_inbound) as workspaces_with_two_processed_inbound_events,
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
            (select count(*)::text from product_events where event_name = 'workspace.returned') as consented_return_events,
            (select count(*)::text from product_events where event_name = 'billing.checkout_started') as historical_checkout_attempts,
            (select count(*)::text from product_events where event_name = 'billing.payment_settled') as historical_payments_settled`,
         [receiptAliasHmacKeyId],
          )).rows[0] ?? {};
    const first10Experiment = {
      setupStarted: Number(first10Row.setup_started ?? 0),
      setupCompleted: Number(first10Row.setup_completed ?? 0),
      forwardingVerified: Number(first10Row.forwarding_verified ?? 0),
      backfillCompleted: Number(first10Row.backfill_completed ?? 0),
      firstValueWorkspaces: Number(first10Row.first_value_workspaces ?? 0),
      decisionsOnSubmittedEvidence: Number(first10Row.decisions_on_submitted_evidence ?? 0),
      recurringPictureWorkspaces: Number(first10Row.recurring_picture_workspaces ?? 0),
      decisionCyclesAwaitingOutcome: Number(first10Row.decision_cycles_awaiting_outcome ?? 0),
      continuedAsPlanned: Number(first10Row.continued_as_planned ?? 0),
      chargeAfterCancelPlan: Number(first10Row.charge_after_cancel_plan ?? 0),
      noChargeInWindow: Number(first10Row.no_charge_in_window ?? 0),
      cannotEvaluate: Number(first10Row.cannot_evaluate ?? 0),
      processedInboundWorkspaces: Number(first10Row.processed_inbound_workspaces ?? 0),
      workspacesWithTwoProcessedInboundEvents: Number(first10Row.workspaces_with_two_processed_inbound_events ?? 0),
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
      sourceHealthMeasurement: receiptAliasHmacKeyId ? "measured" : "unavailable-key-id-not-configured",
      consentedReturnEvents: Number(first10Row.consented_return_events ?? 0),
      historicalCheckoutAttempts: Number(first10Row.historical_checkout_attempts ?? 0),
      historicalPaymentsSettled: Number(first10Row.historical_payments_settled ?? 0),
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
      commitmentControl,
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
    console.log(`Account rows: ${signups.total} total (${signups.last7Days} in 7d, ${signups.last30Days} in 30d)`);
    console.log("Account rows do not prove real users, contact consent, or customer validation.");
    console.log(`Workspaces with submitted evidence: ${activation.workspacesWithSubmittedEvidence}`);
    console.log(`Commitment Control schema: ${commitmentControl.controlSchemaState}`);
    if (commitmentControl.controlSchemaState === "available") {
      console.log(`Commitment Control proposals: ${commitmentControl.proposalsSubmitted} across ${commitmentControl.proposalWorkspaces} workspaces (${commitmentControl.proposalsLast7Days} in 7d, ${commitmentControl.proposalsLast30Days} in 30d)`);
      console.log(`Policy evaluations: ${commitmentControl.evaluationsCompleted} total; ${commitmentControl.withinPolicy} within policy; ${commitmentControl.reviewRequired} review required; ${commitmentControl.outsidePolicy} outside policy`);
      console.log(`Human decisions: ${commitmentControl.humanDecisions} total; ${commitmentControl.approved} approved; ${commitmentControl.approvedWithCap} capped; ${commitmentControl.declined} declined; ${commitmentControl.cappedOrDeclined} capped or declined`);
      console.log(`Control reconciliations: ${commitmentControl.reconciliations} total; ${commitmentControl.matched} matched; ${commitmentControl.withinCap} within cap; ${commitmentControl.overCap} over cap; ${commitmentControl.currencyMismatch} currency mismatch; ${commitmentControl.cannotEvaluate} cannot evaluate`);
    } else {
      console.log("Commitment Control funnel: unavailable (schema not applied in this database)");
    }
    console.log("Commitment Control product rows do not prove pre-spend status, offers, payments, or customer validation; reconcile those only from founder-confirmed CRM evidence.");
    console.log(`First value (submitted evidence → decision): ${first10Experiment.firstValueWorkspaces} workspaces; ${first10Experiment.decisionsOnSubmittedEvidence} decisions`);
    console.log(`Strict recurring picture: ${first10Experiment.recurringPictureWorkspaces} workspaces`);
    console.log(`Longitudinal outcomes: ${first10Experiment.decisionCyclesAwaitingOutcome} awaiting; ${first10Experiment.continuedAsPlanned} continued as planned; ${first10Experiment.chargeAfterCancelPlan} charged after cancel plan; ${first10Experiment.noChargeInWindow} no charge in window; ${first10Experiment.cannotEvaluate} cannot evaluate`);
    console.log(`Receipt setup: ${first10Experiment.setupCompleted}/${first10Experiment.setupStarted} completed`);
    console.log(`Forwarding verified: ${first10Experiment.forwardingVerified}; backfills completed: ${first10Experiment.backfillCompleted}`);
    console.log(`Processed inbound workspaces: ${first10Experiment.processedInboundWorkspaces}; two-or-more processed: ${first10Experiment.workspacesWithTwoProcessedInboundEvents}`);
    console.log("Processed inbound events cannot prove untouched automatic forwarding; retain operator evidence for that milestone.");
    console.log(`Source health measurement: ${first10Experiment.sourceHealthMeasurement}; healthy forwarding sources: ${first10Experiment.sourcesRemainingHealthy}`);
    console.log(`Historical retired checkout — attempts: ${first10Experiment.historicalCheckoutAttempts}; settled: ${first10Experiment.historicalPaymentsSettled}. These are not current-offer payments.`);
    console.log(`Consented return events: ${first10Experiment.consentedReturnEvents}`);
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

function controlMetricsFromRow(row) {
  const proposalsSubmitted = Number(row.proposals_submitted ?? 0);
  const humanDecisions = Number(row.human_decisions ?? 0);
  const reconciliations = Number(row.reconciliations ?? 0);
  return {
    controlSchemaState: "available",
    policyWorkspaces: Number(row.policy_workspaces ?? 0),
    proposalWorkspaces: Number(row.proposal_workspaces ?? 0),
    proposalsSubmitted,
    proposalsLast7Days: Number(row.proposals_last_7_days ?? 0),
    proposalsLast30Days: Number(row.proposals_last_30_days ?? 0),
    evaluationsCompleted: Number(row.evaluations_completed ?? 0),
    withinPolicy: Number(row.within_policy ?? 0),
    reviewRequired: Number(row.review_required ?? 0),
    outsidePolicy: Number(row.outside_policy ?? 0),
    decisionWorkspaces: Number(row.decision_workspaces ?? 0),
    humanDecisions,
    approved: Number(row.approved ?? 0),
    approvedWithCap: Number(row.approved_with_cap ?? 0),
    declined: Number(row.declined ?? 0),
    cappedOrDeclined: Number(row.capped_or_declined ?? 0),
    reconciliationWorkspaces: Number(row.reconciliation_workspaces ?? 0),
    reconciliations,
    matched: Number(row.matched ?? 0),
    withinCap: Number(row.within_cap ?? 0),
    overCap: Number(row.over_cap ?? 0),
    currencyMismatch: Number(row.currency_mismatch ?? 0),
    cannotEvaluate: Number(row.cannot_evaluate ?? 0),
    proposalToDecisionRate: proposalsSubmitted ? Number((humanDecisions / proposalsSubmitted).toFixed(3)) : null,
    decisionToReconciliationRate: humanDecisions ? Number((reconciliations / humanDecisions).toFixed(3)) : null,
  };
}

function unavailableControlMetrics() {
  const unavailableMetrics = [
    "policyWorkspaces",
    "proposalWorkspaces",
    "proposalsSubmitted",
    "proposalsLast7Days",
    "proposalsLast30Days",
    "evaluationsCompleted",
    "withinPolicy",
    "reviewRequired",
    "outsidePolicy",
    "decisionWorkspaces",
    "humanDecisions",
    "approved",
    "approvedWithCap",
    "declined",
    "cappedOrDeclined",
    "reconciliationWorkspaces",
    "reconciliations",
    "matched",
    "withinCap",
    "overCap",
    "currencyMismatch",
    "cannotEvaluate",
    "proposalToDecisionRate",
    "decisionToReconciliationRate",
  ];
  return {
    controlSchemaState: "unavailable-schema-not-applied",
    ...Object.fromEntries(unavailableMetrics.map((metric) => [metric, null])),
  };
}
