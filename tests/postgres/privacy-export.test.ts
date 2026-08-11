import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createPlatformApiToken } from "../../src/lib/server/platform-api-token-store";
import {
  createAccessExportRequest,
  downloadAccessExport,
} from "../../src/lib/server/privacy-lifecycle-store";
import { recordProductEvent } from "../../src/lib/server/product-event-store";
import { updateRenewalAlertPreference } from "../../src/lib/server/renewal-alert-store";
import { saveAuditSnapshot } from "../../src/lib/server/audit-snapshot-store";
import { upsertWorkspaceCommitmentDecision } from "../../src/lib/server/commitment-decision-store";
import { getDatabasePool } from "../../src/lib/server/database";
import { authorizeWorkspaceActionCase, createWorkspaceActionCase } from "../../src/lib/server/outcome-case-store";
import { outcomeOffer } from "../../src/lib/outcome-cases";
import { submitRecoveryEvidence } from "../../src/lib/server/recovery-store";

const databaseConfigured = Boolean(process.env.DATABASE_URL);

test("privacy export includes held product data and excludes all credential material", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const previousKey = process.env.TOKEN_ENCRYPTION_KEY;
  process.env.TOKEN_ENCRYPTION_KEY = "55".repeat(32);
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const email = `${userId}@privacy-export.test`;
  const pool = getDatabasePool();

  try {
    await pool.query(`insert into users (id, email, display_name) values ($1, $2, 'Export Owner')`, [userId, email]);
    await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Privacy export test')`, [workspaceId, userId]);
    await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, userId]);

    const state = {
      version: 1,
      exportedAt: "2026-07-11T00:00:00.000Z",
      statementSources: [{
        id: "statement-one",
        name: "statement.csv",
        text: [
          "Date,Description,Debit,Credit",
          "2026-05-05,NETFLIX PREMIUM,649,",
          "2026-06-05,NETFLIX PREMIUM,649,",
        ].join("\n"),
        rowCount: 2,
        kind: "csv",
        warnings: [],
      }],
      manualItems: [{
        id: "manual-plan",
        merchant: "Manual Plan",
        amount: 999,
        currency: "INR",
        frequency: "monthly",
        nextExpectedDate: "2027-08-11",
        category: "Productivity",
        sourceName: "Provider account screen",
      }],
      userActions: {},
      itemOwners: {},
      reviewNotes: { "manual plan::INR": "Confirm owner before renewal" },
      teamMembers: [{ id: "owner", name: "Export Owner", role: "Owner" }],
      receiptText: "",
      actionsMeta: {},
      mergeDecisions: {},
      lastReview: null,
      reviewCompletedAt: "2026-07-11T01:00:00.000Z",
    };
    const saved = await saveAuditSnapshot({
      workspaceId,
      userId,
      title: "Privacy export fixture",
      summary: {
        recurringCount: 2,
        monthlyRecurringSpend: 1648,
        annualRecurringSpend: 19776,
        reviewableMonthlySpend: 1648,
        sourceCount: 1,
        manualCount: 1,
      },
      snapshot: state,
      expectedRevision: null,
    });
    assert.equal(saved.status, "saved");

    const recurring = await pool.query<{ id: string }>(
      `select id from recurring_items where workspace_id = $1 order by merchant asc limit 1`,
      [workspaceId],
    );
    const recurringItemId = recurring.rows[0]?.id;
    assert.ok(recurringItemId);
    await upsertWorkspaceCommitmentDecision({ workspaceId, recurringItemId, userId, action: "watch" });
    const actionCase = await createWorkspaceActionCase({
      workspaceId,
      recurringItemId,
      requestedByUserId: userId,
      action: "cancel",
      idempotencyKey: `privacy-case:${randomUUID()}`,
    });
    await authorizeWorkspaceActionCase({
      workspaceId,
      actionCaseId: actionCase.actionCase.id,
      authorizedByUserId: userId,
      termsVersion: outcomeOffer.termsVersion,
      idempotencyKey: `privacy-auth:${randomUUID()}`,
    });
    await updateRenewalAlertPreference({
      workspaceId,
      userId,
      email,
      preference: {
        enabled: true,
        weeklyDigestEnabled: true,
        sevenDayEnabled: true,
        oneDayEnabled: true,
        timeZone: "Asia/Kolkata",
        sendHourLocal: 9,
      },
    });
    await recordProductEvent({
      workspaceId,
      userId,
      eventName: "review.completed",
      source: "product-ui",
      status: "succeeded",
      metrics: { commitmentsTouched: 2 },
    });
    const platformToken = await createPlatformApiToken({
      workspaceId,
      userId,
      name: "Export fixture token",
      scopes: ["ledger:read"],
      expiresInDays: 30,
    });
    const rawEvidenceTail = "RAW-EVIDENCE-PRIVATE-TAIL-MUST-NOT-EXPORT";
    const recoveryDates = (await pool.query<{ charged_on: string; renews_on: string }>(
      `select (current_date - 1)::text as charged_on, (current_date + 30)::text as renews_on`,
    )).rows[0]!;
    await submitRecoveryEvidence({
      workspaceId,
      actorUserId: userId,
      expectedVersion: 0,
      idempotencyKey: `privacy-recovery:${randomUUID()}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "privacy-openai",
          text: `OpenAI subscription charged INR 1,999 on ${recoveryDates.charged_on}. Renews monthly on ${recoveryDates.renews_on}. ${"context ".repeat(80)}${rawEvidenceTail}`,
        }],
      },
      now: new Date(),
    });

    const request = await createAccessExportRequest({ workspaceId, actorUserId: userId });
    const downloaded = await downloadAccessExport({ requestId: request.id, workspaceId, actorUserId: userId });
    assert.equal(downloaded.status, "ok");
    if (downloaded.status !== "ok") return;

    const document = JSON.parse(downloaded.serialized);
    assert.equal(document.transactions.length, 2);
    assert.equal(document.recurringLedger.length, 2);
    assert.equal(document.decisions.length, 1);
    assert.equal(document.workspaceState.revision, 1);
    assert.equal(document.workspaceState.state.reviewCompletedAt, "2026-07-11T01:00:00.000Z");
    assert.equal(document.workspaceState.state.statementSources[0].text.includes("NETFLIX"), true);
    assert.equal(document.recovery.workspaceState.version, "1");
    assert.equal(document.recovery.versions.length, 1);
    assert.equal(document.recovery.submissions.length, 1);
    assert.equal(document.recovery.sources.length, 1);
    assert.equal(document.recovery.sources[0].rawEvidenceRetained, true);
    assert.equal("rawEvidence" in document.recovery.sources[0], false);
    assert.equal(document.recovery.commitments.length, 1);
    assert.equal(document.recovery.evidence.length, 1);
    assert.equal(document.recovery.evidence[0].excerpt.length <= 500, true);
    assert.equal(document.recovery.evidence[0].excerptTruncated, true);
    assert.doesNotMatch(JSON.stringify(document.recovery), /contentHash|fingerprint/i);
    assert.equal(document.recovery.commitmentEvidence.length, 1);
    assert.equal(document.recovery.decisions.length, 0);
    assert.equal(document.productEvents.length, 1);
    assert.equal(document.renewalAlertPreferences.length, 1);
    assert.equal(document.renewalAlertPreferences[0].weeklyDigestEnabled, true);
    assert.ok(document.renewalAlertDeliveries.length >= 1);
    assert.equal(document.renewalAlertDeliveries[0].recurringItemId, null);
    assert.equal(document.renewalAlertDeliveries[0].recoveryCommitmentId, document.recovery.commitments[0].id);
    assert.ok(Array.isArray(document.weeklyDigestDeliveries));
    assert.equal(document.apiTokens.length, 1);
    assert.equal(document.apiTokens[0].tokenPrefix, platformToken.summary.tokenPrefix);
    assert.ok(Array.isArray(document.assistedAuditOrders));
    assert.ok(Array.isArray(document.billingRefunds));
    assert.ok(document.proofGraph.nodes.length > 0);
    assert.ok(document.proofGraph.ledgerEvents.length > 0);
    assert.equal(document.verifiedOutcomes.actionCases.length, 1);
    assert.equal(document.verifiedOutcomes.authorizations.length, 1);
    assert.match(document.verifiedOutcomes.authorizations[0].authorizationText, /I authorize Vognary/i);
    assert.ok(document.verifiedOutcomes.caseEvents.length >= 2);
    assert.ok(document.auditHistory.length >= 4);

    const recoveryCommitmentId = document.recovery.commitments[0].id as string;
    await pool.query(
      `update recovery_commitments
       set base_amount_minor = 9007199254740993,
           base_monthly_minor = 9007199254740993,
           effective_amount_minor = 9007199254740993,
           effective_monthly_minor = 9007199254740993
       where workspace_id = $1 and id = $2`,
      [workspaceId, recoveryCommitmentId],
    );
    const exactRequest = await createAccessExportRequest({ workspaceId, actorUserId: userId });
    const exactDownload = await downloadAccessExport({ requestId: exactRequest.id, workspaceId, actorUserId: userId });
    assert.equal(exactDownload.status, "ok");
    if (exactDownload.status === "ok") {
      const exactDocument = JSON.parse(exactDownload.serialized);
      assert.equal(exactDocument.recovery.commitments[0].effectiveAmountMinor, "9007199254740993");
    }

    for (const forbidden of [
      platformToken.token,
      "token_hash",
      "encrypted_payload",
      "secret_ref",
      "raw_row",
      "payload_hash",
      rawEvidenceTail,
    ]) {
      assert.equal(downloaded.serialized.includes(forbidden), false, `${forbidden} must not enter the export`);
    }
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from consent_grants where user_id = $1`, [userId]);
    await pool.query(`delete from users where id = $1`, [userId]);
    if (previousKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = previousKey;
  }
});
