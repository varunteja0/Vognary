import { getDatabasePool, isDatabaseConfigured } from "@/lib/server/database";
import { appendLedgerEvent } from "@/lib/server/ledger-event-store";

export const workspaceTypes = ["personal", "family", "founder", "team"] as const;
export type WorkspaceType = typeof workspaceTypes[number];

export type WorkspaceMembership = {
  workspaceId: string;
  workspaceName: string;
  role: "owner" | "admin" | "member" | "viewer";
  plan: string;
  workspaceType: WorkspaceType;
};

export type WorkspaceUser = {
  id: string;
  email: string;
  displayName: string | null;
};

export class WorkspaceIdentityConflictError extends Error {
  constructor() {
    super("This email is already linked to a different Google identity.");
    this.name = "WorkspaceIdentityConflictError";
  }
}

export function assertDatabaseReadyForWorkspaces() {
  if (!isDatabaseConfigured()) throw new Error("DATABASE_URL is required for workspace authorization.");
}

export async function listWorkspacesForUser(userId: string): Promise<WorkspaceMembership[]> {
  assertDatabaseReadyForWorkspaces();

  const result = await getDatabasePool().query<WorkspaceMembershipRow>(
    `select w.id as workspace_id, w.name as workspace_name, w.plan, w.workspace_type, wm.role
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

export async function getOrCreateUserByGoogleIdentity(input: {
  issuer: string;
  subject: string;
  email: string;
  displayName?: string;
}): Promise<WorkspaceUser> {
  assertDatabaseReadyForWorkspaces();
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    const identityKey = `google:${input.issuer}:${input.subject}`;
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [identityKey]);

    const existingIdentity = await client.query<WorkspaceUserRow>(
      `select users.id, users.email, users.display_name
       from auth_identities identity
       join users on users.id = identity.user_id
       where identity.provider = 'google' and identity.issuer = $1 and identity.subject = $2`,
      [input.issuer, input.subject],
    );
    if (existingIdentity.rows[0]) {
      const updated = await client.query<WorkspaceUserRow>(
        `update users
         set display_name = coalesce(nullif($2, ''), display_name), updated_at = now(), deleted_at = null
         where id = $1
         returning id, email, display_name`,
        [existingIdentity.rows[0].id, input.displayName?.trim() ?? ""],
      );
      await client.query(
        `update auth_identities set email_at_link = $3, updated_at = now()
         where provider = 'google' and issuer = $1 and subject = $2`,
        [input.issuer, input.subject, input.email],
      );
      await client.query("commit");
      return mapWorkspaceUser(updated.rows[0]);
    }

    const emailUser = await client.query<WorkspaceUserRow>(
      `select id, email, display_name from users where lower(email) = lower($1) for update`,
      [input.email],
    );
    let user = emailUser.rows[0];
    if (user) {
      const conflictingIdentity = await client.query(
        `select 1 from auth_identities where provider = 'google' and user_id = $1`,
        [user.id],
      );
      if (conflictingIdentity.rows[0]) throw new WorkspaceIdentityConflictError();
      const establishedAccount = await client.query(
        `select exists (
           select 1 from workspace_members where user_id = $1
           union all
           select 1 from auth_sessions where user_id = $1
         ) as established`,
        [user.id],
      );
      if (establishedAccount.rows[0]?.established) throw new WorkspaceIdentityConflictError();
      const updated = await client.query<WorkspaceUserRow>(
        `update users
         set display_name = coalesce(nullif($2, ''), display_name), updated_at = now(), deleted_at = null
         where id = $1
         returning id, email, display_name`,
        [user.id, input.displayName?.trim() ?? ""],
      );
      user = updated.rows[0];
    } else {
      const inserted = await client.query<WorkspaceUserRow>(
        `insert into users (email, display_name)
         values ($1, nullif($2, ''))
         returning id, email, display_name`,
        [input.email, input.displayName?.trim() ?? ""],
      );
      user = inserted.rows[0];
    }
    if (!user) throw new Error("Google identity user upsert did not return a user.");

    await client.query(
      `insert into auth_identities (provider, issuer, subject, user_id, email_at_link)
       values ('google', $1, $2, $3, $4)`,
      [input.issuer, input.subject, user.id, input.email],
    );
    await client.query("commit");
    return mapWorkspaceUser(user);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function getOrCreateDefaultWorkspaceForUser(input: { userId: string; workspaceName?: string }) {
  assertDatabaseReadyForWorkspaces();
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    const user = await client.query<{ id: string }>(
      `select id from users where id = $1 and deleted_at is null for update`,
      [input.userId],
    );
    if (!user.rows[0]) throw new Error("Workspace user was not found.");

    const existing = await client.query<WorkspaceMembershipRow>(
      `select w.id as workspace_id, w.name as workspace_name, w.plan, w.workspace_type, wm.role
       from workspace_members wm
       join workspaces w on w.id = wm.workspace_id
       where wm.user_id = $1
       order by w.created_at asc
       limit 1`,
      [input.userId],
    );
    if (existing.rows[0]) {
      await client.query("commit");
      return mapWorkspaceMembership(existing.rows[0]);
    }

    const name = input.workspaceName?.trim() || "Vognary Workspace";
    const workspace = await client.query<{ id: string; name: string; plan: string; workspace_type: WorkspaceType }>(
      `insert into workspaces (owner_user_id, name, plan, workspace_type)
       values ($1, $2, 'private_beta', 'personal')
       returning id, name, plan, workspace_type`,
      [input.userId, name],
    );
    const row = workspace.rows[0];
    if (!row) throw new Error("Default workspace insert did not return a row.");
    await client.query(
      `insert into workspace_members (workspace_id, user_id, role)
       values ($1, $2, 'owner')`,
      [row.id, input.userId],
    );
    await client.query("commit");
    return {
      workspaceId: row.id,
      workspaceName: row.name,
      plan: row.plan,
      workspaceType: row.workspace_type,
      role: "owner" as const,
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function getWorkspaceMembership(userId: string, workspaceId: string) {
  assertDatabaseReadyForWorkspaces();

  const result = await getDatabasePool().query<WorkspaceMembershipRow>(
    `select w.id as workspace_id, w.name as workspace_name, w.plan, w.workspace_type, wm.role
     from workspace_members wm
     join workspaces w on w.id = wm.workspace_id
     where wm.user_id = $1
       and wm.workspace_id = $2`,
    [userId, workspaceId],
  );

  const row = result.rows[0];
  return row ? mapWorkspaceMembership(row) : null;
}

export async function createWorkspaceForUser(input: { userId: string; name: string; plan?: string; workspaceType?: WorkspaceType }) {
  assertDatabaseReadyForWorkspaces();

  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    const workspace = await client.query<{ id: string; name: string; plan: string; workspace_type: WorkspaceType }>(
      `insert into workspaces (owner_user_id, name, plan, workspace_type)
       values ($1, $2, $3, $4)
       returning id, name, plan, workspace_type`,
      [input.userId, input.name, input.plan ?? "founder", input.workspaceType ?? "personal"],
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
      workspaceType: workspace.rows[0]?.workspace_type ?? input.workspaceType ?? "personal",
      role: "owner" as const,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateWorkspaceType(input: {
  workspaceId: string;
  userId: string;
  workspaceType: WorkspaceType;
  idempotencyKey: string;
}) {
  if (!workspaceTypes.includes(input.workspaceType)) throw new Error("Workspace type is invalid.");
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(input.idempotencyKey)) throw new Error("A valid Idempotency-Key is required.");
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    const current = await client.query<{ workspace_type: WorkspaceType; name: string; plan: string }>(
      `select workspace_type, name, plan from workspaces where id = $1 for update`,
      [input.workspaceId],
    );
    const row = current.rows[0];
    if (!row) throw new Error("Workspace was not found.");
    if (row.workspace_type !== input.workspaceType) {
      await client.query(
        `update workspaces set workspace_type = $2, updated_at = now() where id = $1`,
        [input.workspaceId, input.workspaceType],
      );
      await appendLedgerEvent({
        workspaceId: input.workspaceId,
        actorUserId: input.userId,
        eventType: "workspace.type.updated",
        entityKind: "workspace",
        entityRef: input.workspaceId,
        idempotencyKey: `workspace-type:${input.idempotencyKey}`,
        payload: { previousWorkspaceType: row.workspace_type, workspaceType: input.workspaceType },
      }, client);
      await client.query(
        `insert into audit_log (workspace_id, user_id, action, entity_type, entity_id, metadata)
         values ($1, $2, 'workspace.type.updated', 'workspace', $1,
                 jsonb_build_object('previousType', $3::text, 'workspaceType', $4::text))`,
        [input.workspaceId, input.userId, row.workspace_type, input.workspaceType],
      );
    }
    await client.query("commit");
    return {
      workspaceId: input.workspaceId,
      workspaceName: row.name,
      plan: row.plan,
      workspaceType: input.workspaceType,
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
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
  workspace_type: WorkspaceType;
};

type WorkspaceUserRow = {
  id: string;
  email: string;
  display_name: string | null;
};

function mapWorkspaceUser(row: WorkspaceUserRow | undefined): WorkspaceUser {
  if (!row) throw new Error("User query did not return a user.");
  return { id: row.id, email: row.email, displayName: row.display_name };
}

function mapWorkspaceMembership(row: WorkspaceMembershipRow): WorkspaceMembership {
  return {
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    role: row.role,
    plan: row.plan,
    workspaceType: row.workspace_type,
  };
}
