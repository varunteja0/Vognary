import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const profileRoute = readFileSync("src/app/api/profile/route.ts", "utf8");
const profileSections = readFileSync("src/app/profile/profile-sections.tsx", "utf8");
const privacyStore = readFileSync("src/lib/server/privacy-lifecycle-store.ts", "utf8");
const connectorDeleteRoute = readFileSync("src/app/api/workspaces/current/connectors/[accountId]/route.ts", "utf8");
const receiptRoute = readFileSync("src/app/api/workspaces/current/sources/receipt-inbox/route.ts", "utf8");
const receiptStore = readFileSync("src/lib/server/recovery-inbound-store.ts", "utf8");

test("Account inventory counts canonical Recovery data instead of legacy tables alone", () => {
  assert.match(profileRoute, /from recovery_workspace_states/);
  assert.match(profileRoute, /from recovery_sources/);
  assert.match(profileRoute, /from recovery_commitments/);
  assert.match(profileRoute, /from recovery_evidence/);
  assert.match(profileRoute, /metadata ->> 'ledgerAuthority'/);
  assert.match(profileRoute, /status = 'active'/);
  assert.doesNotMatch(profileRoute, /metadata ->> 'ledgerAuthority' is null/);
  assert.match(profileRoute, /account\.connector_id <> 'receipt-inbox'/);
  assert.match(profileSections, /label="Subscriptions"/);
  assert.match(profileSections, /label="Receipt and source records"/);
  assert.doesNotMatch(profileSections, /label="Recurring items"|label="Connector evidence"/);
});

test("privacy export includes receipt inbox lifecycle without routing capabilities", () => {
  assert.match(privacyStore, /as inbound_aliases/);
  assert.match(privacyStore, /as inbound_events/);
  assert.match(privacyStore, /inboundAliases: recovery\.inbound_aliases/);
  assert.match(privacyStore, /inboundEvents: recovery\.inbound_events/);
  assert.match(privacyStore, /as standing_mandates/);
  assert.match(privacyStore, /standingMandates: recovery\.standing_mandates/);
  const aliasProjection = privacyStore.match(/select id, connected_account_id[\s\S]*?from recovery_inbound_aliases/)?.[0] ?? "";
  const eventProjection = privacyStore.match(/select id, provider, event_type[\s\S]*?from recovery_inbound_events/)?.[0] ?? "";
  assert.doesNotMatch(aliasProjection, /alias_hmac|encrypted_display|hmac_key_id/);
  assert.doesNotMatch(eventProjection, /svix_id|provider_email_id|payload_hash/);
  assert.match(privacyStore, /recovery_commitment_id/);
  assert.match(privacyStore, /recoveryCommitmentId: row\.recovery_commitment_id/);
});

test("every receipt-account deletion path uses canonical alias revocation even after configuration is disabled", () => {
  assert.match(connectorDeleteRoute, /account\.connectorId === "receipt-inbox"/);
  assert.match(connectorDeleteRoute, /revokeReceiptInbox/);
  assert.match(receiptRoute, /configurationRequired: false/);
  const revokeFunction = receiptStore.slice(receiptStore.indexOf("export async function revokeReceiptInbox"), receiptStore.indexOf("export async function getReceiptInboxStatus"));
  assert.doesNotMatch(revokeFunction, /requireReceiptInboxConfiguration/);
  assert.match(revokeFunction, /status = 'REVOKED'/);
  assert.match(revokeFunction, /ALIAS_REVOKED/);
  assert.match(revokeFunction, /status in \('RECEIVED', 'PROCESSING'\)/);
});

test("account deletion revokes the departing user's receipt inbox before withdrawing consents", () => {
  const deletion = profileRoute.slice(profileRoute.indexOf("async function deleteUserData"));
  assert.match(profileRoute, /lockAutopilotAuthorityGate/);
  assert.match(deletion, /applyReceiptInboxRevocation/);
  assert.match(deletion, /receipt-inbox-ingest/);
  const authorityIndex = deletion.indexOf("lockAutopilotAuthorityGate(client)");
  const inboxLockIndex = deletion.indexOf("receipt-inbox:${workspaceId}");
  const userLockIndex = deletion.indexOf("select id from users where id = $1 for update");
  assert.ok(authorityIndex >= 0 && inboxLockIndex > authorityIndex, "Account deletion must take the Autopilot authority gate before inbox locks.");
  assert.ok(userLockIndex > inboxLockIndex, "Account deletion must take inbox locks before user/workspace rows.");
  const revokeIndex = deletion.indexOf("applyReceiptInboxRevocation");
  const withdrawIndex = deletion.indexOf("update consent_grants");
  assert.ok(revokeIndex >= 0 && withdrawIndex > revokeIndex, "Inbox revocation must run before consent rows are withdrawn.");
  assert.match(deletion, /receipt-inbox:\$\{/);
});
