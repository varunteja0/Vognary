import { readSession, type AuthSession } from "@/lib/server/session";
import { getWorkspaceMembership, type WorkspaceMembership } from "@/lib/server/workspace-store";

export type WorkspaceRole = WorkspaceMembership["role"];

const roleRank: Record<WorkspaceRole, number> = {
  viewer: 1,
  member: 2,
  admin: 3,
  owner: 4,
};

export function requireSession(request: Request): AuthSession | Response {
  const session = readSession(request);
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
  return session;
}

export async function requireWorkspaceRole(request: Request, workspaceId: string, minimumRole: WorkspaceRole) {
  const session = requireSession(request);
  if (session instanceof Response) return session;

  const membership = await getWorkspaceMembership(session.userId, workspaceId);
  if (!membership) return Response.json({ error: "Workspace access denied." }, { status: 403 });
  if (roleRank[membership.role] < roleRank[minimumRole]) return Response.json({ error: "Workspace role is insufficient." }, { status: 403 });

  return { session, membership };
}