import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { getDatabasePool } from "../../src/lib/server/database";
import {
  beginConnectorSyncRun,
  createConnectorSyncJob,
  failConnectorSyncRun,
  getConnectorSyncJob,
  listDueConnectorSyncJobs,
} from "../../src/lib/server/sync-job-store";

const databaseConfigured = Boolean(process.env.DATABASE_URL);

test("connector sync failures back off and block at the retry ceiling", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const fixture = await createWorkspaceFixture();

  try {
    const job = await createConnectorSyncJob({
      workspaceId: fixture.workspaceId,
      connectorId: "openai-costs",
      jobType: "incremental_sync",
    });
    const firstRunId = await beginConnectorSyncRun(job, "cron");
    assert.ok(firstRunId);
    await failConnectorSyncRun({ jobId: job.id, runId: firstRunId, error: "provider unavailable" });

    const firstFailure = await getDatabasePool().query<{
      status: string;
      attempt_count: number;
      retry_delay_seconds: number;
      run_status: string;
    }>(
      `select job.status::text,
              job.attempt_count,
              extract(epoch from (job.next_run_at - job.last_error_at))::float8 as retry_delay_seconds,
              run.status::text as run_status
       from connector_sync_jobs job
       join connector_sync_runs run on run.id = $2
       where job.id = $1`,
      [job.id, firstRunId],
    );
    assert.deepEqual(firstFailure.rows[0], {
      status: "failed",
      attempt_count: 1,
      retry_delay_seconds: 60,
      run_status: "failed",
    });

    await getDatabasePool().query(
      `update connector_sync_jobs
       set status = 'failed', attempt_count = 7, next_run_at = now(), locked_at = null, locked_by = null
       where id = $1`,
      [job.id],
    );
    const finalAttempt = await getConnectorSyncJob(job.id);
    assert.ok(finalAttempt);
    const finalRunId = await beginConnectorSyncRun(finalAttempt, "cron");
    assert.ok(finalRunId);
    await failConnectorSyncRun({ jobId: job.id, runId: finalRunId, error: "retry ceiling" });

    const exhausted = await getDatabasePool().query<{
      status: string;
      attempt_count: number;
      next_run_at: Date | null;
      run_status: string;
    }>(
      `select job.status::text, job.attempt_count, job.next_run_at, run.status::text as run_status
       from connector_sync_jobs job
       join connector_sync_runs run on run.id = $2
       where job.id = $1`,
      [job.id, finalRunId],
    );
    assert.deepEqual(exhausted.rows[0], {
      status: "blocked",
      attempt_count: 8,
      next_run_at: null,
      run_status: "failed",
    });
  } finally {
    await deleteWorkspaceFixture(fixture);
  }
});

test("listing due sync jobs recovers stale runner locks and their active runs", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const fixture = await createWorkspaceFixture();

  try {
    const job = await createConnectorSyncJob({
      workspaceId: fixture.workspaceId,
      connectorId: "openai-costs",
      jobType: "incremental_sync",
    });
    const runId = await beginConnectorSyncRun(job, "cron");
    assert.ok(runId);
    await getDatabasePool().query(
      `update connector_sync_jobs
       set locked_at = now() - interval '16 minutes'
       where id = $1`,
      [job.id],
    );

    const dueJobs = await listDueConnectorSyncJobs(20);
    assert.ok(dueJobs.some((dueJob) => dueJob.id === job.id));

    const recovered = await getDatabasePool().query<{
      status: string;
      locked_at: Date | null;
      last_error: string;
      run_status: string;
      run_finished: boolean;
    }>(
      `select job.status::text,
              job.locked_at,
              job.last_error,
              run.status::text as run_status,
              run.finished_at is not null as run_finished
       from connector_sync_jobs job
       join connector_sync_runs run on run.id = $2
       where job.id = $1`,
      [job.id, runId],
    );
    assert.deepEqual(recovered.rows[0], {
      status: "failed",
      locked_at: null,
      last_error: "Recovered after a stale runner lock.",
      run_status: "failed",
      run_finished: true,
    });
  } finally {
    await deleteWorkspaceFixture(fixture);
  }
});

async function createWorkspaceFixture() {
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const pool = getDatabasePool();
  await pool.query(`insert into users (id, email) values ($1, $2)`, [userId, `${userId}@sync-recovery.test`]);
  await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Sync recovery test')`, [workspaceId, userId]);
  await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, userId]);
  return { userId, workspaceId };
}

async function deleteWorkspaceFixture(fixture: { userId: string; workspaceId: string }) {
  const pool = getDatabasePool();
  await pool.query(`delete from workspaces where id = $1`, [fixture.workspaceId]);
  await pool.query(`delete from users where id = $1`, [fixture.userId]);
}
