import "server-only";

import {
  ConnectorReauthorizationRequiredError,
  isConnectorReauthorizationRequiredError,
} from "@/lib/connector-errors";
import { normalizeConnectorSyncResult } from "@/lib/connector-evidence-normalizer";
import { getConnectorById } from "@/lib/connectors";
import { buildEnvironmentConnection, getConnectorAdapter } from "@/lib/connectors/adapter-registry";
import { buildStoredConnectorConnection } from "@/lib/server/connector-token-store";
import { materializeConnectorBatch } from "@/lib/server/living-ledger-store";
import { recordProductEvent } from "@/lib/server/product-event-store";
import {
  beginConnectorSyncRun,
  completeConnectorSyncRun,
  failConnectorSyncRun,
  getConnectorSyncJob,
  markConnectorReauthorizationRequired,
  persistConnectorEvidenceBatch,
  SyncJobNotRunnableError,
} from "@/lib/server/sync-job-store";

export type ConnectorSyncInvocation = "cron" | "internal-api" | "manual" | "initial-setup";

export async function runConnectorSyncJob(jobId: string, invocation: ConnectorSyncInvocation = "internal-api") {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const job = await getConnectorSyncJob(jobId);
  if (!job) return { status: "not-found" as const, jobId };

  const adapter = getConnectorAdapter(job.connectorId);
  const connector = getConnectorById(job.connectorId);

  let runId: string | undefined;

  try {
    runId = await beginConnectorSyncRun(job, invocation);
    if (!runId) throw new Error("Sync run insert did not return an id.");
    if (!adapter) throw new Error(`No adapter registered for ${job.connectorId}.`);
    await recordSyncEventBestEffort({
      workspaceId: job.workspaceId,
      eventName: "connector.sync.started",
      status: "started",
    });

    const storedConnection = job.connectedAccountId
      ? await buildStoredConnectorConnection({
        connectorId: job.connectorId,
        workspaceId: job.workspaceId,
        connectedAccountId: job.connectedAccountId,
      })
      : null;

    if (job.connectedAccountId && !storedConnection) {
      throw new Error(`Connected account ${job.connectedAccountId} is not active or has no stored credentials.`);
    }

    const connection = await adapter.connect(storedConnection ?? buildEnvironmentConnection(job.connectorId, job.workspaceId));
    const adapterResult = await adapter.sync(connection, {
      cursorState: job.cursorState,
      startedAt,
    });
    const batch = normalizeConnectorSyncResult(adapterResult, {
      connectorId: job.connectorId,
      syncMode: connector?.syncMode ?? "scheduled",
      startedAt,
      cursorState: job.cursorState,
    });
    const materialized = job.connectedAccountId
      ? await materializeConnectorBatch({
        workspaceId: job.workspaceId,
        connectedAccountId: job.connectedAccountId,
        connectorId: job.connectorId,
        syncRunId: runId,
        batch,
      })
      : {
        sourceId: null,
        evidenceWritten: await persistConnectorEvidenceBatch({
          workspaceId: job.workspaceId,
          connectedAccountId: null,
          syncRunId: runId,
          evidence: batch.evidence,
        }),
        transactionsWritten: 0,
        commitmentsTouched: 0,
        usageObservationsWritten: 0,
      };
    const recordsWritten = materialized.evidenceWritten
      + materialized.transactionsWritten
      + materialized.commitmentsTouched
      + materialized.usageObservationsWritten;
    const reschedule = Boolean(batch.nextSyncAt) && (
      batch.continuation
      || job.jobType === "initial_sync"
      || job.jobType === "incremental_sync"
    );

    await completeConnectorSyncRun({
      jobId: job.id,
      runId,
      recordsSeen: batch.evidence.length,
      recordsWritten,
      evidenceWritten: materialized.evidenceWritten,
      nextCursorState: batch.nextCursorState,
      nextRunAt: batch.nextSyncAt,
      reschedule,
    });
    await recordSyncEventBestEffort({
      workspaceId: job.workspaceId,
      eventName: "connector.sync.succeeded",
      status: "succeeded",
      durationMs: boundedDuration(startedAtMs),
      metrics: {
        recordsSeen: batch.evidence.length,
        evidenceWritten: materialized.evidenceWritten,
        transactionsWritten: materialized.transactionsWritten,
        commitmentsTouched: materialized.commitmentsTouched,
        usageObservationsWritten: materialized.usageObservationsWritten,
      },
    });

    return {
      status: "succeeded" as const,
      jobId: job.id,
      runId,
      evidenceSeen: batch.evidence.length,
      evidenceWritten: materialized.evidenceWritten,
      transactionsWritten: materialized.transactionsWritten,
      commitmentsTouched: materialized.commitmentsTouched,
      usageObservationsWritten: materialized.usageObservationsWritten,
      coverage: batch.coverage,
      nextSyncAt: reschedule ? batch.nextSyncAt : null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Connector sync job failed.";
    if (error instanceof SyncJobNotRunnableError) {
      return { status: "skipped" as const, jobId: job.id, error: message };
    }

    if (isConnectorReauthorizationRequiredError(error)) {
      const safeMessage = error instanceof ConnectorReauthorizationRequiredError
        ? error.message
        : "The provider authorization has expired or was revoked. Reconnect this source to resume automatic sync.";
      await markConnectorReauthorizationRequired({ jobId: job.id, runId, error: safeMessage });
      await recordSyncEventBestEffort({
        workspaceId: job.workspaceId,
        eventName: "connector.sync.failed",
        status: "failed",
        durationMs: boundedDuration(startedAtMs),
      });
      return {
        status: "needs_reauth" as const,
        code: error.code,
        jobId: job.id,
        runId,
        error: safeMessage,
      };
    }

    await failConnectorSyncRun({ jobId: job.id, runId, error: message });
    await recordSyncEventBestEffort({
      workspaceId: job.workspaceId,
      eventName: "connector.sync.failed",
      status: "failed",
      durationMs: boundedDuration(startedAtMs),
    });
    return { status: "failed" as const, jobId: job.id, runId, error: message };
  }
}

type SyncEventInput = Parameters<typeof recordProductEvent>[0];

async function recordSyncEventBestEffort(input: Omit<SyncEventInput, "source">) {
  try {
    await recordProductEvent({ ...input, source: "sync-runner" });
  } catch {
    // Telemetry is deliberately non-blocking; the sync job remains the source
    // of truth for operational failures.
  }
}

function boundedDuration(startedAtMs: number) {
  return Math.max(0, Math.min(86_400_000, Date.now() - startedAtMs));
}
