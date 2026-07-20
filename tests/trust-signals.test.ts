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
  "GOOGLE_OAUTH_VERIFICATION_COMPLETE",
  "ACCOUNT_AGGREGATOR_PARTNER_STATUS",
  "UPI_MANDATE_PARTNER_STATUS",
  "CARD_MANDATE_PARTNER_STATUS",
  "SYNC_SCHEDULER_STATUS",
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
    assert.equal(signals.length, 9);
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
    GOOGLE_OAUTH_VERIFICATION_COMPLETE: "true",
    ACCOUNT_AGGREGATOR_PARTNER_STATUS: "production-live",
    UPI_MANDATE_PARTNER_STATUS: "production-live",
    CARD_MANDATE_PARTNER_STATUS: "production-live",
    SYNC_SCHEDULER_STATUS: "production-live",
    RETENTION_SCHEDULER_STATUS: "production-live",
    RENEWAL_ALERT_DELIVERY_STATUS: "production-live",
  }, () => {
    const byId = new Map(getPublicTrustSignals().map((signal) => [signal.id, signal]));
    assert.equal(byId.get("session-signing")?.state, "configured");
    assert.equal(byId.get("token-vault")?.state, "configured");
    assert.equal(byId.get("backups")?.state, "proven");
    assert.equal(byId.get("gmail-verification")?.state, "proven");
    assert.equal(byId.get("bank-rails")?.state, "proven");
    assert.equal(byId.get("sync-scheduler")?.state, "proven");
    assert.equal(byId.get("retention-scheduler")?.state, "proven");
    assert.equal(byId.get("renewal-alert-delivery")?.state, "proven");
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

test("a dated restore-drill attestation appears in the proven backup detail", () => {
  withEnvironment({
    BACKUP_STORAGE_BUCKET: "vognary-backups",
    BACKUP_RESTORE_DRILL_STATUS: "passed",
    BACKUP_RESTORE_DRILL_AT: "2026-07-19",
    BACKUP_KEY_FINGERPRINT: "test-fingerprint",
  }, () => {
    const byId = new Map(getPublicTrustSignals().map((signal) => [signal.id, signal]));
    assert.equal(byId.get("backups")?.state, "proven");
    assert.match(byId.get("backups")?.detail ?? "", /2026-07-19/);
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
    assert.equal(byId.get("backups")?.state, "proven");
    assert.ok(!(byId.get("backups")?.detail ?? "").includes("not-a-date"));
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
