import { getDatabasePool, isDatabaseConfigured } from "@/lib/server/database";

export type WorkspaceMembership = {
  workspaceId: string;
  workspaceName: string;
  role: "owner" | "admin" | "member" | "viewer";
  plan: string;
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

function mapWorkspaceMembership(row: WorkspaceMembershipRow): WorkspaceMembership {
  return {
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    role: row.role,
    plan: row.plan,
  };
}