import "server-only";

import { LEGACY_LEDGER_WRITE_FROZEN_MESSAGE } from "@/lib/server/legacy-ledger-freeze";

export async function runConnectorSyncJob(jobId: string) {
  return {
    status: "failed" as const,
    jobId,
    error: LEGACY_LEDGER_WRITE_FROZEN_MESSAGE,
  };
}
