import { getDatabasePool, isDatabaseConfigured } from "@/lib/server/database";

export type WorkspaceMembership = {
  workspaceId: string;
  workspaceName: string;
  role: "owner" | "admin" | "member" | "viewer";
  plan: string;
};

export type WorkspaceUser = {
  id: string;
  email: string;
  displayName: string | null;
};

export function assertDatabaseReadyForWorkspaces() {
  if (!isDatabaseConfigured()) throw new Error("DATABASE_URL is required for workspace authorization.");
}

export async function listWorkspacesForUser(userId: string): Promise<WorkspaceMembership[]> {
  assertDatabaseReadyForWorkspaces();

  const result = await getDatabasePool().query<WorkspaceMembershipRow>(
    `select w.id as workspace_id, w.name as workspace_name, w.plan, wm.role
     from workspace_members wm
     join workspaces w on w.id = wm.workspace_id
     where wm.user_id = $1
       and w.updated_at is not null
     order by w.created_at asc`,
    [userId],
  );

  return result.rows.map(mapWorkspaceMembership);
}

export async function getOrCreateUserByEmail(input: { email: string; displayName?: string }): Promise<WorkspaceUser> {
  assertDatabaseReadyForWorkspaces();

  const result = await getDatabasePool().query<WorkspaceUserRow>(
    `insert into users (email, display_name)
     values ($1, nullif($2, ''))
     on conflict (email) do update
       set display_name = coalesce(nullif(excluded.display_name, ''), users.display_name),
           updated_at = now(),
           deleted_at = null
     returning id, email, display_name`,
    [input.email, input.displayName?.trim() ?? ""],
  );

  const row = result.rows[0];
  if (!row) throw new Error("User upsert did not return a user.");
  return { id: row.id, email: row.email, displayName: row.display_name };
}

export async function getOrCreateDefaultWorkspaceForUser(input: { userId: string; workspaceName?: string }) {
  const existing = await listWorkspacesForUser(input.userId);
  if (existing[0]) return existing[0];

  return createWorkspaceForUser({
    userId: input.userId,
    name: input.workspaceName?.trim() || "Vognary Workspace",
    plan: "private_beta",
  });
}

export async function getWorkspaceMembership(userId: string, workspaceId: string) {
  assertDatabaseReadyForWorkspaces();

  const result = await getDatabasePool().query<WorkspaceMembershipRow>(
    `select w.id as workspace_id, w.name as workspace_name, w.plan, wm.role
     from workspace_members wm
     join workspaces w on w.id = wm.workspace_id
     where wm.user_id = $1
       and wm.workspace_id = $2`,
    [userId, workspaceId],
  );

  const row = result.rows[0];
  return row ? mapWorkspaceMembership(row) : null;
}

export async function createWorkspaceForUser(input: { userId: string; name: string; plan?: string }) {
  assertDatabaseReadyForWorkspaces();

  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    const workspace = await client.query<{ id: string; name: string; plan: string }>(
      `insert into workspaces (owner_user_id, name, plan)
       values ($1, $2, $3)
       returning id, name, plan`,
      [input.userId, input.name, input.plan ?? "founder"],
    );
    const workspaceId = workspace.rows[0]?.id;
    if (!workspaceId) throw new Error("Workspace insert did not return an id.");

    await client.query(
      `insert into workspace_members (workspace_id, user_id, role)
       values ($1, $2, 'owner')`,
      [workspaceId, input.userId],
    );
    await client.query("commit");

    return {
      workspaceId,
      workspaceName: workspace.rows[0]?.name ?? input.name,
      plan: workspace.rows[0]?.plan ?? input.plan ?? "founder",
      role: "owner" as const,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

type WorkspaceMembershipRow = {
  workspace_id: string;
  workspace_name: string;
  role: WorkspaceMembership["role"];
  plan: string;
};

type WorkspaceUserRow = {
  id: string;
  email: string;
  display_name: string | null;
};

function mapWorkspaceMembership(row: WorkspaceMembershipRow): WorkspaceMembership {
  return {
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    role: row.role,
    plan: row.plan,
  };
}