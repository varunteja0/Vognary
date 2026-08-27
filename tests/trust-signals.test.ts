import assert from "node:assert/strict";
import test from "node:test";

import { getPublicTrustSignals } from "../src/lib/server/trust-signals";

const names = [
  "SESSION_SECRET",
  "TOKEN_ENCRYPTION_KEY",
  "BACKUP_STORAGE_BUCKET",
  "S3_BUCKET",
  "R2_BUCKET",
  "BACKUP_RESTORE_DRILL_STATUS",
  "BACKUP_RESTORE_DRILL_AT",
  "BACKUP_KEY_FINGERPRINT",
  "BACKUP_ENCRYPTION_KEY",
  "ENABLE_RECEIPT_INBOX",
  "RESEND_RECEIVING_API_KEY",
  "RESEND_INBOUND_WEBHOOK_SECRET",
  "RESEND_RECEIVING_DOMAIN",
  "RECEIPT_INBOX_ALIAS_HMAC_SECRET",
  "RECEIPT_INBOX_ALIAS_HMAC_KEY_ID",
  "RECEIPT_INBOX_PROVIDER_STATUS",
  "RECEIPT_INBOX_WEBHOOK_PROOF_STATUS",
  "RECEIPT_INBOX_REPLAY_PROOF_STATUS",
  "RECEIPT_INBOX_RETENTION_REVIEW_STATUS",
  "RETENTION_SCHEDULER_STATUS",
  "RENEWAL_ALERT_DELIVERY_STATUS",
  "DATABASE_URL",
  "GOOGLE_AUTH_CLIENT_ID",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_AUTH_CLIENT_SECRET",
  "GOOGLE_CLIENT_SECRET",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "NEXT_PUBLIC_APP_URL",
  "APP_URL",
  "COMMITMENT_CONTROL_PILOT_PAYMENT_LINK_URL",
] as const;

function withEnvironment(overrides: Partial<Record<(typeof names)[number], string>>, run: () => void) {
  const saved = new Map(names.map((name) => [name, process.env[name]] as const));
  for (const name of names) delete process.env[name];
  for (const [name, value] of Object.entries(overrides)) {
    if (value !== undefined) process.env[name] = value;
  }
  try {
    run();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("a blank environment proves nothing", () => {
  withEnvironment({}, () => {
    const signals = getPublicTrustSignals();
    assert.equal(signals.length, 8);
    for (const signal of signals) {
      assert.equal(signal.state, "not-yet-proven", `${signal.id} must not claim readiness on blank env`);
    }
  });
});

test("configuration and operator attestations flip the matching signals", () => {
  withEnvironment({
    SESSION_SECRET: "test-session-secret-0123456789abcdef",
    TOKEN_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    BACKUP_STORAGE_BUCKET: "vognary-backups",
    BACKUP_RESTORE_DRILL_STATUS: "passed",
    BACKUP_KEY_FINGERPRINT: "test-fingerprint",
    DATABASE_URL: "postgresql://vognary.test/vognary",
    GOOGLE_AUTH_CLIENT_ID: "trust-signal-google-client-id",
    GOOGLE_AUTH_CLIENT_SECRET: "trust-signal-google-client-secret",
    ENABLE_RECEIPT_INBOX: "true",
    RESEND_RECEIVING_API_KEY: "re_receiving_test",
    RESEND_INBOUND_WEBHOOK_SECRET: "whsec_receiving_test",
    RESEND_RECEIVING_DOMAIN: "receipts.vognary.test",
    RECEIPT_INBOX_ALIAS_HMAC_SECRET: "22".repeat(32),
    RECEIPT_INBOX_ALIAS_HMAC_KEY_ID: "receipt-alias-v1",
    RECEIPT_INBOX_PROVIDER_STATUS: "production-live",
    RECEIPT_INBOX_WEBHOOK_PROOF_STATUS: "passed",
    RECEIPT_INBOX_REPLAY_PROOF_STATUS: "passed",
    RECEIPT_INBOX_RETENTION_REVIEW_STATUS: "approved",
    RETENTION_SCHEDULER_STATUS: "production-live",
    RENEWAL_ALERT_DELIVERY_STATUS: "production-live",
  }, () => {
    const byId = new Map(getPublicTrustSignals().map((signal) => [signal.id, signal]));
    assert.equal(byId.get("session-signing")?.state, "configured");
    assert.equal(byId.get("token-vault")?.state, "configured");
    assert.equal(byId.get("backups")?.state, "configured");
    assert.match(byId.get("backups")?.detail ?? "", /recorded restore of the stored object/i);
    assert.equal(byId.get("receipt-inbox")?.state, "configured");
    assert.equal(byId.get("retention-scheduler")?.state, "proven");
    assert.equal(byId.get("renewal-alert-delivery")?.state, "proven");
    assert.equal(byId.get("pilot-payment-collection")?.state, "not-yet-proven");
  });
});

test("partial backup configuration stays below proven", () => {
  withEnvironment({
    BACKUP_STORAGE_BUCKET: "vognary-backups",
  }, () => {
    const byId = new Map(getPublicTrustSignals().map((signal) => [signal.id, signal]));
    assert.equal(byId.get("backups")?.state, "configured");
    assert.match(byId.get("backups")?.detail ?? "", /restore drill has not been recorded/i);
  });
});

test("a restore-drill attestation without stored-object evidence stays configured", () => {
  withEnvironment({
    BACKUP_STORAGE_BUCKET: "vognary-backups",
    BACKUP_RESTORE_DRILL_STATUS: "passed",
    BACKUP_RESTORE_DRILL_AT: "2026-07-19",
    BACKUP_KEY_FINGERPRINT: "test-fingerprint",
  }, () => {
    const byId = new Map(getPublicTrustSignals().map((signal) => [signal.id, signal]));
    assert.equal(byId.get("backups")?.state, "configured");
    assert.doesNotMatch(byId.get("backups")?.detail ?? "", /2026-07-19/);
  });
});

test("a matching stored-object restore record can prove backups", () => {
  withEnvironment({
    R2_BUCKET: "vognary-postgres-backups",
    BACKUP_RESTORE_DRILL_STATUS: "passed",
    BACKUP_KEY_FINGERPRINT: "8it2LaCH1w__ilS1",
  }, () => {
    const byId = new Map(getPublicTrustSignals().map((signal) => [signal.id, signal]));
    assert.equal(byId.get("backups")?.state, "proven");
    assert.match(byId.get("backups")?.detail ?? "", /downloaded and restored/i);
    assert.match(byId.get("backups")?.detail ?? "", /2026-08-18/);
  });
});

test("a malformed restore-drill date is ignored, never rendered", () => {
  withEnvironment({
    BACKUP_STORAGE_BUCKET: "vognary-backups",
    BACKUP_RESTORE_DRILL_STATUS: "passed",
    BACKUP_RESTORE_DRILL_AT: "not-a-date",
    BACKUP_KEY_FINGERPRINT: "test-fingerprint",
  }, () => {
    const byId = new Map(getPublicTrustSignals().map((signal) => [signal.id, signal]));
    assert.equal(byId.get("backups")?.state, "configured");
    assert.ok(!(byId.get("backups")?.detail ?? "").includes("not-a-date"));
  });
});

test("a valid Razorpay Payment Link configures private-pilot collection without proving a paid customer", () => {
  withEnvironment({
    COMMITMENT_CONTROL_PILOT_PAYMENT_LINK_URL: "https://rzp.io/l/vognary-pilot",
  }, () => {
    const byId = new Map(getPublicTrustSignals().map((signal) => [signal.id, signal]));
    assert.equal(byId.get("pilot-payment-collection")?.state, "configured");
    assert.match(byId.get("pilot-payment-collection")?.detail ?? "", /not a paid customer/i);
    assert.doesNotMatch(byId.get("pilot-payment-collection")?.detail ?? "", /rzp\.io|COMMITMENT_CONTROL/i);
  });
});

test("details never name environment variables", () => {
  withEnvironment({}, () => {
    for (const signal of getPublicTrustSignals()) {
      for (const name of names) {
        assert.ok(!signal.detail.includes(name), `${signal.id} detail leaks ${name}`);
        assert.ok(!signal.label.includes(name), `${signal.id} label leaks ${name}`);
      }
    }
  });
});
