import { NextRequest, NextResponse } from "next/server";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { isDatabaseConfigured } from "@/lib/server/database";
import { checkDevelopmentLoginConfiguration, validateDevelopmentLogin } from "@/lib/server/development-login";
import { readLimitedJson, RequestBodyTooLargeError, UnsupportedContentTypeError } from "@/lib/server/request-body";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import { createSessionCookie, sessionCookieOptions } from "@/lib/server/session";
import { getOrCreateDefaultWorkspaceForUser, getOrCreateUserByEmail } from "@/lib/server/workspace-store";
import { acceptOpenWorkspaceInvitesForUser } from "@/lib/server/workspace-invite-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type LoginRequest = {
  email?: string;
  name?: string;
  workspaceName?: string;
  accessCode?: string;
};

export async function GET() {
  const developmentLogin = checkDevelopmentLoginConfiguration();
  const missing = developmentLogin.status === "not-configured"
    ? getMissingLoginEnv(developmentLogin.missing)
    : [];
  return NextResponse.json({
    status: developmentLogin.status,
    requiredEnv: missing,
    productionAvailable: false,
  }, { status: developmentLogin.status === "not-configured" ? 501 : 200 });
}

export async function POST(request: NextRequest) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;

  const limit = await rateLimit(request, { namespace: "auth-login", limit: 8, windowMs: 60 * 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const developmentLogin = checkDevelopmentLoginConfiguration();
  if (developmentLogin.status === "disabled") {
    return NextResponse.json({
      status: "disabled",
      message: "Code login is disabled. Use Google sign-in.",
    }, { status: 404 });
  }

  const missingEnv = getMissingLoginEnv(developmentLogin.missing);
  if (missingEnv.length) {
    return NextResponse.json({
      status: "not-configured",
      requiredEnv: missingEnv,
      message: "Development login needs a database, signed session secret, and an explicitly configured email-bound development identity.",
    }, { status: 501 });
  }

  const body = await readLoginJson(request);
  if (body instanceof Response) return body;
  const email = body.email?.trim().toLowerCase() ?? "";
  const accessCode = body.accessCode?.trim() ?? "";

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ error: "Valid email is required." }, { status: 400 });
  }
  if (!accessCode || !validateDevelopmentLogin({ email, accessCode })) {
    return NextResponse.json({ error: "Invalid development login credentials." }, { status: 401 });
  }

  const user = await getOrCreateUserByEmail({ email, displayName: body.name });
  const accepted = await acceptOpenWorkspaceInvitesForUser({ userId: user.id, email }).catch(() => null);
  const workspace = accepted
    ? { workspaceId: accepted.workspaceId, workspaceName: accepted.workspaceName, role: accepted.role, plan: "private_beta" }
    : await getOrCreateDefaultWorkspaceForUser({ userId: user.id, workspaceName: body.workspaceName });
  const cookie = await createSessionCookie({ userId: user.id, workspaceId: workspace.workspaceId });

  const response = NextResponse.json({
    status: "authenticated",
    session: {
      userId: user.id,
      email: user.email,
      workspaceId: workspace.workspaceId,
      workspaceName: workspace.workspaceName,
      role: workspace.role,
      plan: workspace.plan,
    },
  });
  response.cookies.set(cookie.name, cookie.value, sessionCookieOptions(cookie.maxAgeSeconds));
  return response;
}

function getMissingLoginEnv(developmentLoginMissing: string[]) {
  return [
    process.env.SESSION_SECRET ? null : "SESSION_SECRET",
    isDatabaseConfigured() ? null : "DATABASE_URL",
    ...developmentLoginMissing,
  ].filter((value): value is string => Boolean(value));
}

async function readLoginJson(request: Request): Promise<LoginRequest | Response> {
  try {
    return await readLimitedJson<LoginRequest>(request, 8 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: "Login request is too large." }, { status: 413 });
    if (error instanceof UnsupportedContentTypeError) return NextResponse.json({ error: "Content-Type must be application/json." }, { status: 415 });
    return NextResponse.json({ error: "Login request must be valid JSON." }, { status: 400 });
  }
}
