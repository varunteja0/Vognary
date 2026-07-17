import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { saveAuditSnapshot } from "../../src/lib/server/audit-snapshot-store";
import { getDatabasePool } from "../../src/lib/server/database";
import { askWorkspaceProofGraph } from "../../src/lib/server/proof-question-store";

const databaseConfigured = Boolean(process.env.DATABASE_URL);

test("cited questions execute against the materialized Living Proof Graph", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const previousKey = process.env.TOKEN_ENCRYPTION_KEY;
  process.env.TOKEN_ENCRYPTION_KEY = "77".repeat(32);
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const pool = getDatabasePool();

  try {
    await pool.query(`insert into users (id, email) values ($1, $2)`, [userId, `${userId}@proof-question.test`]);
    await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Cited answers')`, [workspaceId, userId]);
    await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, userId]);

    const saved = await saveAuditSnapshot({
      workspaceId,
      userId,
      title: "Cited answer fixture",
      expectedRevision: null,
      summary: {
        recurringCount: 1,
        monthlyRecurringSpend: 1999,
        annualRecurringSpend: 23988,
        reviewableMonthlySpend: 1999,
        sourceCount: 1,
        manualCount: 0,
      },
      snapshot: {
        version: 1,
        exportedAt: "2026-07-17T00:00:00.000Z",
        statementSources: [{
          id: "statement-proof",
          name: "bank-statement.csv",
          text: [
            "Date,Description,Debit,Credit",
            "2026-05-06,OPENAI CHATGPT,1999,",
            "2026-06-06,OPENAI CHATGPT,1999,",
            "2026-07-06,OPENAI CHATGPT,1999,",
          ].join("\n"),
          rowCount: 3,
          kind: "csv",
          warnings: [],
        }],
        manualItems: [],
        userActions: {},
        itemOwners: {},
        reviewNotes: {},
        teamMembers: [{ id: "owner", name: "Owner", role: "Owner" }],
        receiptText: "",
        actionsMeta: {},
        mergeDecisions: {},
        lastReview: null,
        reviewCompletedAt: null,
      },
    });
    assert.equal(saved.status, "saved");

    const answer = await askWorkspaceProofGraph(workspaceId, "What is my total recurring spend?");
    assert.equal(answer.answerable, true);
    assert.match(answer.summary.text, /₹1,999/);
    assert.equal(answer.citations[0].graphRevision > 0, true);

    const merchant = await askWorkspaceProofGraph(workspaceId, "What do we know about OpenAI?");
    assert.equal(merchant.intent, "merchant");
    assert.equal(merchant.citations[0].kind, "commitment");
    assert.ok(merchant.citations[0].sourceNames.includes("Workspace uploads and manual evidence"));
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [userId]);
    if (previousKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = previousKey;
  }
});
