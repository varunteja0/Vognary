import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { productionFeatureMigrations } from "../src/lib/server/feature-readiness";
import {
  getReceiptInboxLaunchReadiness,
  isReceiptInboxPubliclyAvailable,
} from "../src/lib/server/recovery-inbound-store";

test("receipt forwarding readiness includes the complete cutover ledger without counting its own account as legacy", () => {
  assert.deepEqual(productionFeatureMigrations.slice(-25), [
    "0023_recovery_v1",
    "0024_recovery_inbound_receipts",
    "0025_recovery_renewal_alerts",
    "0026_recovery_inbound_retention",
    "0027_gmail_forwarding_verification",
    "0028_recovery_gmail_oauth_source",
    "0029_legacy_tenant_integrity",
    "0030_legacy_tenant_ownership_immutable",
    "0031_autopilot_loop",
    "0032_autopilot_proof_integrity",
    "0033_autopilot_integrity",
    "0034_autopilot_repair",
    "0035_autopilot_codex_repair",
    "0036_autopilot_notice_hold",
    "0037_autopilot_clock_integrity",
    "0038_autopilot_reconcile_integrity",
    "0039_autopilot_frozen_notice_integrity",
    "0040_autopilot_review_integrity",
    "0041_workspace_activation_integrity",
    "0042_workspace_activation_semantic_reset",
    "0043_workspace_activation_semantic_version",
    "0044_autopilot_audit_immutability",
    "0045_autopilot_mandate_execution_immutability",
    "0046_billed_window_immutability",
    "0047_billed_window_insert_immutability",
  ], "Production readiness must require every Recovery and Autopilot migration.");
  const source = readFileSync("src/lib/server/feature-readiness.ts", "utf8");
  assert.match(source, /metadata ->> 'ledgerAuthority'[\s\S]*<> 'RECOVERY_V1'/);
});

const allValues = {
  DATABASE_URL: "postgresql://vognary.test/vognary",
  ENABLE_RECEIPT_INBOX: "true",
  RESEND_RECEIVING_API_KEY: "re_receiving_test",
  RESEND_INBOUND_WEBHOOK_SECRET: "whsec_receiving_test",
  RESEND_RECEIVING_DOMAIN: "receipts.vognary.test",
  RECEIPT_INBOX_ALIAS_HMAC_SECRET: "22".repeat(32),
  RECEIPT_INBOX_ALIAS_HMAC_KEY_ID: "receipt-alias-v1",
  TOKEN_ENCRYPTION_KEY: "11".repeat(32),
  SESSION_SECRET: "receipt-readiness-session-secret-at-least-32-bytes",
  GOOGLE_AUTH_CLIENT_ID: "receipt-readiness-google-client-id",
  GOOGLE_AUTH_CLIENT_SECRET: "receipt-readiness-google-client-secret",
  RECEIPT_INBOX_PROVIDER_STATUS: "production-live",
  RECEIPT_INBOX_WEBHOOK_PROOF_STATUS: "passed",
  RECEIPT_INBOX_REPLAY_PROOF_STATUS: "passed",
  RECEIPT_INBOX_RETENTION_REVIEW_STATUS: "approved",
} as const;

test("receipt forwarding remains hidden until configuration and operator evidence are complete", async () => {
  const restore = setEnvironment(Object.fromEntries(Object.keys(allValues).map((key) => [key, undefined])));
  try {
    const unavailable = getReceiptInboxLaunchReadiness();
    assert.equal(unavailable.status, "activation-pending");
    assert.ok(unavailable.missing.includes("DATABASE_URL"));
    assert.ok(unavailable.missing.includes("SESSION_SECRET"));
    assert.ok(unavailable.missing.includes("GOOGLE_AUTH_CLIENT_ID"));

    const configuredOnly = setEnvironment({
      ...allValues,
      RECEIPT_INBOX_WEBHOOK_PROOF_STATUS: undefined,
    });
    try {
      const pending = getReceiptInboxLaunchReadiness();
      assert.equal(pending.status, "activation-pending");
      assert.ok(pending.missing.includes("RECEIPT_INBOX_WEBHOOK_PROOF_STATUS=passed"));
    } finally {
      configuredOnly();
    }

    const noIdentity = setEnvironment({
      ...allValues,
      GOOGLE_AUTH_CLIENT_ID: undefined,
      GOOGLE_AUTH_CLIENT_SECRET: undefined,
      SESSION_SECRET: undefined,
    });
    try {
      assert.equal(await isReceiptInboxPubliclyAvailable({ hasRequiredMigrations: async () => true }), false);
      const pending = getReceiptInboxLaunchReadiness();
      assert.ok(pending.missing.includes("SESSION_SECRET"));
      assert.ok(pending.missing.includes("GOOGLE_AUTH_CLIENT_ID"));
      assert.ok(pending.missing.includes("GOOGLE_AUTH_CLIENT_SECRET"));
    } finally {
      noIdentity();
    }

    const complete = setEnvironment(allValues);
    try {
      assert.deepEqual(getReceiptInboxLaunchReadiness(), { status: "ready", missing: [] });
      assert.equal(await isReceiptInboxPubliclyAvailable({
        hasRequiredMigrations: async () => false,
        hasCleanRecoveryCutover: async () => true,
      }), false);
      assert.equal(await isReceiptInboxPubliclyAvailable({
        hasRequiredMigrations: async () => true,
        hasCleanRecoveryCutover: async () => false,
      }), false);
      assert.equal(await isReceiptInboxPubliclyAvailable({
        hasRequiredMigrations: async () => true,
        hasCleanRecoveryCutover: async () => true,
      }), true);
      assert.equal(await isReceiptInboxPubliclyAvailable({
        hasRequiredMigrations: async () => { throw new Error("database unavailable"); },
        hasCleanRecoveryCutover: async () => true,
      }), false);
    } finally {
      complete();
    }

    const malformed = setEnvironment({
      ...allValues,
      RESEND_RECEIVING_DOMAIN: "not a receiving domain",
    });
    try {
      const invalid = getReceiptInboxLaunchReadiness();
      assert.equal(invalid.status, "activation-pending");
      assert.ok(invalid.missing.some((reason) => /receiving_domain is invalid/i.test(reason)));
      assert.equal(await isReceiptInboxPubliclyAvailable({ hasRequiredMigrations: async () => true }), false);
    } finally {
      malformed();
    }
  } finally {
    restore();
  }
});

function setEnvironment(values: Record<string, string | undefined>) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}
