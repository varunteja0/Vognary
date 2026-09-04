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
import { disconnectRecoverySource, signStandingMandate } from "../../src/lib/server/recovery-autopilot-store";
import {
  createCommitmentControlProposal,
  decideCommitmentControlProposal,
  putCommitmentControlPolicy,
  reconcileCommitmentControlProposal,
  recordCommitmentControlExceptionReview,
  recordCommitmentControlOutcomeObservation,
} from "../../src/lib/server/commitment-control-store";
import { submitRecoveryEvidence } from "../../src/lib/server/recovery-store";
import { createWorkspaceInvite } from "../../src/lib/server/workspace-invite-store";
import { completeControlPolicyRequest, testControlOutcome } from "../commitment-control-policy-fixture";

const databaseConfigured = Boolean(process.env.DATABASE_URL);
process.env.COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS = "*";

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
    const recoveryDates = (await pool.query<{
      charged_on_1: string;
      charged_on_2: string;
      charged_on_3: string;
      renews_on: string;
    }>(
      `select (current_date - 61)::text as charged_on_1,
              (current_date - 31)::text as charged_on_2,
              (current_date - 1)::text as charged_on_3,
              (current_date + 30)::text as renews_on`,
    )).rows[0]!;
    const submitted = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: userId,
      expectedVersion: 0,
      idempotencyKey: `privacy-recovery:${randomUUID()}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [
          {
            clientRef: "privacy-openai-1",
            text: `OpenAI subscription charged INR 1,999 on ${recoveryDates.charged_on_1}. Renews monthly on ${recoveryDates.renews_on}. ${"context ".repeat(80)}${rawEvidenceTail}`,
          },
          {
            clientRef: "privacy-openai-2",
            text: `OpenAI subscription charged INR 1,999 on ${recoveryDates.charged_on_2}. Renews monthly on ${recoveryDates.renews_on}.`,
          },
          {
            clientRef: "privacy-openai-3",
            text: `OpenAI subscription charged INR 1,999 on ${recoveryDates.charged_on_3}. Renews monthly on ${recoveryDates.renews_on}.`,
          },
        ],
      },
      now: new Date(),
    });
    const signed = await signStandingMandate({
      workspaceId,
      actorUserId: userId,
      expectedVersion: submitted.workspaceVersion,
      idempotencyKey: `privacy-mandate:${randomUUID()}`,
    });
    const source = await pool.query<{ id: string }>(
      `select id::text from recovery_sources where workspace_id = $1 order by ingested_at asc limit 1`,
      [workspaceId],
    );
    assert.ok(source.rows[0]?.id);
    const disconnected = await disconnectRecoverySource({
      workspaceId,
      actorUserId: userId,
      sourceId: source.rows[0]!.id,
      expectedVersion: signed.workspaceVersion,
      idempotencyKey: `privacy-disconnect:${randomUUID()}`,
    });

    const controlPolicy = await putCommitmentControlPolicy({
      workspaceId,
      actorUserId: userId,
      expectedVersion: disconnected.workspaceVersion,
      idempotencyKey: `privacy-control-policy:${randomUUID()}`,
      request: completeControlPolicyRequest(),
    });
    const controlProposal = await createCommitmentControlProposal({
      workspaceId,
      actorUserId: userId,
      expectedVersion: controlPolicy.workspaceVersion,
      idempotencyKey: `privacy-control-proposal:${randomUUID()}`,
      request: {
        merchant: "OpenAI",
        purpose: "Production model capacity",
        category: "AI_MODEL",
        amountMinor: "199900",
        currency: "INR",
        firstChargeDate: recoveryDates.renews_on,
        cadence: "MONTHLY",
        existingCommitmentIds: [],
        intendedOutcome: testControlOutcome(),
      },
    });
    const controlDecision = await decideCommitmentControlProposal({
      workspaceId,
      actorUserId: userId,
      proposalId: controlProposal.data.proposal.id,
      expectedVersion: controlProposal.workspaceVersion,
      idempotencyKey: `privacy-control-decision:${randomUUID()}`,
      request: {
        action: "APPROVE_WITH_CAP",
        approvedCapMinor: "180000",
        authorizationExpiresOn: "2099-12-30",
      },
    });
    await pool.query(
      `insert into commitment_control_attention_notifications (
         workspace_id, proposal_id, recipient_user_id, attention_kind, due_on,
         delivery_state, next_attempt_at
       ) values ($1, $2, $3, 'OUTCOME_REVIEW_APPROACHING', '2099-12-31', 'QUEUED', now())`,
      [workspaceId, controlProposal.data.proposal.id, userId],
    );
    const controlEvidenceId = (await pool.query<{ id: string }>(
      `select id from recovery_evidence where workspace_id = $1 order by created_at asc limit 1`,
      [workspaceId],
    )).rows[0]?.id;
    assert.ok(controlEvidenceId);
    await reconcileCommitmentControlProposal({
      workspaceId,
      actorUserId: userId,
      proposalId: controlProposal.data.proposal.id,
      expectedVersion: controlDecision.workspaceVersion,
      idempotencyKey: `privacy-control-reconciliation:${randomUUID()}`,
      request: {
        evidenceId: controlEvidenceId,
        observedOutcome: { value: "12", observedOn: "2099-12-31" },
      },
      now: new Date("2099-12-31T09:00:00.000Z"),
    });
    const controlReconciliationId = (await pool.query<{ id: string }>(
      `select id from commitment_control_reconciliations where workspace_id = $1 order by reconciled_at desc limit 1`,
      [workspaceId],
    )).rows[0]?.id;
    assert.ok(controlReconciliationId);
    await pool.query(
      `insert into commitment_control_attention_notifications (
         workspace_id, proposal_id, recipient_user_id, attention_kind, due_on,
         target_kind, target_id, delivery_state, next_attempt_at
       ) values ($1, $2, $3, 'RECONCILIATION_EXCEPTION', '2099-12-31', 'RECONCILIATION', $4, 'QUEUED', now())`,
      [workspaceId, controlProposal.data.proposal.id, userId, controlReconciliationId],
    );
    const workspaceVersion = Number((await pool.query<{ version: string }>(
      `select version::text from recovery_workspace_states where workspace_id = $1`,
      [workspaceId],
    )).rows[0]?.version ?? 0);
    const controlExceptionReview = await recordCommitmentControlExceptionReview({
      workspaceId,
      actorUserId: userId,
      proposalId: controlProposal.data.proposal.id,
      expectedVersion: workspaceVersion,
      idempotencyKey: `privacy-control-review:${randomUUID()}`,
      request: {
        targetKind: "RECONCILIATION",
        targetId: controlReconciliationId,
        disposition: "NO_FURTHER_ACTION",
        note: "The vendor credited the difference outside Vognary.",
      },
    });
    assert.equal(controlExceptionReview.data.review.targetKind, "RECONCILIATION");

    const standaloneProposal = await createCommitmentControlProposal({
      workspaceId,
      actorUserId: userId,
      expectedVersion: controlExceptionReview.workspaceVersion,
      idempotencyKey: `privacy-control-standalone-proposal:${randomUUID()}`,
      request: {
        merchant: "Anthropic",
        purpose: "Evaluation capacity",
        category: "AI_MODEL",
        amountMinor: "120000",
        currency: "INR",
        firstChargeDate: recoveryDates.renews_on,
        cadence: "MONTHLY",
        existingCommitmentIds: [],
        intendedOutcome: testControlOutcome(),
      },
    });
    const standaloneDecision = await decideCommitmentControlProposal({
      workspaceId,
      actorUserId: userId,
      proposalId: standaloneProposal.data.proposal.id,
      expectedVersion: standaloneProposal.workspaceVersion,
      idempotencyKey: `privacy-control-standalone-decision:${randomUUID()}`,
      request: { action: "APPROVE", authorizationExpiresOn: "2099-12-30" },
    });
    const standaloneObservation = await recordCommitmentControlOutcomeObservation({
      workspaceId,
      actorUserId: userId,
      proposalId: standaloneProposal.data.proposal.id,
      expectedVersion: standaloneDecision.workspaceVersion,
      idempotencyKey: `privacy-control-standalone-outcome:${randomUUID()}`,
      request: { observedOutcome: { value: "3", observedOn: "2099-12-31" } },
      now: new Date("2099-12-31T09:00:00.000Z"),
    });
    assert.equal(standaloneObservation.data.observation.verdict, "MISSED");
    await recordCommitmentControlExceptionReview({
      workspaceId,
      actorUserId: userId,
      proposalId: standaloneProposal.data.proposal.id,
      expectedVersion: standaloneObservation.workspaceVersion,
      idempotencyKey: `privacy-control-standalone-review:${randomUUID()}`,
      request: {
        targetKind: "OUTCOME_OBSERVATION",
        targetId: standaloneObservation.data.observation.id,
        disposition: "CORRECTED_OUTSIDE_VOGNARY",
        note: "The team changed the plan directly with the vendor.",
      },
    });
    await createWorkspaceInvite({
      workspaceId,
      actorUserId: userId,
      email: `privacy-invitee-${randomUUID().slice(0, 8)}@example.test`,
      role: "member",
    });

    const request = await createAccessExportRequest({ workspaceId, actorUserId: userId });
    const downloaded = await downloadAccessExport({ requestId: request.id, workspaceId, actorUserId: userId });
    assert.equal(downloaded.status, "ok");
    if (downloaded.status !== "ok") return;

    const document = JSON.parse(downloaded.serialized);
    assert.equal(document.transactions.length, 2);
    assert.equal(document.recurringLedger.length, 2);
    assert.equal(document.decisions.length, 1);
    assert.equal(document.recommendations.every((recommendation: { estimatedMonthlySavingsCurrency?: string }) => /^[A-Z]{3}$/.test(recommendation.estimatedMonthlySavingsCurrency ?? "")), true);
    assert.equal(document.workspaceState.revision, 1);
    assert.equal(document.workspaceState.state.reviewCompletedAt, "2026-07-11T01:00:00.000Z");
    assert.equal(document.workspaceState.state.statementSources[0].text.includes("NETFLIX"), true);
    assert.equal(Number(document.recovery.workspaceState.version) >= 3, true);
    assert.ok(document.recovery.versions.length >= 3);
    assert.equal(document.recovery.connectedMandateCohort.length, 1);
    assert.ok(document.recovery.connectedMandateCohort[0].startedAt);
    assert.ok(document.recovery.connectedMandateCohort[0].recordedAt);
    assert.equal(document.recovery.sourceDisconnections.length, 1);
    assert.equal(document.recovery.sourceDisconnections[0].sourceId, source.rows[0]!.id);
    assert.ok(document.recovery.sourceDisconnections[0].disconnectedAt);
    assert.equal(document.recovery.sourceDisconnections[0].reconnectedAt, null);
    assert.ok(Array.isArray(document.recovery.standingMandates));
    assert.equal(document.recovery.standingMandates.length, 1);
    assert.equal("signedText" in document.recovery.standingMandates[0], false);
    for (const notice of document.recovery.vetoNotices) {
      assert.equal("text" in notice, false);
      assert.equal("from" in notice, false);
      assert.equal("to" in notice, false);
      assert.equal("subject" in notice, false);
      assert.equal("tags" in notice, false);
      assert.equal("token" in notice, false);
    }
    assert.equal(document.recovery.submissions.length, 1);
    assert.equal(document.recovery.sources.length, 3);
    assert.equal(document.recovery.sources.every((source: { rawEvidenceRetained: boolean }) => source.rawEvidenceRetained), true);
    assert.equal(document.recovery.sources.some((source: Record<string, unknown>) => "rawEvidence" in source), false);
    assert.equal(document.recovery.commitments.length, 1);
    assert.equal(document.recovery.evidence.length, 3);
    assert.equal(document.recovery.evidence.every((evidence: { excerpt: string }) => evidence.excerpt.length <= 500), true);
    assert.equal(document.recovery.evidence.some((evidence: { excerptTruncated: boolean }) => evidence.excerptTruncated), true);
    assert.doesNotMatch(JSON.stringify(document.recovery), /contentHash|fingerprint/i);
    assert.equal(document.recovery.commitmentEvidence.length, 3);
    assert.equal(document.recovery.decisions.length, 0);
    assert.equal(document.commitmentControl.policies.length, 1);
    assert.equal(document.commitmentControl.proposals.length, 2);
    assert.equal(document.commitmentControl.proposals[0].assumptionBasis, "USER_ENTERED_ASSUMPTION");
    assert.equal(document.commitmentControl.proposals[0].submittedByDisplayName, "Export Owner");
    assert.equal(document.commitmentControl.proposals[0].intendedOutcomeMetric, "Resolved fixture tasks");
    assert.equal(document.commitmentControl.proposals[0].intendedOutcomeTargetValue, "10");
    assert.equal(document.commitmentControl.proposals[0].intendedOutcomeReviewOn, "2099-12-31");
    assert.equal(document.commitmentControl.evaluations.length, 2);
    assert.equal(document.commitmentControl.evaluations[0].citedExposureBasis, "NONE");
    assert.equal(document.commitmentControl.decisions.length, 2);
    assert.equal(document.commitmentControl.decisions[0].approvedCapMinor, "180000");
    assert.equal(document.commitmentControl.decisions[0].decidedByDisplayName, "Export Owner");
    assert.equal(document.commitmentControl.decisions[0].overrideReason, null);
    assert.equal(document.commitmentControl.decisions[0].authorizationExpiresOn, "2099-12-30");
    assert.equal(document.commitmentControl.reconciliations.length, 1);
    assert.equal(document.commitmentControl.reconciliations[0].verdict, "OVER_CAP");
    assert.equal(document.commitmentControl.reconciliations[0].observedOutcomeValue, "12");
    assert.match(document.commitmentControl.reconciliations[0].observedEvidenceDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(document.commitmentControl.reconciliations[0].outcomeObservationBasis, "USER_ENTERED_OBSERVATION");
    assert.equal(document.commitmentControl.reconciliations[0].outcomeVerdict, "MET");
    assert.equal(document.commitmentControl.outcomeObservations.length, 1);
    assert.equal(document.commitmentControl.outcomeObservations[0].verdict, "MISSED");
    assert.equal(document.commitmentControl.outcomeObservations[0].observedValue, "3");
    assert.equal(document.commitmentControl.outcomeObservations[0].observationBasis, "USER_ENTERED_OBSERVATION");
    assert.equal(document.commitmentControl.outcomeObservations[0].targetMetric, "Resolved fixture tasks");
    assert.equal(document.commitmentControl.exceptionReviews.length, 2);
    assert.deepEqual(
      document.commitmentControl.exceptionReviews.map((review: Record<string, unknown>) => review.disposition).sort(),
      ["CORRECTED_OUTSIDE_VOGNARY", "NO_FURTHER_ACTION"],
    );
    assert.equal(document.commitmentControl.attentionNotifications.length, 2);
    const untargetedNotification = document.commitmentControl.attentionNotifications
      .find((entry: Record<string, unknown>) => entry.attentionKind === "OUTCOME_REVIEW_APPROACHING");
    const targetedNotification = document.commitmentControl.attentionNotifications
      .find((entry: Record<string, unknown>) => entry.attentionKind === "RECONCILIATION_EXCEPTION");
    assert.equal(untargetedNotification.proposalId, controlProposal.data.proposal.id);
    assert.equal(untargetedNotification.recipientUserId, userId);
    assert.equal(untargetedNotification.deliveryState, "QUEUED");
    assert.equal(untargetedNotification.targetKind, null);
    assert.equal(untargetedNotification.targetId, null);
    assert.equal(targetedNotification.targetKind, "RECONCILIATION");
    assert.equal(targetedNotification.targetId, controlReconciliationId);
    for (const notification of document.commitmentControl.attentionNotifications) {
      assert.equal("lockedBy" in notification, false);
      assert.equal("lockedAt" in notification, false);
    }
    assert.equal(document.commitmentControl.workspaceInvites.length, 1);
    assert.equal(
      document.commitmentControl.workspaceInvites.some((invite: Record<string, unknown>) => "tokenHash" in invite || "token_hash" in invite),
      false,
    );
    assert.ok(document.productEvents.some((event: { eventName: string }) => event.eventName === "review.completed"));
    assert.ok(
      document.productEvents.length >= 1,
      "held product events remain in the export; Autopilot ingest may add privacy-safe source.connected rows",
    );
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
    assert.equal(document.verifiedOutcomes.authorizations[0].currency, document.verifiedOutcomes.actionCases[0].currency);
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
      "notice_text",
      "notice_from_email",
      "notice_to_email",
      "notice_subject",
      "notice_tags",
      rawEvidenceTail,
    ]) {
      assert.equal(downloaded.serialized.includes(forbidden), false, `${forbidden} must not enter the export`);
    }
    assert.doesNotMatch(downloaded.serialized, /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./);
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from consent_grants where user_id = $1`, [userId]);
    await pool.query(`delete from users where id = $1`, [userId]);
    if (previousKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = previousKey;
  }
});

test("privacy export omits Autopilot hash sentinels while keeping useful event metadata", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const previous = {
    notice: process.env.AUTOPILOT_NOTICE_ENABLED,
    channel: process.env.AUTOPILOT_NOTICE_CHANNEL_READY,
    adapter: process.env.AUTOPILOT_TEST_ADAPTER,
    secret: process.env.AUTOPILOT_VETO_TOKEN_SECRET,
    from: process.env.RESEND_FROM_EMAIL,
  };
  process.env.AUTOPILOT_NOTICE_ENABLED = "true";
  process.env.AUTOPILOT_NOTICE_CHANNEL_READY = "false";
  process.env.AUTOPILOT_TEST_ADAPTER = "true";
  process.env.AUTOPILOT_VETO_TOKEN_SECRET = "veto-signing-secret-for-tests-32bytes!!";
  process.env.RESEND_FROM_EMAIL = "notices@vognary.test";
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const email = `${userId}@privacy-hashes.test`;
  const pool = getDatabasePool();
  const vetoTokenHash = "11".repeat(32);
  const noticeBodyHash = "22".repeat(32);
  const payloadHash = "33".repeat(32);
  const proofReferenceHash = "44".repeat(32);
  const noticeFingerprint = "55".repeat(32);
  try {
    await pool.query(`insert into users (id, email, display_name) values ($1, $2, 'Hash Export Owner')`, [userId, email]);
    await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Privacy hash export')`, [workspaceId, userId]);
    await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, userId]);
    const july = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: userId,
      expectedVersion: 0,
      idempotencyKey: `privacy-hash-evidence-july:${randomUUID()}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "privacy-hash-openai-july",
          text: "OpenAI subscription charged INR 1,999 on 6 July 2026. Renews monthly on 6 September 2026.",
        }],
      },
      now: new Date("2026-08-09T10:00:00.000Z"),
    });
    const august = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: userId,
      expectedVersion: july.workspaceVersion,
      idempotencyKey: `privacy-hash-evidence-august:${randomUUID()}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "privacy-hash-openai-august",
          text: "OpenAI subscription charged INR 1,999 on 6 August 2026. Renews monthly on 6 September 2026.",
        }],
      },
      now: new Date("2026-08-09T10:00:00.000Z"),
    });
    await pool.query(`update recovery_commitments set confidence_score = 90 where workspace_id = $1`, [workspaceId]);
    await signStandingMandate({
      workspaceId,
      actorUserId: userId,
      expectedVersion: august.workspaceVersion,
      idempotencyKey: `privacy-hash-mandate:${randomUUID()}`,
    });
    const candidate = await pool.query<{ id: string }>(
      `select id::text from recovery_action_candidates where workspace_id = $1 limit 1`,
      [workspaceId],
    );
    assert.ok(candidate.rows[0]);
    await pool.query(
      `insert into recovery_covered_windows (
         workspace_id, candidate_id, window_start, window_end, expected_debit_date,
         baseline_debit_minor, observed_debit_minor, saving_minor, status, currency
       ) values ($1, $2, '2026-09-05', '2026-09-09', '2026-09-06', 199900, 0, 199900, 'COVERED_CLEAN', 'INR')`,
      [workspaceId, candidate.rows[0]!.id],
    );
    await pool.query(
      `insert into recovery_fee_ledger (
         workspace_id, period_start, period_end, currency, monitoring_minor, verified_saving_minor,
         outcome_fee_minor, retained_minor, refund_credit_minor, additional_charge_minor,
         razorpay_charge_status, inputs_hash, year_start
       ) values ($1, '2026-09-01', '2026-09-30', 'INR', 99900, 199900, 29985, 99900, 0, 0,
         'FAIL_CLOSED', $2, '2026-08-09')`,
      [workspaceId, "bb".repeat(32)],
    );
    await pool.query(
      `insert into recovery_veto_notices (
         workspace_id, candidate_id, channel, delivery_status,
         veto_token_hash, notice_body_hash, notice_from_email, notice_to_email,
         notice_subject, notice_text
       ) values ($1, $2, 'EMAIL', 'QUEUED', $3, $4, 'notices@vognary.test', $5,
         'Vognary Autopilot notice', 'Queued notice used only to prove export redaction.')`,
      [workspaceId, candidate.rows[0]!.id, vetoTokenHash, noticeBodyHash, email],
    );
    await pool.query(
      `insert into recovery_notice_delivery_events (
         workspace_id, candidate_id, provider_event_id, event_type, occurred_at, payload_hash
       ) values ($1, $2, $3, 'email.delivered', '2026-08-24T00:05:00.000Z', $4)`,
      [workspaceId, candidate.rows[0]!.id, `svix-privacy-hash-${randomUUID()}`, payloadHash],
    );
    await pool.query(
      `insert into recovery_execution_attempts (
         workspace_id, candidate_id, attempt_no, operation_key, request_hash, provider_id, status, proof_reference_hash
       ) values ($1, $2, 1, $3, $4, 'openai', 'AUTHORIZED', $5)`,
      [workspaceId, candidate.rows[0]!.id, `privacy-hash-op-${randomUUID()}`, "aa".repeat(32), proofReferenceHash],
    );
    const request = await createAccessExportRequest({ workspaceId, actorUserId: userId });
    const downloaded = await downloadAccessExport({ requestId: request.id, workspaceId, actorUserId: userId });
    assert.equal(downloaded.status, "ok");
    if (downloaded.status !== "ok") return;
    const document = JSON.parse(downloaded.serialized);
    const serialized = downloaded.serialized;
    for (const key of ["vetoTokenHash", "noticeBodyHash", "payloadHash", "noticeFingerprint", "proofReferenceHash", "proofReference"]) {
      assert.equal(serialized.includes(key), false, `${key} must not enter the export`);
    }
    for (const sentinel of [vetoTokenHash, noticeBodyHash, payloadHash, proofReferenceHash, noticeFingerprint]) {
      assert.equal(serialized.includes(sentinel), false, "sentinel hash must not enter the export");
    }
    assert.ok(document.recovery.vetoNotices.length >= 1);
    assert.ok(document.recovery.noticeDeliveryEvents.length >= 1);
    assert.equal(document.recovery.noticeDeliveryEvents[0].eventType, "email.delivered");
    assert.ok(document.recovery.executionAttempts.length >= 1);
    assert.equal(document.recovery.executionAttempts[0].status, "AUTHORIZED");
    assert.equal(document.recovery.coveredWindows[0].currency, "INR");
    assert.equal(document.recovery.coveredWindows[0].savingMinor, "199900");
    assert.equal(document.recovery.feeLedger[0].currency, "INR");
    assert.equal(document.recovery.feeLedger[0].monitoringMinor, "99900");
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    const leftover = await pool.query<{ notices: string }>(
      `select count(*)::text as notices from recovery_veto_notices where workspace_id = $1`,
      [workspaceId],
    );
    assert.equal(leftover.rows[0]?.notices, "0");
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]).catch(() => undefined);
    await pool.query(`delete from users where id = $1`, [userId]).catch(() => undefined);
    if (previous.notice === undefined) delete process.env.AUTOPILOT_NOTICE_ENABLED;
    else process.env.AUTOPILOT_NOTICE_ENABLED = previous.notice;
    if (previous.channel === undefined) delete process.env.AUTOPILOT_NOTICE_CHANNEL_READY;
    else process.env.AUTOPILOT_NOTICE_CHANNEL_READY = previous.channel;
    if (previous.adapter === undefined) delete process.env.AUTOPILOT_TEST_ADAPTER;
    else process.env.AUTOPILOT_TEST_ADAPTER = previous.adapter;
    if (previous.secret === undefined) delete process.env.AUTOPILOT_VETO_TOKEN_SECRET;
    else process.env.AUTOPILOT_VETO_TOKEN_SECRET = previous.secret;
    if (previous.from === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = previous.from;
  }
});
