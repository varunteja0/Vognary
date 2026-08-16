import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const processor = readFileSync("src/lib/server/recovery-inbound-processor.ts", "utf8");
const recoveryStore = readFileSync("src/lib/server/recovery-store.ts", "utf8");
const inboundStore = readFileSync("src/lib/server/recovery-inbound-store.ts", "utf8");

test("provider replay keys are durably reserved before a transport event is created", () => {
  assert.match(processor, /recovery_inbound_replay_keys/);
  assert.match(processor, /createHash\("sha256"\)\.update\(event\.svixId\)/);
  assert.match(processor, /createHash\("sha256"\)\.update\(event\.emailId\)/);
  const replayInsert = processor.indexOf("insert into recovery_inbound_replay_keys");
  const eventInsert = processor.indexOf("insert into recovery_inbound_events");
  assert.ok(replayInsert >= 0 && eventInsert > replayInsert);
  assert.match(processor, /replayKeys\.rows\.length !== 2/);
});

test("forwarded materialization idempotency is stable after transport-event retention", () => {
  const materialization = recoveryStore.slice(
    recoveryStore.indexOf("export async function materializeForwardedEmailEvidence"),
    recoveryStore.indexOf("export async function getRecoveryHome"),
  );
  assert.match(materialization, /hashRecoveryRequest\(\{ operation, providerEventId: input\.providerEventId, currencyHint, request \}\)/);
  assert.doesNotMatch(materialization, /hashRecoveryRequest\(\{ operation, inboundEventId/);
});

test("existing inbound events on a revoked alias cannot be reserved for later processing", () => {
  assert.match(processor, /alias_status !== "ACTIVE"/);
  assert.match(processor, /left join recovery_inbound_aliases alias on alias.id = event.alias_id/);
});

test("reservation locks the alias and re-checks live inbox authority before claiming a lease", () => {
  const reserve = processor.slice(
    processor.indexOf("async function reserveInboundEvent"),
    processor.indexOf("async function releaseForRetry"),
  );
  assert.match(reserve, /lockReceiptInboxAuthority/);
  const lock = inboundStore.slice(
    inboundStore.indexOf("export async function lockReceiptInboxAuthority"),
    inboundStore.indexOf("async function readActiveAlias"),
  );
  assert.match(lock, /for update of alias, account/i);
  assert.match(lock, /consent_grants where id = \$1 for update/);
  assert.match(lock, /recovery_inbound_aliases/);
  assert.match(lock, /connected_accounts/);
  assert.match(lock, /consent_grants/);
  assert.match(lock, /alias_status === "ACTIVE"/);
});

test("receipt-inbox consent withdrawal uses canonical inbox revocation", () => {
  const consentStore = readFileSync("src/lib/server/consent-store.ts", "utf8");
  const withdraw = consentStore.slice(
    consentStore.indexOf("export async function withdrawConsentGrant"),
    consentStore.indexOf("export async function hasActiveConsentGrant"),
  );
  assert.match(withdraw, /receipt-inbox-ingest/);
  assert.match(withdraw, /revokeReceiptInbox|applyReceiptInboxRevocation/);
  assert.match(withdraw, /consentId:\s*owned\.rows\[0\]\.id|consentId:\s*grant\.id/);
  assert.match(withdraw, /standing-mandate-autopilot/);
  assert.match(withdraw, /revokeActiveStandingMandateForConsentWithdrawal/);
  const rotate = inboundStore.slice(
    inboundStore.indexOf("export async function rotateReceiptInbox"),
    inboundStore.indexOf("export async function revokeReceiptInbox"),
  );
  assert.match(rotate, /invalidateInboundLeases\(client, input\.workspaceId, active\.id\)/);
  const revoker = inboundStore.slice(
    inboundStore.indexOf("export async function applyReceiptInboxRevocation"),
    inboundStore.indexOf("async function invalidateInboundLeases"),
  );
  assert.match(revoker, /consentId/);
  assert.match(revoker, /consent_grant_id !== input\.consentId/);
});

test("forwarded materialization re-checks alias, account, and consent inside the lease transaction", () => {
  const materialization = recoveryStore.slice(
    recoveryStore.indexOf("export async function materializeForwardedEmailEvidence"),
    recoveryStore.indexOf("export async function getRecoveryHome"),
  );
  assert.match(materialization, /lockReceiptInboxAuthority/);
  assert.match(materialization, /ALIAS_REVOKED/);
});

test("forwarded materialization treats a missing alias as revoked, not live", () => {
  const materialization = recoveryStore.slice(
    recoveryStore.indexOf("export async function materializeForwardedEmailEvidence"),
    recoveryStore.indexOf("export async function getRecoveryHome"),
  );
  assert.doesNotMatch(
    materialization,
    /alias_id[\s\S]{0,220}\{\s*live:\s*true,\s*aliasStatus:\s*null\s*\}/,
    "A PROCESSING event with no alias_id must not be treated as a live inbox.",
  );
  assert.match(materialization, /live:\s*false,\s*aliasStatus:\s*null/);
});
