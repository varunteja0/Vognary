import { checkSessionConfiguration, readCurrentSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const configuration = checkSessionConfiguration();
  const session = await readCurrentSession(request);

  return Response.json({
    authenticated: Boolean(session),
    configuration,
    session: session ? {
      userId: session.userId,
      email: session.email,
      workspaceId: session.workspaceId ?? null,
      expiresAt: new Date(session.expiresAt).toISOString(),
    } : null,
  });
}
