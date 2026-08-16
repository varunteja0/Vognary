import { NextRequest, NextResponse } from "next/server";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { getDatabasePool, isDatabaseConfigured } from "@/lib/server/database";
import { sessionCookieName } from "@/lib/server/session";
import { requireSession } from "@/lib/server/workspace-auth";
import { listWorkspacesForUser } from "@/lib/server/workspace-store";
import { readLimitedJson, RequestBodyTooLargeError, UnsupportedContentTypeError } from "@/lib/server/request-body";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import { revokeConnectorCredentialAtProvider } from "@/lib/server/connector-provider-revocation";
import { applyReceiptInboxRevocation } from "@/lib/server/recovery-inbound-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const deleteConfirmation = "DELETE MY VOGNARY DATA";
const stepUpWindowMs = 15 * 60_000;

type ProfileDataCounts = {
  auditReports: number;
  dataSources: number;
  connectedAccounts: number;
  uploadedFiles: number;
  transactions: number;
  recurringItems: number;
  connectorEvidence: number;
  usageObservations: number;
  latestSnapshotAt: string | null;
  latestSummary: Record<string, unknown> | null;
};

class ProfileDeletionConflictError extends Error {
  constructor(readonly code: "workspace-transfer-required" | "paid-order-resolution-required", readonly details: unknown[]) {
    super(code);
    this.name = "ProfileDeletionConflictError";
  }
}

export async function GET(request: NextRequest) {
  const limit = await rateLimit(request, { namespace: "profile-read", limit: 60, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const session = await requireConfiguredProfileSession(request);
  if (session instanceof Response) return session;

  const workspaces = await listWorkspacesForUser(session.userId);
  const activeWorkspace = workspaces.find((workspace) => workspace.workspaceId === session.workspaceId) ?? workspaces[0] ?? null;
  const profile = await getProfileData(session.userId, activeWorkspace?.workspaceId ?? null);

  return NextResponse.json({
    status: "ok",
    session: {
      userId: session.userId,
      email: session.email,
      workspaceId: session.workspaceId ?? null,
      issuedAt: new Date(session.issuedAt).toISOString(),
      expiresAt: new Date(session.expiresAt).toISOString(),
    },
    user: profile.user,
    activeWorkspace,
    workspaces,
    data: profile.data,
    deleteConfirmation,
  });
}

export async function DELETE(request: NextRequest) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;

  const limit = await rateLimit(request, { namespace: "profile-delete", limit: 4, windowMs: 60 * 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const session = await requireConfiguredProfileSession(request);
  if (session instanceof Response) return session;

  if (Date.now() - session.issuedAt > stepUpWindowMs) {
    return NextResponse.json({
      error: "Recent authentication is required before account deletion. Sign out, sign in again, then retry within 15 minutes.",
      code: "recent-authentication-required",
    }, { status: 403 });
  }

  const body = await readDeleteRequest(request);
  if (body instanceof Response) return body;
  if (body.confirm !== deleteConfirmation) {
    return NextResponse.json({ error: `Type exactly: ${deleteConfirmation}` }, { status: 400 });
  }

  const sharedOwnedWorkspaces = await listSharedOwnedWorkspaces(session.userId);
  if (sharedOwnedWorkspaces.length) {
    return NextResponse.json({
      error: "Transfer or remove the other members of each owned workspace before deleting this account.",
      code: "workspace-transfer-required",
      workspaces: sharedOwnedWorkspaces,
    }, { status: 409 });
  }

  const unresolvedOrders = await listUnresolvedAssistedAuditOrders(session.userId, session.email);
  if (unresolvedOrders.length) {
    return NextResponse.json({
      error: "Resolve or deliver each paid assisted audit before deleting this account.",
      code: "paid-order-resolution-required",
      orders: unresolvedOrders,
    }, { status: 409 });
  }

  const ownedConnectors = await listOwnedConnectorAccounts(session.userId);
  const providerRevocations = await Promise.all(ownedConnectors.map(async (account) => {
    try {
      const outcome = await revokeConnectorCredentialAtProvider({
        connectedAccountId: account.id,
        connectorId: account.connectorId,
      });
      return { connectedAccountId: account.id, connectorId: account.connectorId, ...outcome };
    } catch {
      return {
        connectedAccountId: account.id,
        connectorId: account.connectorId,
        provider: account.connectorId,
        status: "unreachable" as const,
        attempted: true,
        remoteCredentialMayRemainActive: true,
        message: "Provider revocation could not be completed. Revoke or rotate this credential in the provider account.",
      };
    }
  }));
  let result: Awaited<ReturnType<typeof deleteUserData>>;
  try {
    result = await deleteUserData(session.userId, session.email);
  } catch (error) {
    if (error instanceof ProfileDeletionConflictError) {
      return NextResponse.json({
        error: error.code === "workspace-transfer-required"
          ? "Transfer or remove the other members of each owned workspace before deleting this account."
          : "Resolve or deliver each paid assisted audit before deleting this account.",
        code: error.code,
        [error.code === "workspace-transfer-required" ? "workspaces" : "orders"]: error.details,
      }, { status: 409 });
    }
    throw error;
  }
  const response = NextResponse.json({
    status: "deleted",
    ...result,
    providerRevocations,
    providerFollowUpRequired: providerRevocations.some((outcome) => outcome.remoteCredentialMayRemainActive),
  });
  response.cookies.set(sessionCookieName, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}

async function requireConfiguredProfileSession(request: NextRequest) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ status: "not-configured", requiredEnv: ["DATABASE_URL"] }, { status: 501 });
  }

  return session;
}

async function getProfileData(userId: string, workspaceId: string | null) {
  const userResult = await getDatabasePool().query<{ id: string; email: string; display_name: string | null; created_at: Date; updated_at: Date }>(
    `select id, email, display_name, created_at, updated_at
     from users
     where id = $1`,
    [userId],
  );
  const user = userResult.rows[0] ?? null;
  const data = workspaceId ? await getWorkspaceDataCounts(workspaceId) : getEmptyDataCounts();

  return {
    user: user ? {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      createdAt: user.created_at.toISOString(),
      updatedAt: user.updated_at.toISOString(),
    } : null,
    data,
  };
}

async function getWorkspaceDataCounts(workspaceId: string): Promise<ProfileDataCounts> {
  const result = await getDatabasePool().query<{
    audit_reports: string;
    data_sources: string;
    connected_accounts: string;
    uploaded_files: string;
    transactions: string;
    recurring_items: string;
    connector_evidence: string;
    usage_observations: string;
    latest_snapshot_at: Date | null;
    latest_summary: Record<string, unknown> | null;
  }>(
    `select
      ((select count(*) from workspace_states where workspace_id = $1)
        + (select count(*) from recovery_workspace_states where workspace_id = $1)) as audit_reports,
       ((select count(*) from data_sources where workspace_id = $1)
        + (select count(*) from recovery_sources where workspace_id = $1)) as data_sources,
       (select count(*) from connected_accounts
        where workspace_id = $1
          and status = 'active'
          and metadata ->> 'ledgerAuthority' = 'RECOVERY_V1') as connected_accounts,
       (select count(*) from uploaded_files where workspace_id = $1 and deleted_at is null) as uploaded_files,
       ((select count(*) from transactions where workspace_id = $1)
        + (select count(*) from recovery_evidence where workspace_id = $1 and evidence_kind = 'TRANSACTION')) as transactions,
       ((select count(*) from recurring_items where workspace_id = $1)
        + (select count(*) from recovery_commitments where workspace_id = $1)) as recurring_items,
       ((select count(*) from connector_evidence where workspace_id = $1)
        + (select count(*) from recovery_evidence where workspace_id = $1 and provenance_kind = 'PROVIDER_RECEIVED')) as connector_evidence,
       (select count(*) from usage_observations where workspace_id = $1) as usage_observations,
      (select max(updated_at) from (
         select updated_at from workspace_states where workspace_id = $1
         union all
         select updated_at from recovery_workspace_states where workspace_id = $1
       ) saved_state) as latest_snapshot_at,
      coalesce(
        (select summary from workspace_states where workspace_id = $1),
        (select jsonb_build_object(
           'subscriptions', (select count(*) from recovery_commitments where workspace_id = $1),
           'receipts', (select count(*) from recovery_evidence where workspace_id = $1)
         ) where exists (select 1 from recovery_workspace_states where workspace_id = $1))
      ) as latest_summary`,
    [workspaceId],
  );
  const row = result.rows[0];
  if (!row) return getEmptyDataCounts();

  return {
    auditReports: Number(row.audit_reports),
    dataSources: Number(row.data_sources),
    connectedAccounts: Number(row.connected_accounts),
    uploadedFiles: Number(row.uploaded_files),
    transactions: Number(row.transactions),
    recurringItems: Number(row.recurring_items),
    connectorEvidence: Number(row.connector_evidence),
    usageObservations: Number(row.usage_observations),
    latestSnapshotAt: row.latest_snapshot_at?.toISOString() ?? null,
    latestSummary: row.latest_summary,
  };
}

function getEmptyDataCounts(): ProfileDataCounts {
  return {
    auditReports: 0,
    dataSources: 0,
    connectedAccounts: 0,
    uploadedFiles: 0,
    transactions: 0,
    recurringItems: 0,
    connectorEvidence: 0,
    usageObservations: 0,
    latestSnapshotAt: null,
    latestSummary: null,
  };
}

async function listSharedOwnedWorkspaces(userId: string) {
  const result = await getDatabasePool().query<{ id: string; name: string; member_count: string }>(
    `select w.id, w.name, count(wm.user_id)::text as member_count
     from workspaces w
     join workspace_members wm on wm.workspace_id = w.id
     where w.owner_user_id = $1
     group by w.id, w.name
     having count(wm.user_id) > 1`,
    [userId],
  );
  return result.rows.map((row) => ({ id: row.id, name: row.name, memberCount: Number(row.member_count) }));
}

async function listOwnedConnectorAccounts(userId: string) {
  const result = await getDatabasePool().query<{ id: string; connector_id: string }>(
    `select account.id, account.connector_id
     from connected_accounts account
     join workspaces workspace on workspace.id = account.workspace_id
     where workspace.owner_user_id = $1
       and account.status <> 'revoked'
       and account.connector_id <> 'receipt-inbox'
     order by account.created_at asc`,
    [userId],
  );
  return result.rows.map((row) => ({ id: row.id, connectorId: row.connector_id }));
}

async function listUnresolvedAssistedAuditOrders(userId: string, email: string) {
  const result = await getDatabasePool().query<{ checkout_session_id: string; status: string }>(
    `select orders.checkout_session_id, orders.status
     from assisted_audit_orders orders
     join billing_checkout_sessions checkout on checkout.id = orders.checkout_session_id
     where (orders.user_id = $1 or lower(checkout.customer_email) = lower($2))
       and orders.status not in ('delivered', 'refunded')
     order by orders.created_at asc`,
    [userId, email],
  );
  return result.rows.map((row) => ({ checkoutId: row.checkout_session_id, status: row.status }));
}

async function deleteUserData(userId: string, email: string) {
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    await client.query(`select id from users where id = $1 for update`, [userId]);
    await client.query(`select id from workspaces where owner_user_id = $1 for update`, [userId]);
    await client.query(
      `select id from billing_checkout_sessions
       where user_id = $1 or lower(customer_email) = lower($2)
       for update`,
      [userId, email],
    );
    const sharedWorkspaces = await client.query<{ id: string; name: string; member_count: number }>(
      `select w.id, w.name, count(wm.user_id)::int as member_count
       from workspaces w
       join workspace_members wm on wm.workspace_id = w.id
       where w.owner_user_id = $1
       group by w.id, w.name
       having count(wm.user_id) > 1`,
      [userId],
    );
    if (sharedWorkspaces.rows.length) {
      throw new ProfileDeletionConflictError("workspace-transfer-required", sharedWorkspaces.rows.map((row) => ({
        id: row.id,
        name: row.name,
        memberCount: row.member_count,
      })));
    }
    const unresolvedOrders = await client.query<{ checkout_session_id: string; status: string }>(
      `select orders.checkout_session_id, orders.status
       from assisted_audit_orders orders
       join billing_checkout_sessions checkout on checkout.id = orders.checkout_session_id
       where (orders.user_id = $1 or lower(checkout.customer_email) = lower($2))
         and orders.status not in ('delivered', 'refunded')
       for update of orders`,
      [userId, email],
    );
    if (unresolvedOrders.rows.length) {
      throw new ProfileDeletionConflictError("paid-order-resolution-required", unresolvedOrders.rows.map((row) => ({
        checkoutId: row.checkout_session_id,
        status: row.status,
      })));
    }
    const inboxConsents = await client.query<{ id: string; workspace_id: string }>(
      `select id, workspace_id
       from consent_grants
       where purpose = 'receipt-inbox-ingest'
         and withdrawn_at is null
         and workspace_id is not null
         and (user_id = $1 or lower(subject_email) = lower($2))
       for update`,
      [userId, email],
    );
    for (const grant of inboxConsents.rows) {
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`receipt-inbox:${grant.workspace_id}`]);
      await applyReceiptInboxRevocation(client, {
        workspaceId: grant.workspace_id,
        actorUserId: userId,
        consentId: grant.id,
      });
    }
    const waitlistResult = await client.query(`delete from waitlist_leads where lower(email) = lower($1)`, [email]);
    const auditLeadResult = await client.query(`delete from private_audit_leads where lower(email) = lower($1)`, [email]);
    const magicLinkResult = await client.query(`delete from auth_magic_links where lower(email) = lower($1)`, [email]);
    const billingResult = await client.query(
      `update billing_checkout_sessions
       set customer_email = 'deleted+' || replace(id::text, '-', '') || '@redacted.invalid',
           user_id = null,
           workspace_id = null,
           lead_id = null,
           provider_checkout_url = null,
           updated_at = now()
       where lower(customer_email) = lower($1)`,
      [email],
    );
    const consentResult = await client.query(
      `update consent_grants
       set subject_email = null,
           user_id = null,
           withdrawn_at = coalesce(withdrawn_at, now())
       where user_id = $1 or lower(subject_email) = lower($2)`,
      [userId, email],
    );
    const workspaceResult = await client.query<{ id: string }>(
      `delete from workspaces
       where owner_user_id = $1
       returning id`,
      [userId],
    );
    const membershipResult = await client.query(
      `delete from workspace_members
       where user_id = $1`,
      [userId],
    );
    const userResult = await client.query(
      `delete from users
       where id = $1`,
      [userId],
    );
    await client.query("commit");

    return {
      deletedOwnedWorkspaces: workspaceResult.rowCount ?? 0,
      deletedMemberships: membershipResult.rowCount ?? 0,
      deletedUsers: userResult.rowCount ?? 0,
      deletedWaitlistLeads: waitlistResult.rowCount ?? 0,
      deletedAuditLeads: auditLeadResult.rowCount ?? 0,
      deletedMagicLinks: magicLinkResult.rowCount ?? 0,
      pseudonymizedBillingCheckouts: billingResult.rowCount ?? 0,
      anonymizedConsentGrants: consentResult.rowCount ?? 0,
      backupNotice: "Live database rows were deleted. Backup tooling encrypts database dumps, but this codebase does not enforce automatic backup expiry or selective erasure. Operators must retire affected backups under the published policy and must not restore deleted data into the live service.",
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function readDeleteRequest(request: Request): Promise<{ confirm?: string } | Response> {
  try {
    return await readLimitedJson<{ confirm?: string }>(request, 4 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: "Deletion request is too large." }, { status: 413 });
    if (error instanceof UnsupportedContentTypeError) return NextResponse.json({ error: "Content-Type must be application/json." }, { status: 415 });
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
}
