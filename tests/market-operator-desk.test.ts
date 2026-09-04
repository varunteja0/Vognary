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