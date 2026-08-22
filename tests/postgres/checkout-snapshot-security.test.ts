import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { NextRequest } from "next/server";

import { POST as checkoutPost } from "../../src/app/api/checkout/route";
import {
  DELETE as deleteAuditSnapshot,
  POST as saveAuditSnapshot,
} from "../../src/app/api/workspaces/current/audit-snapshot/route";
import {
  BillingCheckoutIdempotencyConflictError,
  createBillingCheckout,
} from "../../src/lib/server/billing-store";
import { getDatabasePool } from "../../src/lib/server/database";
import { createSessionCookie } from "../../src/lib/server/session";
import { publicOffer } from "../../src/lib/public-offer";
import { getOrCreateUserByGoogleIdentity, WorkspaceIdentityConflictError } from "../../src/lib/server/workspace-store";

const databaseConfigured = Boolean(process.env.DATABASE_URL);

test("checkout replay rejects changed provider, amount, and currency", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const idempotencyKey = `billing-security-${randomUUID()}`;
  const base = {
    workspaceId,
    userId,
    leadId: null,
    customerEmail: `${userId}@billing-security.test`,
    plan: publicOffer.plan,
    offerId: publicOffer.id,
    offerVersion: publicOffer.version,
    termsVersion: publicOffer.termsVersion,
    provider: "razorpay" as const,
    amountMinor: 99_900,
    currency: "INR" as const,
    idempotencyKey,
  };

  try {
    await pool.query(`insert into users (id, email) values ($1, $2)`, [userId, base.customerEmail]);
    await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Billing security test')`, [workspaceId, userId]);
    await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, userId]);
    await createBillingCheckout(base);

    await assert.rejects(
      createBillingCheckout({ ...base, provider: "payment-link" as "razorpay" }),
      BillingCheckoutIdempotencyConflictError,
    );
    await assert.rejects(
      createBillingCheckout({ ...base, amountMinor: 499_900 }),
      BillingCheckoutIdempotencyConflictError,
    );
    await assert.rejects(
      createBillingCheckout({ ...base, currency: "USD" as "INR" }),
      BillingCheckoutIdempotencyConflictError,
    );
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [userId]);
  }
});

test("guest assisted-audit checkout remains retired for historical lead records", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const leadId = randomUUID();

  try {
    await pool.query(
      `insert into private_audit_leads (id, source, name, email, persona)
       values ($1, 'security-test', 'Security test', 'owner@example.com', 'individual')`,
      [leadId],
    );
    const response = await checkoutPost(new NextRequest("https://vognary.test/api/checkout", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "security-lead-mismatch-0001",
        "x-forwarded-for": "198.51.100.20",
      },
      body: JSON.stringify({ plan: publicOffer.plan, email: "attacker@example.com", leadId, termsVersion: publicOffer.termsVersion }),
    }));
    assert.equal(response.status, 410);
    assert.equal((await response.json()).status, "retired");
  } finally {
    await pool.query(`delete from private_audit_leads where id = $1`, [leadId]);
  }
});

test("viewer sessions cannot replace or delete workspace audit snapshots", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const ownerId = randomUUID();
  const viewerId = randomUUID();
  const workspaceId = randomUUID();
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "checkout-snapshot-security-test-secret";

  try {
    await pool.query(`insert into users (id, email) values ($1, $2), ($3, $4)`, [
      ownerId,
      `${ownerId}@snapshot-security.test`,
      viewerId,
      `${viewerId}@snapshot-security.test`,
    ]);
    await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Snapshot security test')`, [workspaceId, ownerId]);
    await pool.query(
      `insert into workspace_members (workspace_id, user_id, role)
       values ($1, $2, 'owner'), ($1, $3, 'viewer')`,
      [workspaceId, ownerId, viewerId],
    );
    const cookie = await createSessionCookie({ userId: viewerId, workspaceId });
    const headers = {
      cookie: `${cookie.name}=${encodeURIComponent(cookie.value)}`,
      "content-type": "application/json",
      "x-forwarded-for": "198.51.100.21",
    };

    const saveResponse = await saveAuditSnapshot(new Request("https://vognary.test/api/workspaces/current/audit-snapshot", {
      method: "POST",
      headers,
      body: JSON.stringify({ snapshot: { version: 1, statementSources: [], manualItems: [] } }),
    }));
    assert.equal(saveResponse.status, 403);

    const deleteResponse = await deleteAuditSnapshot(new Request("https://vognary.test/api/workspaces/current/audit-snapshot", {
      method: "DELETE",
      headers,
    }));
    assert.equal(deleteResponse.status, 403);
  } finally {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = any($1::uuid[])`, [[ownerId, viewerId]]);
  }
});

test("a different Google subject cannot inherit an established email workspace", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const email = `${userId}@google-identity.test`;

  try {
    await pool.query(`insert into users (id, email) values ($1, $2)`, [userId, email]);
    await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Google identity test')`, [workspaceId, userId]);
    await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, userId]);

    await assert.rejects(
      getOrCreateUserByGoogleIdentity({
        issuer: "https://accounts.google.com",
        subject: "new-google-subject",
        email,
        displayName: "Reassigned User",
      }),
      WorkspaceIdentityConflictError,
    );
    assert.equal((await pool.query(`select count(*)::int as count from auth_identities where user_id = $1`, [userId])).rows[0].count, 0);
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [userId]);
  }
});
