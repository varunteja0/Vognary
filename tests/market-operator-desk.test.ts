import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMarketOperatorDesk,
  formatMarketOperatorDeskSummary,
  mergeMarketSendLog,
} from "../scripts/lib/market-operator-desk.mjs";

test("market desk creates behavior-first drafts and rotates language variants", () => {
  const rows = [
    selectedRow({ id: "P01", test_cell: "DIRECT_FINANCE", contact_channel: "WARM_INTRO" }),
    selectedRow({ id: "P02", test_cell: "FRACTIONAL_FINANCE", contact_channel: "MANUAL_DIRECT" }),
    selectedRow({ id: "P03", test_cell: "FINOPS_AI_OPERATIONS" }),
  ];

  const desk = buildMarketOperatorDesk(rows);
  assert.equal(desk.firstTouches.length, 3);
  assert.equal(desk.summary.firstTouchSendable, 2);
  assert.deepEqual(new Set(desk.firstTouches.map((entry: { messageVariant: string }) => entry.messageVariant)), new Set([
    "AI_SPEND_CHANGE_CONTROL",
    "AI_SPEND_APPROVAL_OUTCOME_RECORD",
    "AI_COST_RECOVERY_NEXT_CYCLE_CONTROL",
  ]));
  for (const draft of desk.firstTouches) {
    assert.match(draft.content, /last real/i);
    assert.match(draft.content, /20 minutes/i);
    assert.match(draft.content, /which upcoming or recent event/i);
    assert.match(draft.content, /INR 14,999 one-time/i);
    assert.match(draft.content, /never moves money/i);
    assert.doesNotMatch(draft.content, /You sign off|Usually in Slack/i);
  }
  assert.match(desk.interviewGuide, /Do not explain Vognary before question 7/i);
  assert.match(desk.interviewGuide, /AI_SPEND_CHANGE_CONTROL/);
  assert.match(desk.interviewGuide, /RECOVERY_FIRST_CONTROL/);
  assert.match(desk.interviewGuide, /AGENT_SPEND_AUTHORIZATION/);

  const summary = formatMarketOperatorDeskSummary(desk.summary);
  assert.match(summary, /first-touch drafts: 3 \(2 with a recorded channel\)/);
  assert.match(summary, /No contact was sent/);
  assert.doesNotMatch(summary, /P01|P02|P03|Private Company/);
});

test("market desk schedules one follow-up after three days and skips replies", () => {
  const desk = buildMarketOperatorDesk([
    selectedRow({
      id: "P10",
      test_cell: "DIRECT_FINANCE",
      contact_channel: "OTHER",
      contacted_at: "2026-09-01T10:00:00+05:30",
    }),
    selectedRow({
      id: "P11",
      test_cell: "DIRECT_FINANCE",
      contact_channel: "OTHER",
      contacted_at: "2026-09-01T10:00:00+05:30",
      replied_at: "2026-09-02T10:00:00+05:30",
    }),
  ]);

  assert.equal(desk.firstTouches.length, 0);
  assert.equal(desk.followUps.length, 1);
  assert.equal(desk.followUps[0].notBefore, "2026-09-04");
  assert.match(desk.followUps[0].content, /Following up once/);
  assert.match(desk.followUps[0].content, /not_before  2026-09-04/);
});

test("regenerating the desk preserves recorded send and reply evidence", () => {
  const existing = [
    "crm_id,cell,channel,sent_at,replied_at,reply_verbatim,outcome",
    'P01,DIRECT_FINANCE,WARM_INTRO,2026-09-03,2026-09-04,"No, timing is wrong",DECLINED',
  ].join("\n");
  const output = mergeMarketSendLog(existing, [{
    id: "P01",
    cell: "DIRECT_FINANCE",
    channel: "MANUAL_DIRECT",
    touchType: "FIRST_TOUCH",
    messageVariant: "AI_SPEND_CHANGE_CONTROL",
    notBefore: "",
  }]);

  assert.match(output, /touch_type,message_variant,not_before/);
  assert.match(output, /P01,DIRECT_FINANCE,WARM_INTRO,FIRST_TOUCH,AI_SPEND_CHANGE_CONTROL,,2026-09-03,2026-09-04,"No, timing is wrong",DECLINED/);
});

test("market desk keeps paid and closed customers out of prospecting drafts", () => {
  const rows = [
    selectedRow({ id: "P21", status: "paid-pilot", payment_received_at: "2026-09-08T09:00:00.000Z" }),
    selectedRow({ id: "P22", status: "active-pilot", payment_received_at: "2026-09-08T09:00:00.000Z", contacted_at: "2026-09-01T09:00:00.000Z" }),
    selectedRow({ id: "P23", status: "closed-lost", loss_reason: "NO_PAIN" }),
    selectedRow({ id: "P24", status: "refunded", contacted_at: "2026-09-01T09:00:00.000Z" }),
    selectedRow({ id: "P25", status: "renewed", renewal_paid_at: "2026-09-08T09:00:00.000Z" }),
  ];
  const before = structuredClone(rows);

  const desk = buildMarketOperatorDesk(rows);

  assert.deepEqual(desk.firstTouches, []);
  assert.deepEqual(desk.followUps, []);
  assert.deepEqual(desk.logEntries, []);
  assert.deepEqual(rows, before);
});

test("market desk routes a recorded payment to human activation review, not automatic access", () => {
  const desk = buildMarketOperatorDesk([
    selectedRow({
      id: "P21",
      status: "paid-pilot",
      payment_received_at: "2026-09-08T09:00:00.000Z",
      payment_amount_inr: "14999",
    }),
  ]);

  assert.equal(desk.customerActions.length, 1);
  assert.equal(desk.customerActions[0].id, "P21");
  assert.equal(desk.customerActions[0].action, "REVIEW_ACTIVATION_GATES");
  assert.equal(desk.customerActions[0].automatic, false);
  assert.match(desk.customerActions[0].instruction, /payment does not activate/i);
  assert.match(desk.customerActions[0].instruction, /independent assessment.*retest/i);
  assert.match(desk.customerActions[0].instruction, /capacity/i);
});

test("market desk follows the customer journey without creating customer evidence", () => {
  const qualifiedConversation = {
    conversation_at: "2026-09-07T09:00:00.000Z",
    repeated_job_status: "YES",
    next_event_committed_at: "2026-09-08T09:00:00.000Z",
    buying_role: "BUYER",
    enforcement_requirement: "ADVISORY_ACCEPTED",
    spend_threshold_confirmed_at: "2026-09-07T09:00:00.000Z",
  };
  const recordedPayment = {
    payment_received_at: "2026-09-08T09:00:00.000Z",
    payment_amount_inr: "14999",
  };
  const cases: Array<{ row: Record<string, string>; action: string }> = [
    { row: { replied_at: "2026-09-07T09:00:00.000Z" }, action: "QUALIFY_RELEVANT_JOB" },
    { row: qualifiedConversation, action: "REVIEW_FIXED_OFFER" },
    { row: { ...qualifiedConversation, repeated_job_status: "NO" }, action: "REVIEW_JOB_FIT" },
    { row: { ...qualifiedConversation, buying_role: "UNKNOWN" }, action: "QUALIFY_RELEVANT_JOB" },
    { row: { ...qualifiedConversation, enforcement_requirement: "NEEDS_ENFORCEMENT" }, action: "REVIEW_JOB_FIT" },
    { row: { offer_at: "2026-09-07T09:00:00.000Z" }, action: "REVIEW_OFFER_RESPONSE" },
    { row: { invoice_commitment_at: "2026-09-07T09:00:00.000Z" }, action: "PREPARE_VERIFIED_INVOICE" },
    { row: { invoice_sent_at: "2026-09-07T09:00:00.000Z" }, action: "RECONCILE_PAYMENT" },
    { row: { ...recordedPayment, status: "active-pilot", proposal_count: "0" }, action: "REVIEW_FIRST_DECISION" },
    { row: { ...recordedPayment, status: "active-pilot", proposal_count: "1", t5_status: "NOT_YET_ELIGIBLE" }, action: "REVIEW_RECONCILIATION" },
    { row: { ...recordedPayment, status: "active-pilot", proposal_count: "1", t5_status: "RESCUED" }, action: "REPAIR_CUSTOMER_WORKFLOW" },
    { row: { ...recordedPayment, status: "active-pilot", proposal_count: "1", t5_status: "FAIL" }, action: "REPAIR_CUSTOMER_WORKFLOW" },
    { row: { ...recordedPayment, status: "active-pilot", proposal_count: "1", t5_status: "PASS" }, action: "REVIEW_VALUE_AND_REPURCHASE" },
    { row: { ...recordedPayment, status: "active-pilot", renewal_offered_at: "2026-09-09T09:00:00.000Z" }, action: "RECONCILE_REPEAT_PURCHASE" },
    { row: { ...recordedPayment, status: "renewed", renewal_paid_at: "2026-09-09T09:00:00.000Z" }, action: "REVIEW_REPEAT_USE" },
    { row: { ...recordedPayment, status: "refunded" }, action: "RECONCILE_REFUND" },
    { row: { status: "closed-lost" }, action: "REVIEW_LOSS" },
  ];

  for (const scenario of cases) {
    const row = selectedRow(scenario.row);
    const before = structuredClone(row);
    const desk = buildMarketOperatorDesk([row]);
    assert.equal(desk.customerActions[0]?.action, scenario.action);
    assert.equal(desk.customerActions[0].automatic, false);
    assert.ok(desk.customerActions[0].ownerRole);
    assert.deepEqual(desk.firstTouches, []);
    assert.deepEqual(desk.followUps, []);
    assert.deepEqual(row, before);
  }
});

test("market desk holds incomplete or inconsistent customer records for reconciliation", () => {
  const cases: Array<Record<string, string>> = [
    { status: "active-pilot", payment_received_at: "not-a-date", payment_amount_inr: "14999" },
    { status: "paid-pilot", payment_received_at: "2026-09-08T09:00:00.000Z", payment_amount_inr: "1" },
    { status: "active-pilot", payment_received_at: "2026-09-08T09:00:00.000Z" },
    { status: "renewed" },
    { status: "offered" },
    { status: "unexpected-status" },
  ];
  for (const overrides of cases) {
    const desk = buildMarketOperatorDesk([selectedRow(overrides)]);
    assert.match(desk.customerActions[0]?.action ?? "", /^RECONCILE_(PAYMENT_EVIDENCE|CUSTOMER_RECORD)$/);
    assert.deepEqual(desk.firstTouches, []);
    assert.deepEqual(desk.followUps, []);
  }

  const unassigned = buildMarketOperatorDesk([selectedRow({
    test_cell: "",
    replied_at: "2026-09-07T09:00:00.000Z",
  })]);
  assert.equal(unassigned.customerActions[0].action, "RECONCILE_CUSTOMER_RECORD");
  assert.match(unassigned.customerActions[0].instruction, /current.*thesis/i);
});

test("market desk reports human work rather than certified customers or revenue", () => {
  const desk = buildMarketOperatorDesk([selectedRow({
    status: "paid-pilot",
    payment_received_at: "2026-09-08T09:00:00.000Z",
    payment_amount_inr: "14999",
  })]);

  assert.equal(desk.summary.customerActionCounts.REVIEW_ACTIVATION_GATES, 1);
  assert.match(desk.customerGuide, /recorded CRM.*not independently verified/i);
  assert.match(desk.customerGuide, /no.*automatic.*renewal/i);
  assert.match(desk.customerGuide, /not ARR/i);
  assert.match(desk.customerGuide, /P01/);
  assert.doesNotMatch(desk.customerGuide, /Private Company|example\.test/);
  assert.match(formatMarketOperatorDeskSummary(desk.summary), /customer actions: 1.*human review/i);
});

test("market desk drafts use text-first discovery and the full unchanged offer boundary", () => {
  const desk = buildMarketOperatorDesk([
    selectedRow({ id: "P01" }),
    selectedRow({ id: "P02", contacted_at: "2026-09-01T09:00:00.000Z" }),
  ]);

  for (const draft of [...desk.firstTouches, ...desk.followUps]) {
    assert.match(draft.content, /reply by text/i);
    assert.match(draft.content, /call is optional/i);
    assert.match(draft.content, /do not submit real financial/i);
    assert.match(draft.content, /permission.*duplicate/i);
    assert.doesNotMatch(draft.content, /real customer financial data remains blocked/i);
  }
  assert.match(desk.firstTouches[0].content, /second month requires a separate purchase/i);
  assert.match(desk.firstTouches[0].content, /ten business days/i);
  assert.match(desk.interviewGuide, /TEXT FIRST/);
  assert.match(desk.interviewGuide, /call is optional/i);
  assert.match(desk.interviewGuide, /do not submit real financial/i);
  assert.match(desk.interviewGuide, /capacity/i);
});

function selectedRow(overrides: Record<string, string>) {
  return {
    id: "P01",
    test_cell: "DIRECT_FINANCE",
    company_name: "Private Company",
    finance_owner_role: "Finance owner",
    finance_owner_public_url: "https://example.test/private-role",
    contact_channel: "",
    contacted_at: "",
    replied_at: "",
    ...overrides,
  };
}