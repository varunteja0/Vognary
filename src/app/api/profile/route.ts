import { NextRequest, NextResponse } from "next/server";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { getConnectorSummary, getConnectorSyncSummary } from "@/lib/connectors";
import { getDatabasePool, isDatabaseConfigured } from "@/lib/server/database";
import { sessionCookieName } from "@/lib/server/session";
import { checkTokenVaultConfiguration } from "@/lib/server/token-vault";
import { requireSession } from "@/lib/server/workspace-auth";
import { listWorkspacesForUser } from "@/lib/server/workspace-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const deleteConfirmation = "DELETE MY VOGNARY DATA";

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

export async function GET(request: NextRequest) {
  const limit = await rateLimit(request, { namespace: "profile-read", limit: 60, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const session = requireConfiguredProfileSession(request);
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
    integrations: {
      connectedNow: getConnectedNow(profile.data),
      pending: getPendingIntegrations(),
      connectorSummary: getConnectorSummary(),
      connectorSyncSummary: getConnectorSyncSummary(),
      tokenVault: checkTokenVaultConfiguration().status,
    },
    deleteConfirmation,
  });
}

export async function DELETE(request: NextRequest) {
  const limit = await rateLimit(request, { namespace: "profile-delete", limit: 4, windowMs: 60 * 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const session = requireConfiguredProfileSession(request);
  if (session instanceof Response) return session;

  const body = await readJson(request);
  if (body.confirm !== deleteConfirmation) {
    return NextResponse.json({ error: `Type exactly: ${deleteConfirmation}` }, { status: 400 });
  }

  const result = await deleteUserData(session.userId);
  const response = NextResponse.json({ status: "deleted", ...result });
  response.cookies.set(sessionCookieName, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}

function requireConfiguredProfileSession(request: NextRequest) {
  const session = requireSession(request);
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
       (select count(*) from audit_reports where workspace_id = $1) as audit_reports,
       (select count(*) from data_sources where workspace_id = $1) as data_sources,
       (select count(*) from connected_accounts where workspace_id = $1) as connected_accounts,
       (select count(*) from uploaded_files where workspace_id = $1 and deleted_at is null) as uploaded_files,
       (select count(*) from transactions where workspace_id = $1) as transactions,
       (select count(*) from recurring_items where workspace_id = $1) as recurring_items,
       (select count(*) from connector_evidence where workspace_id = $1) as connector_evidence,
       (select count(*) from usage_observations where workspace_id = $1) as usage_observations,
       (select created_at from audit_reports where workspace_id = $1 order by created_at desc limit 1) as latest_snapshot_at,
       (select summary from audit_reports where workspace_id = $1 order by created_at desc limit 1) as latest_summary`,
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

function getConnectedNow(data: ProfileDataCounts) {
  return [
    "Google/private beta identity",
    data.auditReports > 0 ? "Encrypted workspace snapshot" : null,
    data.connectedAccounts > 0 ? "Connected provider accounts" : null,
    data.dataSources > 0 ? "Server data sources" : null,
  ].filter((item): item is string => Boolean(item));
}

function getPendingIntegrations() {
  return [
    "Normalized per-user audit history",
    "Encrypted uploaded file object storage",
    "Gmail persistent receipt sync",
    "Account Aggregator bank data",
    "UPI AutoPay mandate sync",
    "Card e-mandate sync",
    "Apple/Google Play receipt automation",
    "PayPal/Razorpay/Cashfree live connectors",
  ];
}

async function deleteUserData(userId: string) {
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
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
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function readJson(request: Request): Promise<{ confirm?: string }> {
  try {
    return await request.json() as { confirm?: string };
  } catch {
    return {};
  }
}