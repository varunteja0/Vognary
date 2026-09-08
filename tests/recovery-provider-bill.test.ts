import assert from "node:assert/strict";
import test from "node:test";
import { sourceTypes } from "../src/lib/recovery/contracts";
import { activeRecoveryCaptureSourceTypes, assertActiveRecoveryCapture } from "../src/lib/recovery/ingestion-envelope";
import { normalizeEvidenceRequest } from "../src/lib/server/recovery-api";
import { controlProviderBillWorkspaceEnabled } from "../src/lib/server/recovery-provider-bill-store";

test("Books is canonical evidence but is never a public receipt or CSV capture source", () => {
  assert.equal((sourceTypes as readonly string[]).includes("ZOHO_BOOKS"), true);
  assert.deepEqual(activeRecoveryCaptureSourceTypes, ["RECEIPT_PASTE", "CSV_IMPORT", "FORWARDED_EMAIL"]);
  assert.throws(() => assertActiveRecoveryCapture("ZOHO_BOOKS" as never), /not an active/i);
  assert.throws(() => normalizeEvidenceRequest({ kind: "ZOHO_BOOKS", totalMinor: "12345", currency: "INR" }));
  assert.throws(() => normalizeEvidenceRequest({ kind: "ZOHO_BOOKS", sources: [] }), /RECEIPT_PASTE or CSV_IMPORT/i);
});

test("provider admission has a separate fail-closed flag and never bypasses Control enrollment or Zoho scope", () => {
  const workspaceId = "a2000000-0000-4000-8000-000000000001";
  const keys = ["NODE_ENV", "CONTROL_PROVIDER_BILL_WORKSPACE_IDS", "COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS", "COMMITMENT_CONTROL_PAID_WORKSPACE_IDS", "ZOHO_BOOKS_PILOT_WORKSPACE_IDS"];
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  try {
    Reflect.set(process.env, "NODE_ENV", "test");
    process.env.COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS = "*";
    process.env.ZOHO_BOOKS_PILOT_WORKSPACE_IDS = "*";
    delete process.env.CONTROL_PROVIDER_BILL_WORKSPACE_IDS;
    assert.equal(controlProviderBillWorkspaceEnabled(workspaceId), false);
    process.env.CONTROL_PROVIDER_BILL_WORKSPACE_IDS = "*";
    assert.equal(controlProviderBillWorkspaceEnabled(workspaceId), true);
    delete process.env.ZOHO_BOOKS_PILOT_WORKSPACE_IDS;
    assert.equal(controlProviderBillWorkspaceEnabled(workspaceId), false);
    process.env.ZOHO_BOOKS_PILOT_WORKSPACE_IDS = "*";
    delete process.env.COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS;
    assert.equal(controlProviderBillWorkspaceEnabled(workspaceId), false);
    process.env.COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS = "*";
    process.env.CONTROL_PROVIDER_BILL_WORKSPACE_IDS = `invalid,${workspaceId}`;
    assert.equal(controlProviderBillWorkspaceEnabled(workspaceId), false);
    Reflect.set(process.env, "NODE_ENV", "production");
    process.env.CONTROL_PROVIDER_BILL_WORKSPACE_IDS = "*";
    process.env.COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS = workspaceId;
    process.env.ZOHO_BOOKS_PILOT_WORKSPACE_IDS = workspaceId;
    assert.equal(controlProviderBillWorkspaceEnabled(workspaceId), false);
    process.env.CONTROL_PROVIDER_BILL_WORKSPACE_IDS = workspaceId;
    delete process.env.COMMITMENT_CONTROL_PAID_WORKSPACE_IDS;
    assert.equal(controlProviderBillWorkspaceEnabled(workspaceId), false);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
