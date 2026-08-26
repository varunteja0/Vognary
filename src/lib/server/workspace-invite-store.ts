import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { getDatabasePool } from "@/lib/server/database";
import { RecoveryServiceError } from "@/lib/server/recovery-api";
import { isResendConfigured, sendWithResend } from "@/lib/server/resend-mailer";

const inviteRoles = ["admin", "member"] as const;
export type WorkspaceInviteRole = typeof inviteRoles[number];

export type WorkspaceMemberRecord = {
  userId: string;
  email: string;
  displayName: string | null;
  role: "owner" | "admin" | "member" | "viewer";
  createdAt: string;
};

export type WorkspaceInviteRecord = {
  id: string;
  email: string;
  role: WorkspaceInviteRole;
  invitedByUserId: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
};

export type AcceptedWorkspaceInvite = {
  workspaceId: string;
  workspaceName: string;
  role: WorkspaceInviteRole;
  inviteId: string;
};

function normalizeInviteEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new RecoveryServiceError("INVALID_EVIDENCE", "Invite email is not valid.");
  }
  return email;
}

function hashInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeInviteStoreError(error: unknown) {
  if (error instanceof RecoveryServiceError) return error;
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  if (code === "42P01") {
    return new RecoveryServiceError("FEATURE_UNAVAILABLE", "Workspace invites are not available for this deployment.");
  }
  if (code === "23505") return new RecoveryServiceError("CONFLICT", "An open invite already exists for that email.");
  if (code === "23503") return new RecoveryServiceError("NOT_FOUND");
  return new RecoveryServiceError("SAVE_FAILED", error instanceof Error ? error.message : undefined, { retryable: true });
}

async function assertAdmin(client: PoolClient, userId: string, workspaceId: string) {
  const membership = await client.query<{ role: WorkspaceMemberRecord["role"] }>(
    `select role from workspace_members where workspace_id = $1 and user_id = $2`,
    [workspaceId, userId],
  );
  const role = membership.rows[0]?.role;
  if (role !== "owner" && role !== "admin") {
    throw new RecoveryServiceError("FORBIDDEN", "A workspace owner or admin must manage people.");
  }
  return role;
}

export async function listWorkspacePeople(input: { workspaceId: string; actorUserId: string }) {
  const client = await getDatabasePool().connect();
  try {
    await assertAdmin(client, input.actorUserId, input.workspaceId);
    const members = await client.query<{
      user_id: string;
      email: string;
      display_name: string | null;
      role: WorkspaceMemberRecord["role"];
      created_at: Date;
    }>(
      `select wm.user_id, u.email, u.display_name, wm.role, wm.created_at
       from workspace_members wm
       join users u on u.id = wm.user_id
       where wm.workspace_id = $1
       order by wm.created_at asc, u.email asc`,
      [input.workspaceId],
    );
    const invites = await client.query<{
      id: string;
      email: string;
      role: WorkspaceInviteRole;
      invited_by_user_id: string | null;
      expires_at: Date;
      accepted_at: Date | null;
      revoked_at: Date | null;
      created_at: Date;
    }>(
      `select id, email, role, invited_by_user_id, expires_at, accepted_at, revoked_at, created_at
       from workspace_invites
       where workspace_id = $1
       order by created_at desc`,
      [input.workspaceId],
    );
    return {
      members: members.rows.map((row) => ({
        userId: row.user_id,
        email: row.email,
        displayName: row.display_name,
        role: row.role,
        createdAt: row.created_at.toISOString(),
      })),
      invites: invites.rows.map(mapInvite),
    };
  } catch (error) {
    throw normalizeInviteStoreError(error);
  } finally {
    client.release();
  }
}

export async function createWorkspaceInvite(input: {
  workspaceId: string;
  actorUserId: string;
  email: string;
  role: string;
}) {
  if (!inviteRoles.includes(input.role as WorkspaceInviteRole)) {
    throw new RecoveryServiceError("INVALID_EVIDENCE", "Invite role must be admin or member.");
  }
  const email = normalizeInviteEmail(input.email);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const client = await getDatabasePool().connect();
  let invite: WorkspaceInviteRecord;
  let workspaceName = "Vognary workspace";
  try {
    await client.query("begin");
    await assertAdmin(client, input.actorUserId, input.workspaceId);
    const existingMember = await client.query<{ user_id: string }>(
      `select wm.user_id
       from workspace_members wm
       join users u on u.id = wm.user_id
       where wm.workspace_id = $1 and lower(u.email) = $2`,
      [input.workspaceId, email],
    );
    if (existingMember.rows[0]) {
      throw new RecoveryServiceError("CONFLICT", "That person is already a member of this workspace.");
    }
    const workspace = await client.query<{ name: string }>(
      `select name from workspaces where id = $1`,
      [input.workspaceId],
    );
    workspaceName = workspace.rows[0]?.name ?? workspaceName;
    const inserted = await client.query<{
      id: string;
      email: string;
      role: WorkspaceInviteRole;
      invited_by_user_id: string | null;
      expires_at: Date;
      accepted_at: Date | null;
      revoked_at: Date | null;
      created_at: Date;
    }>(
      `insert into workspace_invites (
         workspace_id, email, role, token_hash, invited_by_user_id, expires_at
       ) values ($1, $2, $3, $4, $5, $6)
       returning id, email, role, invited_by_user_id, expires_at, accepted_at, revoked_at, created_at`,
      [input.workspaceId, email, input.role, hashInviteToken(token), input.actorUserId, expiresAt],
    );
    const row = inserted.rows[0];
    if (!row) throw new RecoveryServiceError("SAVE_FAILED");
    invite = mapInvite(row);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw normalizeInviteStoreError(error);
  } finally {
    client.release();
  }

  await sendInviteEmail({
    email,
    workspaceName,
    role: invite.role,
    inviteId: invite.id,
  }).catch(() => undefined);
  return invite;
}

export async function revokeWorkspaceInvite(input: {
  workspaceId: string;
  actorUserId: string;
  inviteId: string;
}) {
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    await assertAdmin(client, input.actorUserId, input.workspaceId);
    const updated = await client.query<{ id: string }>(
      `update workspace_invites
       set revoked_at = now()
       where id = $1
         and workspace_id = $2
         and accepted_at is null
         and revoked_at is null
       returning id`,
      [input.inviteId, input.workspaceId],
    );
    if (!updated.rows[0]) throw new RecoveryServiceError("NOT_FOUND", "That invite is not open.");
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw normalizeInviteStoreError(error);
  } finally {
    client.release();
  }
}

export async function acceptOpenWorkspaceInvitesForUser(input: {
  userId: string;
  email: string;
}): Promise<AcceptedWorkspaceInvite | null> {
  const email = normalizeInviteEmail(input.email);
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    const open = await client.query<{
      id: string;
      workspace_id: string;
      workspace_name: string;
      role: WorkspaceInviteRole;
    }>(
      `select invite.id, invite.workspace_id, workspace.name as workspace_name, invite.role
       from workspace_invites invite
       join workspaces workspace on workspace.id = invite.workspace_id
       where invite.email = $1
         and invite.accepted_at is null
         and invite.revoked_at is null
         and invite.expires_at > now()
       order by invite.created_at desc`,
      [email],
    );
    if (!open.rows.length) {
      await client.query("commit");
      return null;
    }
    let bound: AcceptedWorkspaceInvite | null = null;
    for (const row of open.rows) {
      await client.query(
        `insert into workspace_members (workspace_id, user_id, role)
         values ($1, $2, $3)
         on conflict (workspace_id, user_id) do nothing`,
        [row.workspace_id, input.userId, row.role],
      );
      await client.query(
        `update workspace_invites
         set accepted_at = now(), accepted_by_user_id = $2
         where id = $1 and accepted_at is null and revoked_at is null`,
        [row.id, input.userId],
      );
      bound ??= {
        workspaceId: row.workspace_id,
        workspaceName: row.workspace_name,
        role: row.role,
        inviteId: row.id,
      };
    }
    await client.query("commit");
    return bound;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    const normalized = normalizeInviteStoreError(error);
    if (normalized.code === "FEATURE_UNAVAILABLE") return null;
    throw normalized;
  } finally {
    client.release();
  }
}

export async function countAuthorizingAdmins(client: PoolClient, workspaceId: string) {
  const result = await client.query<{ count: string }>(
    `select count(*)::text as count
     from workspace_members
     where workspace_id = $1 and role in ('owner', 'admin')`,
    [workspaceId],
  );
  return Number(result.rows[0]?.count ?? "0");
}

async function sendInviteEmail(input: {
  email: string;
  workspaceName: string;
  role: WorkspaceInviteRole;
  inviteId: string;
}) {
  if (!isResendConfigured()) return;
  const origin = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim() || "";
  const loginUrl = origin ? `${origin.replace(/\/$/, "")}/login` : "/login";
  const text = [
    `You were invited to ${input.workspaceName} on Vognary as ${input.role}.`,
    "Sign in with the same Google account as this email. Vognary will attach you to that workspace.",
    `Open ${loginUrl}`,
    "Vognary never purchases, provisions, cancels, or moves money.",
  ].join("\n");
  await sendWithResend({
    email: input.email,
    idempotencyKey: `workspace-invite/${input.inviteId}`,
    message: {
      subject: `Join ${input.workspaceName} on Vognary`,
      text,
      html: `<p>${text.replaceAll("\n", "<br>")}</p>`,
    },
  });
}

function mapInvite(row: {
  id: string;
  email: string;
  role: WorkspaceInviteRole;
  invited_by_user_id: string | null;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}): WorkspaceInviteRecord {
  const expired = !row.accepted_at && !row.revoked_at && row.expires_at.getTime() <= Date.now();
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    invitedByUserId: row.invited_by_user_id,
    expiresAt: row.expires_at.toISOString(),
    acceptedAt: row.accepted_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    status: row.revoked_at ? "REVOKED" : row.accepted_at ? "ACCEPTED" : expired ? "EXPIRED" : "PENDING",
  };
}
