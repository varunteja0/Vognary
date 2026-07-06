import { buildEnvironmentConnection, getConnectorAdapter } from "@/lib/connectors/adapter-registry";
import {
  beginConnectorSyncRun,
  completeConnectorSyncRun,
  failConnectorSyncRun,
  getConnectorSyncJob,
  persistConnectorEvidenceBatch,
} from "@/lib/server/sync-job-store";

export async function runConnectorSyncJob(jobId: string) {
  const job = await getConnectorSyncJob(jobId);
  if (!job) return { status: "not-found" as const, jobId };

  const adapter = getConnectorAdapter(job.connectorId);
  if (!adapter) {
    await failConnectorSyncRun({ jobId: job.id, error: `No adapter registered for ${job.connectorId}.` });
    return { status: "failed" as const, jobId: job.id, error: `No adapter registered for ${job.connectorId}.` };
  }

  const runId = await beginConnectorSyncRun(job);
  if (!runId) throw new Error("Sync run insert did not return an id.");

  try {
    const connection = await adapter.connect(buildEnvironmentConnection(job.connectorId, job.workspaceId));
    const evidence = await adapter.sync(connection);
    const evidenceWritten = await persistConnectorEvidenceBatch({
      workspaceId: job.workspaceId,
      connectedAccountId: job.connectedAccountId,
      syncRunId: runId,
      evidence,
    });

    await completeConnectorSyncRun({
      jobId: job.id,
      runId,
      recordsSeen: evidence.length,
      recordsWritten: evidenceWritten,
      evidenceWritten,
    });

    return {
      status: "succeeded" as const,
      jobId: job.id,
      runId,
      evidenceSeen: evidence.length,
      evidenceWritten,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Connector sync job failed.";
    await failConnectorSyncRun({ jobId: job.id, runId, error: message });
    return { status: "failed" as const, jobId: job.id, runId, error: message };
  }
}