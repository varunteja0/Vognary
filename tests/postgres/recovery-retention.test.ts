import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { getDatabasePool } from "../../src/lib/server/database";
import { getRecoveryHome, submitRecoveryEvidence } from "../../src/lib/server/recovery-store";
import { executeRetentionPolicies } from "../../src/lib/server/retention-executor";

const databaseConfigured = Boolean(process.env.DATABASE_URL);

test("Recovery retention minimizes raw bodies and terminal inbox metadata while preserving canonical truth and workspace erasure", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const suffix = randomUUID().slice(0, 8);

  await pool.query(
    `insert into users (id, email, display_name) values ($1, $2, 'Recovery retention owner')`,
    [userId, `recovery-retention-${suffix}@example.test`],
  );
  await pool.query(
    `insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Recovery retention')`,
    [workspaceId, userId],
  );
  await pool.query(
    `insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`,
    [workspaceId, userId],
  );

  try {
    await submitRecoveryEvidence({
      workspaceId,
      actorUserId: userId,
      expectedVersion: 0,
      idempotencyKey: `recovery-retention-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "old-openai-receipt",
          text: "OpenAI subscription charged INR 1,999 on 6 January 2026. Renews monthly on 6 February 2026.",
        }],
      },
      now: new Date("2026-01-07T08:00:00.000Z"),
    });
    const terminalEventId = randomUUID();
    const processingEventId = randomUUID();
    await pool.query(
      `insert into recovery_inbound_events (
         id, provider, svix_id, provider_email_id, workspace_id, event_type,
         payload_hash, status, error_code, received_at, processing_started_at, processed_at
       ) values
         ($2, 'RESEND', $4, $5, $1, 'email.received', $6, 'PROCESSED', null, now() - interval '60 days', null, now() - interval '60 days'),
         ($3, 'RESEND', $7, $8, $1, 'email.received', $9, 'PROCESSING', null, now() - interval '60 days', now() - interval '60 days', null)`,
      [
        workspaceId,
        terminalEventId,
        processingEventId,
        `svix-terminal-${suffix}`,
        `email-terminal-${suffix}`,
        "a".repeat(64),
        `svix-processing-${suffix}`,
        `email-processing-${suffix}`,
        "b".repeat(64),
      ],
    );
    await pool.query(
      `update recovery_submissions
       set inbound_event_id = $2
       where workspace_id = $1`,
      [workspaceId, terminalEventId],
    );

    const preview = await executeRetentionPolicies({
      dryRun: true,
      workspaceId,
      afterWorkspaceId: null,
      workspaceLimit: 1,
      batchSize: 100,
    }, "internal-api");
    assert.equal(preview.results[0]?.counts.recoveryRawEvidenceMinimized, 1);
    assert.equal(preview.results[0]?.counts.recoveryInboundEventsDeleted, 1);
    const before = await pool.query<{ raw_evidence: Record<string, unknown>; raw_minimized_at: Date | null }>(
      `select raw_evidence, raw_minimized_at from recovery_sources where workspace_id = $1`,
      [workspaceId],
    );
    assert.equal(before.rows[0]?.raw_evidence.encrypted, true);
    assert.equal(before.rows[0]?.raw_minimized_at, null);

    const executed = await executeRetentionPolicies({
      dryRun: false,
      workspaceId,
      afterWorkspaceId: null,
      workspaceLimit: 1,
      batchSize: 100,
    }, "internal-api");
    assert.equal(executed.results[0]?.status, "completed");
    assert.equal(executed.results[0]?.counts.recoveryRawEvidenceMinimized, 1);
    assert.equal(executed.results[0]?.counts.recoveryInboundEventsDeleted, 1);

    const after = await pool.query<{
      raw_evidence: Record<string, unknown>;
      raw_minimized_at: Date | null;
      evidence_count: string;
      commitment_count: string;
      submission_workspace_id: string;
      inbound_event_id: string | null;
    }>(
      `select source.raw_evidence, source.raw_minimized_at,
              (select count(*)::text from recovery_evidence where workspace_id = $1) as evidence_count,
              (select count(*)::text from recovery_commitments where workspace_id = $1) as commitment_count,
              (select workspace_id::text from recovery_submissions where workspace_id = $1 limit 1) as submission_workspace_id,
              (select inbound_event_id::text from recovery_submissions where workspace_id = $1 limit 1) as inbound_event_id
       from recovery_sources source where source.workspace_id = $1`,
      [workspaceId],
    );
    assert.deepEqual(after.rows[0]?.raw_evidence, {});
    assert.ok(after.rows[0]?.raw_minimized_at);
    assert.equal(after.rows[0]?.evidence_count, "1");
    assert.equal(after.rows[0]?.commitment_count, "1");
    assert.equal(after.rows[0]?.submission_workspace_id, workspaceId);
    assert.equal(after.rows[0]?.inbound_event_id, null);
    assert.equal((await getRecoveryHome({ workspaceId, actorUserId: userId })).workspace.version, 1);
    const retainedEvents = await pool.query<{ id: string; status: string }>(
      `select id, status from recovery_inbound_events where workspace_id = $1 order by id`,
      [workspaceId],
    );
    assert.deepEqual(retainedEvents.rows, [{ id: processingEventId, status: "PROCESSING" }]);

    await assert.rejects(
      pool.query(
        `update recovery_evidence set excerpt = 'tampered' where workspace_id = $1`,
        [workspaceId],
      ),
      (error: unknown) => isImmutableEvidenceError(error),
    );
    await assert.rejects(
      pool.query(`delete from recovery_evidence where workspace_id = $1`, [workspaceId]),
      (error: unknown) => isImmutableEvidenceError(error),
    );

    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    const erased = await pool.query<Record<string, string>>(
      `select
         (select count(*)::text from recovery_workspace_states where workspace_id = $1) as states,
         (select count(*)::text from recovery_workspace_versions where workspace_id = $1) as versions,
         (select count(*)::text from recovery_submissions where workspace_id = $1) as submissions,
         (select count(*)::text from recovery_sources where workspace_id = $1) as sources,
         (select count(*)::text from recovery_commitments where workspace_id = $1) as commitments,
         (select count(*)::text from recovery_evidence where workspace_id = $1) as evidence,
         (select count(*)::text from recovery_corrections where workspace_id = $1) as corrections,
         (select count(*)::text from recovery_decisions where workspace_id = $1) as decisions,
         (select count(*)::text from recovery_changes where workspace_id = $1) as changes,
         (select count(*)::text from recovery_idempotency_keys where workspace_id = $1) as idempotency,
         (select count(*)::text from recovery_inbound_events where workspace_id = $1) as inbound_events`,
      [workspaceId],
    );
    assert.ok(Object.values(erased.rows[0] ?? {}).every((count) => count === "0"));
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [userId]);
  }
});

function isImmutableEvidenceError(error: unknown) {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "55000"
    && "message" in error
    && typeof error.message === "string"
    && /Recovery evidence is immutable/i.test(error.message),
  );
}
