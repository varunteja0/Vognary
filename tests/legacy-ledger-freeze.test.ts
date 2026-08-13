import assert from "node:assert/strict";
import test from "node:test";

import {
  LEGACY_LEDGER_WRITE_FROZEN_MESSAGE,
  LegacyLedgerWriteFrozenError,
  refuseLegacyLedgerWrite,
} from "../src/lib/server/legacy-ledger-freeze";
import { runConnectorSyncJob } from "../src/lib/server/connector-sync-runner";
import { materializeConnectorBatch } from "../src/lib/server/living-ledger-store";
import { persistConnectorEvidenceBatch } from "../src/lib/server/sync-job-store";

test("legacy ledger helpers refuse writes before touching PostgreSQL", async () => {
  assert.throws(
    () => refuseLegacyLedgerWrite(),
    (error: unknown) => {
      assert.ok(error instanceof LegacyLedgerWriteFrozenError);
      assert.equal(error.code, "LEGACY_LEDGER_WRITES_FROZEN");
      assert.equal(error.message, LEGACY_LEDGER_WRITE_FROZEN_MESSAGE);
      return true;
    },
  );
  await assert.rejects(
    () => materializeConnectorBatch({
      workspaceId: "workspace-1",
      connectedAccountId: "account-1",
      connectorId: "gmail-readonly",
      syncRunId: "run-1",
      batch: {
        evidence: [],
        observations: [],
        nextCursorState: {},
        nextSyncAt: null,
        coverage: { endAt: "2026-08-13T00:00:00.000Z", completeness: "complete" },
        continuation: false,
        activationState: "active",
      },
    }),
    LegacyLedgerWriteFrozenError,
  );
  await assert.rejects(
    () => persistConnectorEvidenceBatch({
      workspaceId: "workspace-1",
      syncRunId: "run-1",
      evidence: [],
    }),
    LegacyLedgerWriteFrozenError,
  );
});

test("the connector sync runner fails closed without a living-ledger write", async () => {
  const result = await runConnectorSyncJob("missing-job");
  assert.equal(result.status, "failed");
  assert.equal(result.jobId, "missing-job");
  assert.equal(result.error, LEGACY_LEDGER_WRITE_FROZEN_MESSAGE);
});
