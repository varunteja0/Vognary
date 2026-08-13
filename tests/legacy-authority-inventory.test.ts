import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { GET as gmailStartGet } from "../src/app/api/integrations/gmail/start/route";
import { GET as gmailCallbackGet } from "../src/app/api/integrations/gmail/callback/route";

const productionReachableLegacyWriterInventory = [
  { path: "src/app/api/integrations/gmail/start/route.ts", disposition: "http-410", marker: "legacyConnectorRetiredResponse" },
  { path: "src/app/api/integrations/gmail/callback/route.ts", disposition: "http-410", marker: "status: 410" },
  { path: "src/app/api/connectors/route.ts", disposition: "http-410", marker: "legacyConnectorRetiredResponse" },
  { path: "src/app/api/connectors/[id]/start/route.ts", disposition: "http-410", marker: "legacyConnectorRetiredResponse" },
  { path: "src/app/api/connectors/[id]/sync/route.ts", disposition: "http-410", marker: "legacyConnectorRetiredResponse" },
  { path: "src/app/api/connectors/[id]/webhook/route.ts", disposition: "http-410", marker: "legacyConnectorRetiredResponse" },
  { path: "src/app/api/integrations/aa/start/route.ts", disposition: "http-410", marker: "legacyConnectorRetiredResponse" },
  { path: "src/app/api/workspaces/current/connectors/[accountId]/sync/route.ts", disposition: "http-410", marker: "legacyConnectorRetiredResponse" },
  { path: "src/app/api/internal/sync-jobs/route.ts", disposition: "http-410", marker: "legacyConnectorRetiredResponse" },
  { path: "src/app/api/internal/sync-jobs/[id]/run/route.ts", disposition: "http-410", marker: "legacyConnectorRetiredResponse" },
  { path: "src/app/api/internal/sync-jobs/due/run/route.ts", disposition: "http-410", marker: "legacyConnectorRetiredResponse" },
  { path: "src/app/api/workspaces/current/audit-snapshot/route.ts", disposition: "http-410", marker: "status: 410" },
  { path: "src/app/api/workspaces/current/decisions/route.ts", disposition: "http-410", marker: "status: 410" },
  { path: "src/lib/server/connector-sync-runner.ts", disposition: "throw-before-db", marker: "LEGACY_LEDGER_WRITE_FROZEN" },
  { path: "src/lib/server/living-ledger-store.ts", disposition: "throw-before-db", marker: "refuseLegacyLedgerWrite", scope: "export async function materializeConnectorBatch" },
  { path: "src/lib/server/sync-job-store.ts", disposition: "throw-before-db", marker: "refuseLegacyLedgerWrite", scope: "export async function persistConnectorEvidenceBatch" },
  { path: "src/lib/server/retention-executor.ts", disposition: "privacy-minimization-allowed", marker: "payload_minimized_at" },
  { path: "src/lib/server/privacy-lifecycle-store.ts", disposition: "privacy-export-delete-allowed", marker: "privacy.export" },
  { path: "src/lib/server/audit-snapshot-store.ts", disposition: "privacy-fixture-not-http", marker: "saveAuditSnapshot" },
  { path: "src/lib/server/workspace-state-materializer.ts", disposition: "privacy-fixture-not-http", marker: "insert into recurring_items" },
] as const;

test("every production-reachable legacy financial writer is 410, frozen before PostgreSQL, or privacy-only", () => {
  assert.ok(productionReachableLegacyWriterInventory.length >= 16);
  for (const writer of productionReachableLegacyWriterInventory) {
    const source = readFileSync(writer.path, "utf8");
    assert.match(source, new RegExp(writer.marker));
    if (writer.disposition === "http-410") {
      assert.match(source, /410|legacyConnectorRetiredResponse|legacyConnectorRetirementPayload/);
    }
    if (writer.disposition === "throw-before-db") {
      const scoped = "scope" in writer && writer.scope
        ? source.slice(source.indexOf(writer.scope))
        : source;
      const refuseAt = scoped.search(/refuseLegacyLedgerWrite\(|LEGACY_LEDGER_WRITE_FROZEN/);
      const connectAt = scoped.search(/getDatabasePool\(\)\.(connect|query)\(/);
      assert.ok(refuseAt >= 0, `${writer.path} must refuse legacy writes`);
      if (connectAt >= 0) {
        assert.ok(refuseAt < connectAt, `${writer.path} must throw before acquiring a PostgreSQL client`);
      }
    }
  }
});

test("Gmail HTTP routes remain 410 even when Google verification env is set", async () => {
  process.env.GOOGLE_OAUTH_VERIFICATION_COMPLETE = "true";
  process.env.ENABLE_GMAIL_OAUTH = "true";
  try {
    const start = await gmailStartGet();
    const callback = await gmailCallbackGet();
    assert.equal(start.status, 410);
    assert.equal(callback.status, 410);
  } finally {
    delete process.env.GOOGLE_OAUTH_VERIFICATION_COMPLETE;
    delete process.env.ENABLE_GMAIL_OAUTH;
  }
});
