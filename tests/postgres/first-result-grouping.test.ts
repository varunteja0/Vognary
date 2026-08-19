import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { getDatabasePool } from "../../src/lib/server/database";
import { submitRecoveryEvidence } from "../../src/lib/server/recovery-store";

const databaseConfigured = Boolean(process.env.DATABASE_URL);

function openaiReceipt(monthPaid: string, nextMonth: string, amount = "1,999.00") {
  return [
    "OpenAI",
    `Invoice paid INR ${amount}`,
    `Payment date: ${monthPaid}`,
    `ChatGPT Plus renews monthly on ${nextMonth}.`,
  ].join("\n");
}

function notionReceipt(monthPaid: string, nextMonth: string) {
  return [
    "Notion",
    "Invoice paid INR 830.00",
    `Payment date: ${monthPaid}`,
    `Notion Plus renews monthly on ${nextMonth}.`,
  ].join("\n");
}

test("sequential OpenAI and Notion receipts collapse to two commitments, not four", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const ownerUserId = randomUUID();
  const workspaceId = randomUUID();
  const suffix = randomUUID().slice(0, 8);

  await pool.query(`insert into users (id, email) values ($1, $2)`, [ownerUserId, `first-result-${suffix}@example.test`]);
  await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'First result workspace')`, [workspaceId, ownerUserId]);
  await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, ownerUserId]);

  try {
    const first = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `first-openai-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{ clientRef: "openai-july", text: openaiReceipt("6 July 2026", "6 August 2026") }],
      },
      now: new Date("2026-08-19T10:00:00.000Z"),
    });
    assert.equal(first.data.submission.acceptedEvidenceCount, 1);
    assert.equal(first.data.commitments.length, 1);
    assert.equal(first.data.commitments[0]?.merchant, "OpenAI");
    assert.equal(first.data.commitments[0]?.recommendedDecision, "KEEP");

    const second = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 1,
      idempotencyKey: `second-openai-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{ clientRef: "openai-august", text: openaiReceipt("6 August 2026", "6 September 2026") }],
      },
      now: new Date("2026-08-19T10:05:00.000Z"),
    });
    assert.equal(second.data.commitments.length, 1, "two OpenAI months must stay one commitment");
    assert.equal(second.data.commitments[0]?.evidenceCount, 2);
    assert.equal(second.data.home.activeCommitmentCount, 1);
    assert.ok(
      second.data.home.decisionQueue.some((card) => card.reasonKeys.includes("NEW_COMMITMENT")),
      "a newly observed recurring commitment still needs a first decision",
    );
    assert.equal(second.data.commitments[0]?.recommendedDecision, "KEEP");
    assert.equal(second.data.home.monthlyTotals[0]?.amount.minor, "199900");

    const replay = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 2,
      idempotencyKey: `second-openai-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{ clientRef: "openai-august", text: openaiReceipt("6 August 2026", "6 September 2026") }],
      },
      now: new Date("2026-08-19T10:06:00.000Z"),
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.data.commitments.length, 1);

    const notion = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 2,
      idempotencyKey: `notion-july-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{ clientRef: "notion-july", text: notionReceipt("1 July 2026", "1 August 2026") }],
      },
      now: new Date("2026-08-19T10:10:00.000Z"),
    });
    const afterNotionMonthTwo = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: notion.workspaceVersion,
      idempotencyKey: `notion-august-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{ clientRef: "notion-august", text: notionReceipt("1 August 2026", "1 September 2026") }],
      },
      now: new Date("2026-08-19T10:11:00.000Z"),
    });
    const active = afterNotionMonthTwo.data.commitments.filter((commitment) => commitment.status === "ACTIVE");
    assert.equal(active.length, 2, "OpenAI + Notion must be two commitments, not four");
    assert.deepEqual(active.map((commitment) => commitment.merchant).sort(), ["Notion", "OpenAI"]);
    assert.equal(active.every((commitment) => commitment.recommendedDecision === "KEEP"), true);
    assert.equal(afterNotionMonthTwo.data.home.activeCommitmentCount, 2);
    assert.equal(afterNotionMonthTwo.data.home.reviewItemCount, 2);
    assert.equal(afterNotionMonthTwo.data.home.monthlyTotals[0]?.amount.minor, "282900");

    const priced = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: afterNotionMonthTwo.workspaceVersion,
      idempotencyKey: `openai-increase-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{ clientRef: "openai-september", text: openaiReceipt("6 September 2026", "6 October 2026", "2,499.00") }],
      },
      now: new Date("2026-08-19T10:15:00.000Z"),
    });
    const openai = priced.data.commitments.find((commitment) => commitment.merchant === "OpenAI" && commitment.status === "ACTIVE");
    const notionKept = priced.data.commitments.find((commitment) => commitment.merchant === "Notion" && commitment.status === "ACTIVE");
    assert.equal(openai?.recommendedDecision, "MONITOR");
    assert.match(priced.data.home.needsMe[0]?.detail ?? "", /Price changed|higher than the earlier/i);
    assert.equal(notionKept?.recommendedDecision, "KEEP");
    assert.ok(priced.data.home.decisionQueue.some((card) => card.reasonKeys.includes("PRICE_INCREASE")));
    assert.ok(priced.data.home.reviewItemCount >= 1);
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("distinct OpenAI products stay two commitments", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const ownerUserId = randomUUID();
  const workspaceId = randomUUID();
  const suffix = randomUUID().slice(0, 8);

  await pool.query(`insert into users (id, email) values ($1, $2)`, [ownerUserId, `first-result-split-${suffix}@example.test`]);
  await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Split workspace')`, [workspaceId, ownerUserId]);
  await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, ownerUserId]);

  try {
    const first = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `plus-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "plus",
          text: "OpenAI ChatGPT Plus. Workspace: acme-eng. Invoice paid INR 1,999.00. Payment date: 6 August 2026. Renews monthly on 6 September 2026.",
        }],
      },
      now: new Date("2026-08-19T10:00:00.000Z"),
    });
    const second = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: first.workspaceVersion,
      idempotencyKey: `api-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "api",
          text: "OpenAI API usage. Workspace: northstar. Invoice paid INR 3,200.00. Payment date: 9 August 2026. Renews monthly on 9 September 2026.",
        }],
      },
      now: new Date("2026-08-19T10:01:00.000Z"),
    });
    const active = second.data.commitments.filter((commitment) => commitment.status === "ACTIVE");
    assert.equal(active.length, 2);
    assert.equal(second.data.home.activeCommitmentCount, 2);
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});
