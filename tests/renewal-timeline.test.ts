import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeStatements } from "../src/lib/recurring-audit";
import { buildRenewalTimeline } from "../src/lib/renewal-timeline";

const today = new Date(2026, 6, 10); // 2026-07-10

function csv(rows: string[]): string {
  return ["Date,Description,Debit,Credit", ...rows].join("\n");
}

test("builds an ordered renewal timeline with bucket totals", () => {
  const audit = analyzeStatements(
    [{
      name: "statement.csv",
      text: csv([
        "2026-05-06,OPENAI CHATGPT PLUS,1999,",
        "2026-06-06,OPENAI CHATGPT PLUS,1999,",
        "2026-07-06,OPENAI CHATGPT PLUS,1999,",
        "2026-05-18,VERCEL PRO TEAM,1600,",
        "2026-06-18,VERCEL PRO TEAM,1600,",
      ]),
    }],
    [],
    { today },
  );

  const timeline = buildRenewalTimeline(audit.recurringItems, { horizonDays: 45, today });

  assert.ok(timeline.events.length >= 2);
  assert.equal(timeline.events[0].merchant, "Vercel", "July 18 renewal comes before August 6");
  assert.equal(timeline.events[0].date, "2026-07-18");
  assert.equal(timeline.events[0].daysAway, 8);

  const openai = timeline.events.find((event) => event.merchant === "OpenAI");
  assert.equal(openai?.date, "2026-08-06");

  for (const event of timeline.events) {
    assert.ok(event.daysAway >= 0, "no past events in the timeline");
    assert.ok(event.daysAway <= 45, "no events beyond the horizon");
  }

  const bucketTotal = timeline.buckets.reduce((total, bucket) => total + bucket.total, 0);
  assert.ok(Math.abs(bucketTotal - timeline.totalDue) < 0.01, "bucket totals must reconcile with the grand total");
  assert.ok(timeline.dueNext30Days >= timeline.dueNext7Days);
});

test("projects multiple occurrences for short cadences inside the horizon", () => {
  const audit = analyzeStatements(
    [{
      name: "statement.csv",
      text: csv([
        "2026-06-19,GYM CLASS WEEKLY MEMBERSHIP,500,",
        "2026-06-26,GYM CLASS WEEKLY MEMBERSHIP,500,",
        "2026-07-03,GYM CLASS WEEKLY MEMBERSHIP,500,",
      ]),
    }],
    [],
    { today },
  );

  const timeline = buildRenewalTimeline(audit.recurringItems, { horizonDays: 30, today });
  const weeklyEvents = timeline.events.filter((event) => event.frequency === "weekly");
  assert.ok(weeklyEvents.length >= 3, `weekly item should appear multiple times in 30 days, got ${weeklyEvents.length}`);
});

test("applies user action overrides to timeline events", () => {
  const audit = analyzeStatements(
    [{
      name: "statement.csv",
      text: csv([
        "2026-05-06,OPENAI CHATGPT PLUS,1999,",
        "2026-06-06,OPENAI CHATGPT PLUS,1999,",
        "2026-07-06,OPENAI CHATGPT PLUS,1999,",
      ]),
    }],
    [],
    { today },
  );

  const identityKey = audit.recurringItems[0].identityKey;
  const timeline = buildRenewalTimeline(audit.recurringItems, { horizonDays: 45, today, actions: { [identityKey]: "cancel" } });
  assert.equal(timeline.events[0]?.action, "cancel");
});

test("returns an empty timeline for no items", () => {
  const timeline = buildRenewalTimeline([], { horizonDays: 45, today });
  assert.equal(timeline.events.length, 0);
  assert.equal(timeline.totalDue, 0);
  assert.equal(timeline.buckets.length, 0);
});
