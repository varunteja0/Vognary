import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { DELETE as withdrawConsent } from "../../src/app/api/privacy/consents/route";
import { GET as getSources } from "../../src/app/api/workspaces/current/sources/route";
import { DELETE as revokeSource, POST as provisionSource } from "../../src/app/api/workspaces/current/sources/receipt-inbox/route";
import { POST as rotateSource } from "../../src/app/api/workspaces/current/sources/receipt-inbox/rotate/route";
import { DELETE as deleteConnectedSource } from "../../src/app/api/workspaces/current/connectors/[accountId]/route";
import type { ApiSuccess, ReceiptInboxStatusDto } from "../../src/lib/recovery/contracts";
import { getDatabasePool } from "../../src/lib/server/database";
import { RecoveryServiceError } from "../../src/lib/server/recovery-api";
import {
  getReceiptInboxStatus,
  provisionReceiptInbox,
  recordGmailForwardingVerification,
  resolveReceiptInboxAlias,
  revokeReceiptInbox,
  rotateReceiptInbox,
} from "../../src/lib/server/recovery-inbound-store";
import { materializeForwardedEmailEvidence, submitRecoveryEvidence } from "../../src/lib/server/recovery-store";
import { processResendReceivedEvent } from "../../src/lib/server/recovery-inbound-processor";
import { ResendInboundRetryableError } from "../../src/lib/server/recovery-inbound-webhook";
import { getRecoveryCutoverStatus } from "../../src/lib/server/recovery-store";
import { runShadowEvaluator, signStandingMandate } from "../../src/lib/server/recovery-autopilot-store";
import { createSessionCookie } from "../../src/lib/server/session";

const databaseConfigured = Boolean(process.env.DATABASE_URL);

const receiptInboxEnvironment = {
  ENABLE_RECEIPT_INBOX: "true",
  RESEND_RECEIVING_API_KEY: "re_receiving_test",
  RESEND_INBOUND_WEBHOOK_SECRET: "whsec_receiving_test",
  RESEND_RECEIVING_DOMAIN: "receipts.vognary.test",
  RECEIPT_INBOX_ALIAS_HMAC_SECRET: "22".repeat(32),
  RECEIPT_INBOX_ALIAS_HMAC_KEY_ID: "receipt-alias-v1",
  TOKEN_ENCRYPTION_KEY: "11".repeat(32),
  SESSION_SECRET: "receipt-inbox-session-secret-at-least-32-bytes",
} as const;

const baseUrl = "https://vognary.test";

test("receipt inbox provision, rotation, and revocation keep routing secret and canonical", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const restoreEnvironment = setEnvironment(receiptInboxEnvironment);
  const pool = getDatabasePool();
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const email = `receipt-inbox-${randomUUID().slice(0, 8)}@example.test`;

  await pool.query(
    `insert into users (id, email, display_name) values ($1, $2, 'Receipt Inbox Owner')`,
    [userId, email],
  );
  await pool.query(
    `insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Receipt Inbox Workspace')`,
    [workspaceId, userId],
  );
  await pool.query(
    `insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`,
    [workspaceId, userId],
  );

  try {
    const [first, concurrent] = await Promise.all([
      provisionReceiptInbox({ workspaceId, actorUserId: userId }),
      provisionReceiptInbox({ workspaceId, actorUserId: userId }),
    ]);
    assert.equal(first.state, "WAITING");
    assert.equal(first.alias?.status, "ACTIVE");
    assert.match(first.alias?.address ?? "", /^rcpt_[0-9a-f]{40}@receipts\.vognary\.test$/);
    assert.equal(concurrent.alias?.address, first.alias?.address);
    assert.equal((await getRecoveryCutoverStatus({ workspaceId, actorUserId: userId })).status, "CLEAR");

    const address = first.alias!.address;
    const localToken = address.split("@")[0];
    const stored = await pool.query<{
      aliases: string;
      accounts: string;
      consents: string;
      alias_hmac: string;
      encrypted_display: string;
      display_name: string;
      metadata: string;
    }>(
      `select
         (select count(*)::text from recovery_inbound_aliases where workspace_id = $1 and status = 'ACTIVE') as aliases,
         (select count(*)::text from connected_accounts where workspace_id = $1 and connector_id = 'receipt-inbox') as accounts,
         (select count(*)::text from consent_grants where workspace_id = $1 and purpose = 'receipt-inbox-ingest' and withdrawn_at is null) as consents,
         alias.alias_hmac,
         alias.encrypted_display::text,
         account.display_name,
         account.metadata::text
       from recovery_inbound_aliases alias
       join connected_accounts account on account.id = alias.connected_account_id
       where alias.workspace_id = $1 and alias.status = 'ACTIVE'`,
      [workspaceId],
    );
    assert.deepEqual(stored.rows[0] && {
      aliases: stored.rows[0].aliases,
      accounts: stored.rows[0].accounts,
      consents: stored.rows[0].consents,
    }, { aliases: "1", accounts: "1", consents: "1" });
    assert.match(stored.rows[0].alias_hmac, /^[0-9a-f]{64}$/);
    assert.equal(stored.rows[0].encrypted_display.includes(localToken), false);
    assert.equal(stored.rows[0].display_name.includes(localToken), false);
    assert.equal(stored.rows[0].metadata.includes(localToken), false);
    assert.equal(JSON.parse(stored.rows[0].metadata).ledgerAuthority, "RECOVERY_V1");

    await recordGmailForwardingVerification({
      workspaceId,
      aliasId: first.alias!.id,
      verification: { code: "473829", verificationUrl: "https://mail-settings.google.com/mail/vf-test" },
    });
    const verified = await pool.query<{ gmail_verification_code: string | null }>(
      `select gmail_verification_code from recovery_inbound_aliases where id = $1`,
      [first.alias!.id],
    );
    assert.equal(verified.rows[0]?.gmail_verification_code, "473829");

    assert.deepEqual(await resolveReceiptInboxAlias(address), { workspaceId, aliasId: await activeAliasId(workspaceId) });
    assert.equal((await getReceiptInboxStatus({ workspaceId, actorUserId: userId })).alias?.address, address);

    const rotation = {
      workspaceId,
      actorUserId: userId,
      expectedAliasId: first.alias!.id,
      idempotencyKey: `rotate-${randomUUID()}`,
    };
    const [rotated, replayedRotation] = await Promise.all([
      rotateReceiptInbox(rotation),
      rotateReceiptInbox(rotation),
    ]);
    assert.equal(rotated.state, "WAITING");
    assert.notEqual(rotated.alias?.address, address);
    assert.equal(replayedRotation.alias?.address, rotated.alias?.address);
    await assert.rejects(
      rotateReceiptInbox({ ...rotation, idempotencyKey: `rotate-${randomUUID()}` }),
      (error: unknown) => error instanceof RecoveryServiceError && error.code === "STALE_STATE",
    );
    assert.equal(await resolveReceiptInboxAlias(address), null);
    assert.equal((await resolveReceiptInboxAlias(rotated.alias!.address))?.workspaceId, workspaceId);

    const aliasRows = await pool.query<{ status: string; encrypted_display: unknown; gmail_verification_code: string | null }>(
      `select status, encrypted_display, gmail_verification_code from recovery_inbound_aliases where workspace_id = $1 order by created_at`,
      [workspaceId],
    );
    assert.deepEqual(aliasRows.rows.map((row) => row.status), ["ROTATED", "ACTIVE"]);
    assert.equal(aliasRows.rows[0].encrypted_display, null);
    assert.equal(aliasRows.rows[0].gmail_verification_code, null);

    await recordGmailForwardingVerification({
      workspaceId,
      aliasId: rotated.alias!.id,
      verification: { code: "918273", verificationUrl: "https://mail-settings.google.com/mail/vf-active" },
    });

    const revoked = await revokeReceiptInbox({ workspaceId, actorUserId: userId });
    assert.equal(revoked.state, "REVOKED");
    assert.equal(revoked.alias, null);
    assert.equal(await resolveReceiptInboxAlias(rotated.alias!.address), null);
    assert.equal((await revokeReceiptInbox({ workspaceId, actorUserId: userId })).state, "REVOKED");

    const revokedCodes = await pool.query<{ n: string }>(
      `select count(*)::text as n from recovery_inbound_aliases
       where workspace_id = $1 and gmail_verification_code is not null`,
      [workspaceId],
    );
    assert.equal(revokedCodes.rows[0]?.n, "0");

    const finalState = await pool.query<{ active_aliases: string; account_status: string; active_consents: string }>(
      `select
         (select count(*)::text from recovery_inbound_aliases where workspace_id = $1 and status = 'ACTIVE') as active_aliases,
         (select status from connected_accounts where workspace_id = $1 and connector_id = 'receipt-inbox') as account_status,
         (select count(*)::text from consent_grants where workspace_id = $1 and purpose = 'receipt-inbox-ingest' and withdrawn_at is null) as active_consents`,
      [workspaceId],
    );
    assert.deepEqual(finalState.rows[0], { active_aliases: "0", account_status: "revoked", active_consents: "0" });
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [userId]);
    restoreEnvironment();
  }
});

test("revoked receipt inbox stops future deliveries; reconnect uses a new alias and keeps prior evidence", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const restoreEnvironment = setEnvironment(receiptInboxEnvironment);
  const pool = getDatabasePool();
  const userId = randomUUID();
  const workspaceId = randomUUID();
  await pool.query(`insert into users (id, email, display_name) values ($1, $2, 'Reconnect Owner')`, [userId, `reconnect-${randomUUID().slice(0, 8)}@example.test`]);
  await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Reconnect Workspace')`, [workspaceId, userId]);
  await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, userId]);

  const receiptMime = (address: string, merchant: string) => [
    "From: billing@example.test",
    `To: ${address}`,
    `Subject: ${merchant} receipt`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    `${merchant} charged INR 1,999 on 6 July 2026. Renews monthly on 6 August 2026.`,
  ].join("\r\n");

  try {
    const inbox = await provisionReceiptInbox({ workspaceId, actorUserId: userId });
    const oldAddress = inbox.alias!.address;
    const firstEvent = {
      svixId: `msg_${randomUUID()}`,
      emailId: `email_${randomUUID()}`,
      recipient: oldAddress,
      createdAt: "2026-08-10T12:00:00.000Z",
      payloadHash: "e".repeat(64),
    };
    assert.deepEqual(
      await processResendReceivedEvent(firstEvent, { retrieveRawEmail: async () => receiptMime(oldAddress, "OpenAI") }),
      { status: "processed" },
    );
    const evidenceBeforeRevoke = Number((await pool.query<{ n: string }>(
      `select count(*)::text as n from recovery_evidence where workspace_id = $1`,
      [workspaceId],
    )).rows[0]?.n ?? 0);
    assert.equal(evidenceBeforeRevoke, 1);

    const inFlight = {
      svixId: `msg_${randomUUID()}`,
      emailId: `email_${randomUUID()}`,
      recipient: oldAddress,
      createdAt: "2026-08-10T12:05:00.000Z",
      payloadHash: "f".repeat(64),
    };
    await pool.query(
      `insert into recovery_inbound_events (
         provider, svix_id, provider_email_id, workspace_id, alias_id,
         event_type, payload_hash, status, attempt_count
       ) values ('RESEND', $1, $2, $3, $4, 'email.received', $5, 'RECEIVED', 0)`,
      [inFlight.svixId, inFlight.emailId, workspaceId, inbox.alias!.id, inFlight.payloadHash],
    );

    const revoked = await revokeReceiptInbox({ workspaceId, actorUserId: userId });
    assert.equal(revoked.state, "REVOKED");
    assert.equal(await resolveReceiptInboxAlias(oldAddress), null);

    let revokedRetrievals = 0;
    const afterRevoke = await processResendReceivedEvent({
      ...firstEvent,
      svixId: `msg_${randomUUID()}`,
      emailId: `email_${randomUUID()}`,
      payloadHash: "aa".repeat(32),
    }, {
      retrieveRawEmail: async () => {
        revokedRetrievals += 1;
        return receiptMime(oldAddress, "Figma");
      },
    });
    assert.deepEqual(afterRevoke, { status: "ignored" });
    assert.equal(revokedRetrievals, 0);

    const inFlightAfterRevoke = await processResendReceivedEvent(inFlight, {
      retrieveRawEmail: async () => {
        revokedRetrievals += 1;
        return receiptMime(oldAddress, "Notion");
      },
    });
    assert.deepEqual(inFlightAfterRevoke, { status: "ignored" });
    assert.equal(revokedRetrievals, 0);
    assert.equal(Number((await pool.query<{ n: string }>(
      `select count(*)::text as n from recovery_evidence where workspace_id = $1`,
      [workspaceId],
    )).rows[0]?.n ?? 0), evidenceBeforeRevoke);

    const reconnected = await provisionReceiptInbox({ workspaceId, actorUserId: userId });
    assert.equal(reconnected.state, "WAITING");
    assert.ok(reconnected.alias?.address);
    assert.notEqual(reconnected.alias?.address, oldAddress);
    assert.equal(await resolveReceiptInboxAlias(oldAddress), null);
    assert.equal((await resolveReceiptInboxAlias(reconnected.alias!.address))?.workspaceId, workspaceId);

    const oldAddressAfterReconnect = await processResendReceivedEvent({
      svixId: `msg_${randomUUID()}`,
      emailId: `email_${randomUUID()}`,
      recipient: oldAddress,
      createdAt: "2026-08-10T12:20:00.000Z",
      payloadHash: "bb".repeat(32),
    }, {
      retrieveRawEmail: async () => {
        revokedRetrievals += 1;
        return receiptMime(oldAddress, "Linear");
      },
    });
    assert.deepEqual(oldAddressAfterReconnect, { status: "ignored" });
    assert.equal(revokedRetrievals, 0);

    const newAddressEvent = {
      svixId: `msg_${randomUUID()}`,
      emailId: `email_${randomUUID()}`,
      recipient: reconnected.alias!.address,
      createdAt: "2026-08-10T12:21:00.000Z",
      payloadHash: "cc".repeat(32),
    };
    assert.deepEqual(
      await processResendReceivedEvent(newAddressEvent, {
        retrieveRawEmail: async () => receiptMime(reconnected.alias!.address, "Canva"),
      }),
      { status: "processed" },
    );
    assert.equal(Number((await pool.query<{ n: string }>(
      `select count(*)::text as n from recovery_evidence where workspace_id = $1`,
      [workspaceId],
    )).rows[0]?.n ?? 0), evidenceBeforeRevoke + 1);
    const merchants = await pool.query<{ effective_merchant: string }>(
      `select effective_merchant from recovery_commitments where workspace_id = $1 order by effective_merchant`,
      [workspaceId],
    );
    assert.deepEqual(merchants.rows.map((row) => row.effective_merchant), ["Canva", "OpenAI"]);
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [userId]);
    restoreEnvironment();
  }
});

test("receipt inbox HTTP routes require identity, CSRF, and preserve the financial version", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const restoreEnvironment = setEnvironment(receiptInboxEnvironment);
  const pool = getDatabasePool();
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const email = `receipt-route-${randomUUID().slice(0, 8)}@example.test`;
  await pool.query(`insert into users (id, email, display_name) values ($1, $2, 'Receipt Route Owner')`, [userId, email]);
  await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Receipt Route Workspace')`, [workspaceId, userId]);
  await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, userId]);

  try {
    const unauthenticated = await getSources(new Request(`${baseUrl}/api/workspaces/current/sources`));
    assert.equal(unauthenticated.status, 401);
    const unauthenticatedRotation = await rotateSource(new Request(`${baseUrl}/api/workspaces/current/sources/receipt-inbox/rotate`, { method: "POST" }));
    assert.equal(unauthenticatedRotation.status, 401);

    const cookie = await createSessionCookie({ userId, workspaceId });
    const cookieHeader = `${cookie.name}=${encodeURIComponent(cookie.value)}`;
    const request = (path: string, method = "GET", origin = baseUrl, extraHeaders: Record<string, string> = {}) => new Request(`${baseUrl}${path}`, {
      method,
      headers: { cookie: cookieHeader, origin, ...extraHeaders },
    });

    const initial = await getSources(request("/api/workspaces/current/sources"));
    assert.equal(initial.status, 200);
    const initialPayload = await initial.json() as ApiSuccess<ReceiptInboxStatusDto>;
    assert.equal(initialPayload.data.state, "NOT_PROVISIONED");
    assert.equal(initialPayload.meta.workspaceVersion, 0);
    assert.equal(initial.headers.get("cache-control"), "private, no-store");

    const crossSite = await provisionSource(request("/api/workspaces/current/sources/receipt-inbox", "POST", "https://attacker.test"));
    assert.equal(crossSite.status, 403);

    const provisioned = await provisionSource(request("/api/workspaces/current/sources/receipt-inbox", "POST"));
    assert.equal(provisioned.status, 200);
    const provisionedPayload = await provisioned.json() as ApiSuccess<ReceiptInboxStatusDto>;
    assert.equal(provisionedPayload.data.state, "WAITING");
    assert.equal(provisionedPayload.meta.workspaceVersion, 0);
    const firstAddress = provisionedPayload.data.alias?.address;
    const firstAliasId = provisionedPayload.data.alias?.id;
    assert.ok(firstAddress);
    assert.ok(firstAliasId);

    const rotationHeaders = {
      "idempotency-key": `rotate-route-${randomUUID()}`,
      "if-match": `"${firstAliasId}"`,
    };
    const rotated = await rotateSource(request("/api/workspaces/current/sources/receipt-inbox/rotate", "POST", baseUrl, rotationHeaders));
    assert.equal(rotated.status, 200);
    const rotatedPayload = await rotated.json() as ApiSuccess<ReceiptInboxStatusDto>;
    assert.notEqual(rotatedPayload.data.alias?.address, firstAddress);
    assert.equal(rotatedPayload.meta.workspaceVersion, 0);
    const replayed = await rotateSource(request("/api/workspaces/current/sources/receipt-inbox/rotate", "POST", baseUrl, rotationHeaders));
    assert.equal(replayed.status, 200);
    assert.equal((await replayed.json() as ApiSuccess<ReceiptInboxStatusDto>).data.alias?.address, rotatedPayload.data.alias?.address);

    const connectedAccount = await pool.query<{ id: string }>(
      `select id from connected_accounts where workspace_id = $1 and connector_id = 'receipt-inbox'`,
      [workspaceId],
    );
    assert.ok(connectedAccount.rows[0]);
    process.env.ENABLE_RECEIPT_INBOX = "false";
    const genericRevoked = await deleteConnectedSource(
      request(`/api/workspaces/current/connectors/${connectedAccount.rows[0].id}`, "DELETE"),
      { params: Promise.resolve({ accountId: connectedAccount.rows[0].id }) },
    );
    assert.equal(genericRevoked.status, 200);
    const genericPayload = await genericRevoked.json() as { source: string; receiptInbox: ReceiptInboxStatusDto };
    assert.equal(genericPayload.source, "receipt-inbox");
    assert.equal(genericPayload.receiptInbox.state, "REVOKED");
    assert.equal(Number((await pool.query<{ active: string }>(
      `select count(*)::text as active from recovery_inbound_aliases where workspace_id = $1 and status = 'ACTIVE'`,
      [workspaceId],
    )).rows[0]?.active ?? -1), 0);

    const revoked = await revokeSource(request("/api/workspaces/current/sources/receipt-inbox", "DELETE"));
    assert.equal(revoked.status, 200);
    const revokedPayload = await revoked.json() as ApiSuccess<ReceiptInboxStatusDto>;
    assert.equal(revokedPayload.data.state, "REVOKED");
    assert.equal(revokedPayload.meta.workspaceVersion, 0);
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [userId]);
    restoreEnvironment();
  }
});

test("forwarded email materializes once into Recovery with provider provenance and no legacy ledger", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const restoreEnvironment = setEnvironment(receiptInboxEnvironment);
  const pool = getDatabasePool();
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const inboundEventId = randomUUID();
  const providerEventId = `svix-${randomUUID()}`;
  const providerEmailId = `email-${randomUUID()}`;
  await pool.query(`insert into users (id, email, display_name) values ($1, $2, 'Forwarded Receipt Owner')`, [userId, `forwarded-${randomUUID().slice(0, 8)}@example.test`]);
  await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Forwarded Receipt Workspace')`, [workspaceId, userId]);
  await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, userId]);
  const inbox = await provisionReceiptInbox({ workspaceId, actorUserId: userId });
  assert.ok(inbox.alias?.id);
  await pool.query(
    `insert into recovery_inbound_events (
       id, provider, svix_id, provider_email_id, workspace_id, alias_id,
       event_type, payload_hash, status, processing_started_at, attempt_count
     ) values ($1, 'RESEND', $2, $3, $4, $5, 'email.received', $6, 'PROCESSING', now(), 1)`,
    [inboundEventId, providerEventId, providerEmailId, workspaceId, inbox.alias.id, "a".repeat(64)],
  );

  const request = {
    kind: "FORWARDED_EMAIL" as const,
    receipts: [{
      clientRef: providerEmailId,
      text: "OpenAI subscription charged INR 1,999 on 6 July 2026. Renews monthly on 6 August 2026.",
    }],
  };

  try {
    const [first, replay] = await Promise.all([
      materializeForwardedEmailEvidence({ workspaceId, inboundEventId, providerEventId, expectedAttemptCount: 1, request, now: new Date("2026-08-10T12:00:00.000Z") }),
      materializeForwardedEmailEvidence({ workspaceId, inboundEventId, providerEventId, expectedAttemptCount: 1, request, now: new Date("2026-08-10T12:00:01.000Z") }),
    ]);
    assert.deepEqual([first.replayed, replay.replayed].sort(), [false, true]);
    assert.equal(first.workspaceVersion, 1);
    assert.equal(replay.workspaceVersion, 1);
    assert.equal(first.submission.id, replay.submission.id);

    const canonical = await pool.query<{
      submissions: string;
      sources: string;
      evidence: string;
      commitments: string;
      source_type: string;
      provenance_kind: string;
      provenance_reference: string;
      inbound_event_id: string | null;
      ingested_at: Date;
      submitted_by_user_id: string | null;
      actor_user_id: string | null;
      event_status: string;
    }>(
      `select
         (select count(*)::text from recovery_submissions where workspace_id = $1) as submissions,
         (select count(*)::text from recovery_sources where workspace_id = $1) as sources,
         (select count(*)::text from recovery_evidence where workspace_id = $1) as evidence,
         (select count(*)::text from recovery_commitments where workspace_id = $1) as commitments,
         (select source_type from recovery_sources where workspace_id = $1 limit 1) as source_type,
         (select provenance_kind from recovery_evidence where workspace_id = $1 limit 1) as provenance_kind,
         (select provenance_reference from recovery_evidence where workspace_id = $1 limit 1) as provenance_reference,
         (select inbound_event_id::text from recovery_submissions where workspace_id = $1 limit 1) as inbound_event_id,
         (select ingested_at from recovery_submissions where workspace_id = $1 limit 1) as ingested_at,
         (select submitted_by_user_id::text from recovery_submissions where workspace_id = $1 limit 1) as submitted_by_user_id,
         (select actor_user_id::text from recovery_workspace_versions where workspace_id = $1 limit 1) as actor_user_id,
         (select status from recovery_inbound_events where id = $2) as event_status`,
      [workspaceId, inboundEventId],
    );
    assert.equal(canonical.rows[0]?.submissions, "1");
    assert.equal(canonical.rows[0]?.sources, "1");
    assert.equal(canonical.rows[0]?.evidence, "1");
    assert.equal(canonical.rows[0]?.commitments, "1");
    assert.equal(canonical.rows[0]?.source_type, "FORWARDED_EMAIL");
    assert.equal(canonical.rows[0]?.provenance_kind, "PROVIDER_RECEIVED");
    assert.equal(canonical.rows[0]?.inbound_event_id, inboundEventId);
    assert.match(canonical.rows[0]?.provenance_reference ?? "", new RegExp(`^${inboundEventId}:`));
    assert.ok(
      ["2026-08-10T12:00:00.000Z", "2026-08-10T12:00:01.000Z"].includes(
        canonical.rows[0]?.ingested_at.toISOString() ?? "",
      ),
    );
    assert.equal(canonical.rows[0]?.submitted_by_user_id, null);
    assert.equal(canonical.rows[0]?.actor_user_id, null);
    assert.equal(canonical.rows[0]?.event_status, "PROCESSED");

    const legacy = await pool.query<{ data_sources: string; transactions: string; recurring_items: string; connector_evidence: string }>(
      `select
         (select count(*)::text from data_sources where workspace_id = $1) as data_sources,
         (select count(*)::text from transactions where workspace_id = $1) as transactions,
         (select count(*)::text from recurring_items where workspace_id = $1) as recurring_items,
         (select count(*)::text from connector_evidence where workspace_id = $1) as connector_evidence`,
      [workspaceId],
    );
    assert.deepEqual(legacy.rows[0], { data_sources: "0", transactions: "0", recurring_items: "0", connector_evidence: "0" });
    const originalConfidence = (await pool.query<{ confidence_score: number }>(
      `select confidence_score from recovery_commitments where workspace_id = $1 limit 1`,
      [workspaceId],
    )).rows[0]?.confidence_score;

    const pastedCopy = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: userId,
      expectedVersion: 1,
      idempotencyKey: `pasted-copy-${randomUUID()}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "forwarded-copy",
          text: `Forwarded message\nFrom: billing@example.test\n\n${request.receipts[0].text}`,
        }],
      },
    });
    assert.equal(pastedCopy.workspaceVersion, 1);
    assert.equal(pastedCopy.data.submission.acceptedEvidenceCount, 0);
    assert.equal(pastedCopy.data.submission.results[0]?.code, "DUPLICATE_EVIDENCE");
    const crossChannelCounts = await pool.query<{ sources: string; evidence: string; commitments: string; confidence: number }>(
      `select
         (select count(*)::text from recovery_sources where workspace_id = $1) as sources,
         (select count(*)::text from recovery_evidence where workspace_id = $1) as evidence,
         (select count(*)::text from recovery_commitments where workspace_id = $1) as commitments,
         (select confidence_score from recovery_commitments where workspace_id = $1 limit 1) as confidence`,
      [workspaceId],
    );
    assert.deepEqual(crossChannelCounts.rows[0] && {
      sources: crossChannelCounts.rows[0].sources,
      evidence: crossChannelCounts.rows[0].evidence,
      commitments: crossChannelCounts.rows[0].commitments,
    }, { sources: "1", evidence: "1", commitments: "1" });
    assert.equal(crossChannelCounts.rows[0]?.confidence, originalConfidence);

    await assert.rejects(
      materializeForwardedEmailEvidence({
        workspaceId,
        inboundEventId,
        providerEventId,
        expectedAttemptCount: 1,
        request: { ...request, receipts: [{ ...request.receipts[0], text: `${request.receipts[0].text} Changed.` }] },
      }),
      (error: unknown) => error instanceof RecoveryServiceError && error.code === "CONFLICT",
    );
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [userId]);
    restoreEnvironment();
  }
});

test("the Resend processor reserves, retrieves, parses, materializes, and deduplicates one real event", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const restoreEnvironment = setEnvironment(receiptInboxEnvironment);
  const pool = getDatabasePool();
  const userId = randomUUID();
  const workspaceId = randomUUID();
  await pool.query(`insert into users (id, email, display_name) values ($1, $2, 'Processor Owner')`, [userId, `processor-${randomUUID().slice(0, 8)}@example.test`]);
  await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Processor Workspace')`, [workspaceId, userId]);
  await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, userId]);

  try {
    const inbox = await provisionReceiptInbox({ workspaceId, actorUserId: userId });
    const address = inbox.alias!.address;
    const received = {
      svixId: `msg_${randomUUID()}`,
      emailId: `email_${randomUUID()}`,
      recipient: address,
      createdAt: "2026-08-10T12:00:00.000Z",
      payloadHash: "b".repeat(64),
    };
    let retrievals = 0;
    const retrieveRawEmail = async () => {
      retrievals += 1;
      return [
        "From: founder@example.test",
        `To: ${address}`,
        "Subject: OpenAI receipt",
        "MIME-Version: 1.0",
        "Content-Type: multipart/mixed; boundary=outer",
        "",
        "--outer",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "OpenAI subscription $20 charged on 6 July 2026. Renews monthly on 6 August 2026.",
        "--outer",
        "Content-Type: message/rfc822",
        "",
        "From: billing@example.test",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Invoice currency: USD",
        "--outer--",
        "",
      ].join("\r\n");
    };

    const first = await processResendReceivedEvent(received, { retrieveRawEmail });
    const duplicate = await processResendReceivedEvent(received, { retrieveRawEmail });
    assert.deepEqual(first, { status: "processed" });
    assert.deepEqual(duplicate, { status: "duplicate" });
    assert.equal(retrievals, 1);

    const leased = {
      ...received,
      svixId: `msg_${randomUUID()}`,
      emailId: `email_${randomUUID()}`,
      payloadHash: "c".repeat(64),
    };
    await pool.query(
      `insert into recovery_inbound_events (
         provider, svix_id, provider_email_id, workspace_id, alias_id,
         event_type, payload_hash, status, processing_started_at, attempt_count
       ) values ('RESEND', $1, $2, $3, $4, 'email.received', $5, 'PROCESSING', now(), 1)`,
      [leased.svixId, leased.emailId, workspaceId, await activeAliasId(workspaceId), leased.payloadHash],
    );
    let leasedRetrievals = 0;
    await assert.rejects(
      processResendReceivedEvent(leased, {
        retrieveRawEmail: async () => {
          leasedRetrievals += 1;
          return "";
        },
      }),
      (error: unknown) => error instanceof ResendInboundRetryableError,
    );
    assert.equal(leasedRetrievals, 0);
    const rotatedDuringRetry = await rotateReceiptInbox({
      workspaceId,
      actorUserId: userId,
      expectedAliasId: inbox.alias!.id,
      idempotencyKey: `retry-rotation-${randomUUID()}`,
    });
    assert.notEqual(rotatedDuringRetry.alias?.address, address);
    assert.equal(await resolveReceiptInboxAlias(address), null);
    const reclaimed = await processResendReceivedEvent(leased, {
      retrieveRawEmail: async () => {
        leasedRetrievals += 1;
        return [
          "From: billing@example.test",
          `To: ${address}`,
          "Subject: Notion receipt",
          "Content-Type: text/plain; charset=utf-8",
          "",
          "Notion charged INR 830 on 7 July 2026. Renews monthly on 7 August 2026.",
        ].join("\r\n");
      },
    });
    assert.deepEqual(reclaimed, { status: "ignored" });
    assert.equal(leasedRetrievals, 0);
    const reclaimedLease = await pool.query<{ status: string; error_code: string | null }>(
      `select status, error_code from recovery_inbound_events where workspace_id = $1 and svix_id = $2`,
      [workspaceId, leased.svixId],
    );
    assert.equal(reclaimedLease.rows[0]?.status, "IGNORED");
    assert.equal(reclaimedLease.rows[0]?.error_code, "ALIAS_REVOKED");

    const status = await getReceiptInboxStatus({ workspaceId, actorUserId: userId });
    assert.equal(status.state, "WAITING");
    assert.equal(status.lastProcessedAt, null);
    const htmlReceived = {
      svixId: `msg_${randomUUID()}`,
      emailId: `email_${randomUUID()}`,
      recipient: rotatedDuringRetry.alias!.address,
      createdAt: "2026-08-10T12:10:00.000Z",
      payloadHash: "d".repeat(64),
    };
    const htmlResult = await processResendReceivedEvent(htmlReceived, {
      retrieveRawEmail: async () => [
        "From: billing@example.test",
        `To: ${rotatedDuringRetry.alias!.address}`,
        "Subject: Figma receipt",
        "Content-Type: text/html; charset=utf-8",
        "",
        "<style>.hidden{display:none}</style><script>ignore()</script><p>Figma charged INR 1,200 on 8 July 2026. Renews monthly on 8 August 2026.</p>",
      ].join("\r\n"),
    });
    assert.deepEqual(htmlResult, { status: "processed" });
    const activeStatus = await getReceiptInboxStatus({ workspaceId, actorUserId: userId });
    assert.equal(activeStatus.state, "READY");
    assert.ok(activeStatus.lastProcessedAt);
    const canonical = await pool.query<{ events: string; submissions: string; provider_evidence: string; merchants: string[]; currencies: string[] }>(
      `select
         (select count(*)::text from recovery_inbound_events where workspace_id = $1) as events,
         (select count(*)::text from recovery_submissions where workspace_id = $1) as submissions,
         (select count(*)::text from recovery_evidence where workspace_id = $1 and provenance_kind = 'PROVIDER_RECEIVED') as provider_evidence,
         array(select effective_merchant from recovery_commitments where workspace_id = $1 order by effective_merchant) as merchants,
         array(select base_currency from recovery_commitments where workspace_id = $1 order by effective_merchant) as currencies`,
      [workspaceId],
    );
    assert.deepEqual(canonical.rows[0], {
      events: "3",
      submissions: "2",
      provider_evidence: "2",
      merchants: ["Figma", "OpenAI"],
      currencies: ["INR", "USD"],
    });

    let unknownRetrievals = 0;
    const ignored = await processResendReceivedEvent({ ...received, svixId: `msg_${randomUUID()}`, emailId: `email_${randomUUID()}`, recipient: "rcpt_ffffffffffffffffffffffffffffffffffffffff@receipts.vognary.test" }, {
      retrieveRawEmail: async () => {
        unknownRetrievals += 1;
        return "";
      },
    });
    assert.deepEqual(ignored, { status: "ignored" });
    assert.equal(unknownRetrievals, 0);
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [userId]);
    restoreEnvironment();
  }
});

test("revoking an inbox stops a genuinely in-flight receipt before materialization", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const restoreEnvironment = setEnvironment(receiptInboxEnvironment);
  const pool = getDatabasePool();
  const userId = randomUUID();
  const workspaceId = randomUUID();
  await pool.query(`insert into users (id, email) values ($1, $2)`, [userId, `inflight-revoke-${randomUUID().slice(0, 8)}@example.test`]);
  await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'In-flight revoke workspace')`, [workspaceId, userId]);
  await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, userId]);

  const receiptMime = (address: string, merchant: string) => [
    "From: billing@example.test",
    `To: ${address}`,
    `Subject: ${merchant} receipt`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    `${merchant} charged INR 1,499 on 6 July 2026. Renews monthly on 6 August 2026.`,
  ].join("\r\n");

  try {
    const inbox = await provisionReceiptInbox({ workspaceId, actorUserId: userId });
    const address = inbox.alias!.address;
    const event = {
      svixId: `msg_${randomUUID()}`,
      emailId: `email_${randomUUID()}`,
      recipient: address,
      createdAt: "2026-08-10T14:00:00.000Z",
      payloadHash: "ab".repeat(32),
    };
    let signalStarted!: () => void;
    let releaseRaw!: (raw: string) => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const raw = new Promise<string>((resolve) => { releaseRaw = resolve; });

    const inFlight = processResendReceivedEvent(event, {
      retrieveRawEmail: async () => {
        signalStarted();
        return raw;
      },
    });
    await started;

    const leased = await pool.query<{ status: string }>(
      `select status from recovery_inbound_events where workspace_id = $1 and svix_id = $2`,
      [workspaceId, event.svixId],
    );
    assert.equal(leased.rows[0]?.status, "PROCESSING");

    const before = await pool.query<{ evidence: string; submissions: string; commitments: string }>(
      `select
         (select count(*)::text from recovery_evidence where workspace_id = $1) as evidence,
         (select count(*)::text from recovery_submissions where workspace_id = $1) as submissions,
         (select count(*)::text from recovery_commitments where workspace_id = $1) as commitments`,
      [workspaceId],
    );
    assert.deepEqual(before.rows[0], { evidence: "0", submissions: "0", commitments: "0" });

    const revoked = await revokeReceiptInbox({ workspaceId, actorUserId: userId });
    assert.equal(revoked.state, "REVOKED");
    releaseRaw(receiptMime(address, "Figma"));
    const completed = await inFlight;
    assert.ok(completed.status === "ignored" || completed.status === "duplicate");

    const after = await pool.query<{
      status: string;
      error_code: string | null;
      evidence: string;
      submissions: string;
      commitments: string;
    }>(
      `select status, error_code,
         (select count(*)::text from recovery_evidence where workspace_id = $1) as evidence,
         (select count(*)::text from recovery_submissions where workspace_id = $1) as submissions,
         (select count(*)::text from recovery_commitments where workspace_id = $1) as commitments
       from recovery_inbound_events
       where workspace_id = $1 and svix_id = $2`,
      [workspaceId, event.svixId],
    );
    assert.ok(["IGNORED", "TERMINAL_FAILED"].includes(after.rows[0]?.status ?? ""));
    assert.ok(
      after.rows[0]?.error_code === "ALIAS_REVOKED" || after.rows[0]?.status === "IGNORED",
      `expected ALIAS_REVOKED or IGNORED, got ${after.rows[0]?.status}/${after.rows[0]?.error_code}`,
    );
    assert.deepEqual({
      evidence: after.rows[0]?.evidence,
      submissions: after.rows[0]?.submissions,
      commitments: after.rows[0]?.commitments,
    }, { evidence: "0", submissions: "0", commitments: "0" });
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [userId]);
    restoreEnvironment();
  }
});

test("rotating an inbox stops a genuinely in-flight receipt before materialization", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const restoreEnvironment = setEnvironment(receiptInboxEnvironment);
  const pool = getDatabasePool();
  const userId = randomUUID();
  const workspaceId = randomUUID();
  await pool.query(`insert into users (id, email) values ($1, $2)`, [userId, `inflight-rotate-${randomUUID().slice(0, 8)}@example.test`]);
  await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'In-flight rotate workspace')`, [workspaceId, userId]);
  await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, userId]);

  const receiptMime = (address: string, merchant: string) => [
    "From: billing@example.test",
    `To: ${address}`,
    `Subject: ${merchant} receipt`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    `${merchant} charged INR 1,499 on 6 July 2026. Renews monthly on 6 August 2026.`,
  ].join("\r\n");

  try {
    const inbox = await provisionReceiptInbox({ workspaceId, actorUserId: userId });
    const address = inbox.alias!.address;
    const event = {
      svixId: `msg_${randomUUID()}`,
      emailId: `email_${randomUUID()}`,
      recipient: address,
      createdAt: "2026-08-10T14:00:00.000Z",
      payloadHash: "cd".repeat(32),
    };
    let signalStarted!: () => void;
    let releaseRaw!: (raw: string) => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const raw = new Promise<string>((resolve) => { releaseRaw = resolve; });

    const inFlight = processResendReceivedEvent(event, {
      retrieveRawEmail: async () => {
        signalStarted();
        return raw;
      },
    });
    await started;

    const rotated = await rotateReceiptInbox({
      workspaceId,
      actorUserId: userId,
      expectedAliasId: inbox.alias!.id,
      idempotencyKey: `inflight-rotate-${randomUUID()}`,
    });
    assert.notEqual(rotated.alias?.address, address);
    releaseRaw(receiptMime(address, "Figma"));
    const completed = await inFlight;
    assert.ok(completed.status === "ignored" || completed.status === "duplicate");

    const after = await pool.query<{
      status: string;
      error_code: string | null;
      evidence: string;
    }>(
      `select status, error_code,
         (select count(*)::text from recovery_evidence where workspace_id = $1) as evidence
       from recovery_inbound_events
       where workspace_id = $1 and svix_id = $2`,
      [workspaceId, event.svixId],
    );
    assert.ok(["IGNORED", "TERMINAL_FAILED"].includes(after.rows[0]?.status ?? ""));
    assert.equal(after.rows[0]?.evidence, "0");
    assert.equal(await resolveReceiptInboxAlias(address), null);
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [userId]);
    restoreEnvironment();
  }
});

test("privacy consent withdrawal serializes with in-flight materialization and reconnects on a new alias", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const restoreEnvironment = setEnvironment(receiptInboxEnvironment);
  const pool = getDatabasePool();
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const email = `consent-race-${randomUUID().slice(0, 8)}@example.test`;
  await pool.query(`insert into users (id, email) values ($1, $2)`, [userId, email]);
  await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Consent race workspace')`, [workspaceId, userId]);
  await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, userId]);

  const receiptMime = (address: string, merchant: string) => [
    "From: billing@example.test",
    `To: ${address}`,
    `Subject: ${merchant} receipt`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    `${merchant} charged INR 1,199 on 6 July 2026. Renews monthly on 6 August 2026.`,
  ].join("\r\n");

  try {
    const inbox = await provisionReceiptInbox({ workspaceId, actorUserId: userId });
    const oldAddress = inbox.alias!.address;
    const firstEvent = {
      svixId: `msg_${randomUUID()}`,
      emailId: `email_${randomUUID()}`,
      recipient: oldAddress,
      createdAt: "2026-08-10T15:00:00.000Z",
      payloadHash: "11".repeat(32),
    };
    assert.deepEqual(
      await processResendReceivedEvent(firstEvent, { retrieveRawEmail: async () => receiptMime(oldAddress, "OpenAI") }),
      { status: "processed" },
    );
    const priorEvidence = Number((await pool.query<{ n: string }>(
      `select count(*)::text as n from recovery_evidence where workspace_id = $1`,
      [workspaceId],
    )).rows[0]?.n ?? 0);
    assert.equal(priorEvidence, 1);

    const consent = await pool.query<{ id: string }>(
      `select id from consent_grants
       where workspace_id = $1 and purpose = 'receipt-inbox-ingest' and withdrawn_at is null
       order by granted_at desc limit 1`,
      [workspaceId],
    );
    assert.ok(consent.rows[0]?.id);

    const inFlight = {
      svixId: `msg_${randomUUID()}`,
      emailId: `email_${randomUUID()}`,
      recipient: oldAddress,
      createdAt: "2026-08-10T15:05:00.000Z",
      payloadHash: "22".repeat(32),
    };
    let signalAuthority!: () => void;
    let releaseAuthority!: () => void;
    const authorityInspected = new Promise<void>((resolve) => { signalAuthority = resolve; });
    const resumeAfterWithdraw = new Promise<void>((resolve) => { releaseAuthority = resolve; });
    let withdrawnDuringGap = false;

    const processing = processResendReceivedEvent(inFlight, {
      retrieveRawEmail: async () => receiptMime(oldAddress, "Figma"),
      afterAuthorityInspection: async () => {
        signalAuthority();
        await resumeAfterWithdraw;
      },
    });
    await authorityInspected;

    const cookie = await createSessionCookie({ userId, workspaceId });
    const withdrawal = await withdrawConsent(new Request(`${baseUrl}/api/privacy/consents`, {
      method: "DELETE",
      headers: {
        cookie: `${cookie.name}=${encodeURIComponent(cookie.value)}`,
        origin: baseUrl,
        "content-type": "application/json",
      },
      body: JSON.stringify({ id: consent.rows[0].id }),
    }));
    assert.equal(withdrawal.status, 200);
    withdrawnDuringGap = true;
    const withdrawnRow = await pool.query<{ withdrawn: boolean }>(
      `select exists (
         select 1 from consent_grants
         where id = $1 and withdrawn_at is not null
       ) as withdrawn`,
      [consent.rows[0].id],
    );
    assert.equal(withdrawnRow.rows[0]?.withdrawn, true);

    releaseAuthority();
    const completed = await processing;
    assert.ok(completed.status === "ignored" || completed.status === "duplicate");
    assert.equal(withdrawnDuringGap, true);
    assert.equal(Number((await pool.query<{ n: string }>(
      `select count(*)::text as n from recovery_evidence where workspace_id = $1`,
      [workspaceId],
    )).rows[0]?.n ?? 0), priorEvidence);
    assert.equal(Number((await pool.query<{ n: string }>(
      `select count(*)::text as n from recovery_submissions where workspace_id = $1`,
      [workspaceId],
    )).rows[0]?.n ?? 0), priorEvidence);
    assert.equal(await resolveReceiptInboxAlias(oldAddress), null);
    assert.equal((await getReceiptInboxStatus({ workspaceId, actorUserId: userId })).state, "REVOKED");

    const reconnected = await provisionReceiptInbox({ workspaceId, actorUserId: userId });
    assert.equal(reconnected.state, "WAITING");
    assert.ok(reconnected.alias?.address);
    assert.notEqual(reconnected.alias?.address, oldAddress);
    assert.equal(await resolveReceiptInboxAlias(oldAddress), null);
    const liveConsents = await pool.query<{ n: string; distinct_aliases: string }>(
      `select
         (select count(*)::text from consent_grants
           where workspace_id = $1 and purpose = 'receipt-inbox-ingest' and withdrawn_at is null) as n,
         (select count(*)::text from recovery_inbound_aliases
           where workspace_id = $1 and status = 'ACTIVE') as distinct_aliases`,
      [workspaceId],
    );
    assert.equal(liveConsents.rows[0]?.n, "1");
    assert.equal(liveConsents.rows[0]?.distinct_aliases, "1");

    assert.deepEqual(
      await processResendReceivedEvent({
        svixId: `msg_${randomUUID()}`,
        emailId: `email_${randomUUID()}`,
        recipient: reconnected.alias!.address,
        createdAt: "2026-08-10T15:20:00.000Z",
        payloadHash: "33".repeat(32),
      }, { retrieveRawEmail: async () => receiptMime(reconnected.alias!.address, "Notion") }),
      { status: "processed" },
    );
    assert.equal(Number((await pool.query<{ n: string }>(
      `select count(*)::text as n from recovery_evidence where workspace_id = $1`,
      [workspaceId],
    )).rows[0]?.n ?? 0), priorEvidence + 1);
    const merchants = await pool.query<{ effective_merchant: string }>(
      `select effective_merchant from recovery_commitments where workspace_id = $1 order by effective_merchant`,
      [workspaceId],
    );
    assert.deepEqual(merchants.rows.map((row) => row.effective_merchant), ["Notion", "OpenAI"]);
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [userId]);
    restoreEnvironment();
  }
});

test("replaying a withdrawn receipt-inbox consent does not revoke the reconnect inbox", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const restoreEnvironment = setEnvironment(receiptInboxEnvironment);
  const pool = getDatabasePool();
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const email = `stale-consent-${randomUUID().slice(0, 8)}@example.test`;
  await pool.query(`insert into users (id, email) values ($1, $2)`, [userId, email]);
  await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Stale consent workspace')`, [workspaceId, userId]);
  await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, userId]);

  const receiptMime = (address: string, merchant: string) => [
    "From: billing@example.test",
    `To: ${address}`,
    `Subject: ${merchant} receipt`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    `${merchant} charged INR 1,099 on 6 July 2026. Renews monthly on 6 August 2026.`,
  ].join("\r\n");

  const deleteConsent = async (consentId: string) => {
    const cookie = await createSessionCookie({ userId, workspaceId });
    return withdrawConsent(new Request(`${baseUrl}/api/privacy/consents`, {
      method: "DELETE",
      headers: {
        cookie: `${cookie.name}=${encodeURIComponent(cookie.value)}`,
        origin: baseUrl,
        "content-type": "application/json",
      },
      body: JSON.stringify({ id: consentId }),
    }));
  };

  try {
    const first = await provisionReceiptInbox({ workspaceId, actorUserId: userId });
    const consentA = (await pool.query<{ id: string }>(
      `select id from consent_grants
       where workspace_id = $1 and purpose = 'receipt-inbox-ingest' and withdrawn_at is null
       order by granted_at desc limit 1`,
      [workspaceId],
    )).rows[0];
    assert.ok(consentA?.id);
    assert.equal((await deleteConsent(consentA.id)).status, 200);

    const reconnected = await provisionReceiptInbox({ workspaceId, actorUserId: userId });
    assert.equal(reconnected.state, "WAITING");
    assert.ok(reconnected.alias?.address);
    assert.notEqual(reconnected.alias?.address, first.alias?.address);
    const consentB = (await pool.query<{ id: string }>(
      `select id from consent_grants
       where workspace_id = $1 and purpose = 'receipt-inbox-ingest' and withdrawn_at is null
       order by granted_at desc limit 1`,
      [workspaceId],
    )).rows[0];
    assert.ok(consentB?.id);
    assert.notEqual(consentB.id, consentA.id);

    const replay = await deleteConsent(consentA.id);
    assert.equal(replay.status, 200);
    const replayPayload = await replay.json() as { status?: string; id?: string };
    assert.equal(replayPayload.status, "withdrawn");
    assert.equal(replayPayload.id, consentA.id);

    const afterReplay = await pool.query<{ aliases: string; consents: string }>(
      `select
         (select count(*)::text from recovery_inbound_aliases
           where workspace_id = $1 and status = 'ACTIVE') as aliases,
         (select count(*)::text from consent_grants
           where workspace_id = $1 and purpose = 'receipt-inbox-ingest' and withdrawn_at is null) as consents`,
      [workspaceId],
    );
    assert.deepEqual(afterReplay.rows[0], { aliases: "1", consents: "1" });
    const status = await getReceiptInboxStatus({ workspaceId, actorUserId: userId });
    assert.equal(status.state, "WAITING");
    assert.equal(status.alias?.address, reconnected.alias?.address);
    assert.deepEqual(await resolveReceiptInboxAlias(reconnected.alias!.address), { workspaceId, aliasId: reconnected.alias!.id });
    assert.equal(await resolveReceiptInboxAlias(first.alias!.address), null);

    assert.deepEqual(
      await processResendReceivedEvent({
        svixId: `msg_${randomUUID()}`,
        emailId: `email_${randomUUID()}`,
        recipient: reconnected.alias!.address,
        createdAt: "2026-08-10T16:00:00.000Z",
        payloadHash: "44".repeat(32),
      }, { retrieveRawEmail: async () => receiptMime(reconnected.alias!.address, "Canva") }),
      { status: "processed" },
    );
    assert.equal((await getReceiptInboxStatus({ workspaceId, actorUserId: userId })).state, "READY");
    assert.equal(Number((await pool.query<{ n: string }>(
      `select count(*)::text as n from recovery_evidence where workspace_id = $1`,
      [workspaceId],
    )).rows[0]?.n ?? 0), 1);
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [userId]);
    restoreEnvironment();
  }
});

test("an expired inbound worker cannot overwrite the reclaimed attempt", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const restoreEnvironment = setEnvironment(receiptInboxEnvironment);
  const pool = getDatabasePool();
  const userId = randomUUID();
  const workspaceId = randomUUID();
  await pool.query(`insert into users (id, email) values ($1, $2)`, [userId, `lease-${randomUUID().slice(0, 8)}@example.test`]);
  await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Inbound lease workspace')`, [workspaceId, userId]);
  await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, userId]);

  try {
    const inbox = await provisionReceiptInbox({ workspaceId, actorUserId: userId });
    const event = {
      svixId: `msg_${randomUUID()}`,
      emailId: `email_${randomUUID()}`,
      recipient: inbox.alias!.address,
      createdAt: "2026-08-10T13:00:00.000Z",
      payloadHash: "e".repeat(64),
    };
    let signalOldStarted!: () => void;
    let releaseOld!: (raw: string) => void;
    const oldStarted = new Promise<void>((resolve) => { signalOldStarted = resolve; });
    const oldRaw = new Promise<string>((resolve) => { releaseOld = resolve; });
    const oldAttempt = processResendReceivedEvent(event, {
      retrieveRawEmail: async () => {
        signalOldStarted();
        return oldRaw;
      },
    });
    await oldStarted;
    await pool.query(
      `update recovery_inbound_events
       set processing_started_at = now() - interval '6 minutes'
       where workspace_id = $1 and svix_id = $2`,
      [workspaceId, event.svixId],
    );

    const reclaimed = await processResendReceivedEvent(event, {
      retrieveRawEmail: async () => [
        "From: billing@example.test",
        `To: ${inbox.alias!.address}`,
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Linear subscription charged INR 900 on 9 July 2026. Renews monthly on 9 August 2026.",
      ].join("\r\n"),
    });
    releaseOld("");
    const staleCompletion = await oldAttempt;
    assert.deepEqual(reclaimed, { status: "processed" });
    assert.deepEqual(staleCompletion, { status: "duplicate" });

    const outcome = await pool.query<{ status: string; attempt_count: number; submissions: string; evidence: string }>(
      `select status, attempt_count,
         (select count(*)::text from recovery_submissions where workspace_id = $1) as submissions,
         (select count(*)::text from recovery_evidence where workspace_id = $1) as evidence
       from recovery_inbound_events
       where workspace_id = $1 and svix_id = $2`,
      [workspaceId, event.svixId],
    );
    assert.deepEqual(outcome.rows[0], { status: "PROCESSED", attempt_count: 2, submissions: "1", evidence: "1" });
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [userId]);
    restoreEnvironment();
  }
});

test("a processing receipt without a live alias cannot persist evidence", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const restoreEnvironment = setEnvironment(receiptInboxEnvironment);
  const pool = getDatabasePool();
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const inboundEventId = randomUUID();
  const providerEventId = `svix-${randomUUID()}`;
  const providerEmailId = `email-${randomUUID()}`;
  await pool.query(`insert into users (id, email, display_name) values ($1, $2, 'Orphan Receipt Owner')`, [userId, `orphan-${randomUUID().slice(0, 8)}@example.test`]);
  await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Orphan Receipt Workspace')`, [workspaceId, userId]);
  await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, userId]);
  await pool.query(
    `insert into recovery_inbound_events (
       id, provider, svix_id, provider_email_id, workspace_id,
       event_type, payload_hash, status, processing_started_at, attempt_count
     ) values ($1, 'RESEND', $2, $3, $4, 'email.received', $5, 'PROCESSING', now(), 1)`,
    [inboundEventId, providerEventId, providerEmailId, workspaceId, "b".repeat(64)],
  );

  try {
    const result = await materializeForwardedEmailEvidence({
      workspaceId,
      inboundEventId,
      providerEventId,
      expectedAttemptCount: 1,
      request: {
        kind: "FORWARDED_EMAIL",
        receipts: [{
          clientRef: providerEmailId,
          text: "OpenAI subscription charged INR 1,999 on 6 July 2026. Renews monthly on 6 August 2026.",
        }],
      },
      now: new Date("2026-08-10T12:00:00.000Z"),
    });
    assert.equal(result.submission.acceptedEvidenceCount, 0);
    assert.equal(result.replayed, false);
    const leftover = await pool.query<{ evidence: string; status: string; error_code: string | null }>(
      `select
         (select count(*)::text from recovery_evidence where workspace_id = $1) as evidence,
         status, error_code
       from recovery_inbound_events where id = $2`,
      [workspaceId, inboundEventId],
    );
    assert.equal(leftover.rows[0]?.evidence, "0");
    assert.equal(leftover.rows[0]?.status, "IGNORED");
    assert.equal(leftover.rows[0]?.error_code, "ALIAS_REVOKED");
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [userId]);
    restoreEnvironment();
  }
});

test("deleting a non-owner admin revokes their inbox and in-flight leases", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const restoreEnvironment = setEnvironment({
    ...receiptInboxEnvironment,
    ALLOW_IN_MEMORY_RATE_LIMITS: "true",
  });
  const pool = getDatabasePool();
  const ownerUserId = randomUUID();
  const adminUserId = randomUUID();
  const workspaceId = randomUUID();
  const inboundEventId = randomUUID();
  const ownerEmail = `inbox-owner-${randomUUID().slice(0, 8)}@example.test`;
  const adminEmail = `inbox-admin-${randomUUID().slice(0, 8)}@example.test`;
  await pool.query(`insert into users (id, email, display_name) values ($1, $2, 'Inbox Owner')`, [ownerUserId, ownerEmail]);
  await pool.query(`insert into users (id, email, display_name) values ($1, $2, 'Inbox Admin')`, [adminUserId, adminEmail]);
  await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Shared Inbox Workspace')`, [workspaceId, ownerUserId]);
  await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, ownerUserId]);
  await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'admin')`, [workspaceId, adminUserId]);

  try {
    const inbox = await provisionReceiptInbox({ workspaceId, actorUserId: adminUserId });
    assert.equal(inbox.alias?.status, "ACTIVE");
    await pool.query(
      `insert into recovery_inbound_events (
         id, provider, svix_id, provider_email_id, workspace_id, alias_id,
         event_type, payload_hash, status, processing_started_at, attempt_count
       ) values ($1, 'RESEND', $2, $3, $4, $5, 'email.received', $6, 'PROCESSING', now(), 1)`,
      [inboundEventId, `svix-${randomUUID()}`, `email-${randomUUID()}`, workspaceId, inbox.alias?.id, "c".repeat(64)],
    );

    const { NextRequest } = await import("next/server");
    const { DELETE: deleteProfile } = await import("../../src/app/api/profile/route");
    const cookie = await createSessionCookie({ userId: adminUserId, workspaceId });
    const deleted = await deleteProfile(new NextRequest(`${baseUrl}/api/profile`, {
      method: "DELETE",
      headers: {
        cookie: `${cookie.name}=${encodeURIComponent(cookie.value)}`,
        origin: baseUrl,
        "content-type": "application/json",
      },
      body: JSON.stringify({ confirm: "DELETE MY VOGNARY DATA" }),
    }));
    assert.equal(deleted.status, 200, await deleted.text());

    const leftover = await pool.query<{ alias_status: string; event_status: string; error_code: string | null }>(
      `select
         (select status from recovery_inbound_aliases where workspace_id = $1 order by created_at desc limit 1) as alias_status,
         status as event_status, error_code
       from recovery_inbound_events where id = $2`,
      [workspaceId, inboundEventId],
    );
    assert.equal(leftover.rows[0]?.alias_status, "REVOKED");
    assert.equal(leftover.rows[0]?.event_status, "IGNORED");
    assert.equal(leftover.rows[0]?.error_code, "ALIAS_REVOKED");
    assert.equal((await resolveReceiptInboxAlias(inbox.alias!.address))?.aliasId ?? null, null);
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
    await pool.query(`delete from users where id = $1`, [adminUserId]);
    restoreEnvironment();
  }
});

test("a forwarded receipt that only infers a next date is not a cited provider renewal", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const restoreEnvironment = setEnvironment(receiptInboxEnvironment);
  const pool = getDatabasePool();
  const userId = randomUUID();
  const workspaceId = randomUUID();
  await pool.query(`insert into users (id, email) values ($1, $2)`, [userId, `inferred-forward-${randomUUID().slice(0, 8)}@example.test`]);
  await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Inferred forward workspace')`, [workspaceId, userId]);
  await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, userId]);
  try {
    const inbox = await provisionReceiptInbox({ workspaceId, actorUserId: userId });
    const address = inbox.alias!.address;
    const processed = await processResendReceivedEvent({
      svixId: `msg_${randomUUID()}`,
      emailId: `email_${randomUUID()}`,
      recipient: address,
      createdAt: "2026-08-10T12:00:00.000Z",
      payloadHash: "ef".repeat(32),
    }, {
      retrieveRawEmail: async () => [
        "From: billing@example.test",
        `To: ${address}`,
        "Subject: OpenAI receipt",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "OpenAI subscription charged INR 1,999 on 6 July 2026. Monthly billing.",
      ].join("\r\n"),
    });
    assert.deepEqual(processed, { status: "processed" });
    const evidence = await pool.query<{ provenance_kind: string; excerpt: string | null }>(
      `select provenance_kind, excerpt from recovery_evidence where workspace_id = $1`,
      [workspaceId],
    );
    assert.equal(evidence.rows[0]?.provenance_kind, "PROVIDER_RECEIVED");
    const version = await pool.query<{ version: string }>(
      `select version::text from recovery_workspace_states where workspace_id = $1`,
      [workspaceId],
    );
    await signStandingMandate({
      workspaceId,
      actorUserId: userId,
      expectedVersion: Number(version.rows[0]?.version ?? 0),
      idempotencyKey: `inferred-forward-sign-${randomUUID()}`,
    });
    await runShadowEvaluator(workspaceId);
    const candidate = await pool.query<{ next_debit_reason: string | null; eligibility: string }>(
      `select next_debit_reason, eligibility from recovery_action_candidates where workspace_id = $1 limit 1`,
      [workspaceId],
    );
    assert.ok(candidate.rows[0]);
    assert.notEqual(candidate.rows[0]?.next_debit_reason, "CITED_RENEWAL");
    assert.notEqual(candidate.rows[0]?.eligibility, "ELIGIBLE");
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [userId]);
    restoreEnvironment();
  }
});

async function activeAliasId(workspaceId: string) {
  const result = await getDatabasePool().query<{ id: string }>(
    `select id from recovery_inbound_aliases where workspace_id = $1 and status = 'ACTIVE'`,
    [workspaceId],
  );
  assert.ok(result.rows[0]);
  return result.rows[0].id;
}

function setEnvironment(values: Record<string, string>) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}
