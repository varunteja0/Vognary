import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { isDatabaseConfigured } from "@/lib/server/database";
import { createSessionCookie, sessionCookieOptions } from "@/lib/server/session";
import { getOrCreateDefaultWorkspaceForUser, getOrCreateUserByEmail } from "@/lib/server/workspace-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type LoginRequest = {
  email?: string;
  name?: string;
  workspaceName?: string;
  accessCode?: string;
};

export async function POST(request: NextRequest) {
  const limit = await rateLimit(request, { namespace: "auth-login", limit: 8, windowMs: 60 * 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const missingEnv = getMissingLoginEnv();
  if (missingEnv.length) {
    return NextResponse.json({
      status: "not-configured",
      requiredEnv: missingEnv,
      message: "Private beta login needs a database, signed session secret, and beta access code before it can issue sessions.",
    }, { status: 501 });
  }

  const body = await readJson(request);
  const email = body.email?.trim().toLowerCase() ?? "";
  const accessCode = body.accessCode?.trim() ?? "";

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ error: "Valid email is required." }, { status: 400 });
  }
  if (!accessCode || !isValidAccessCode(accessCode, process.env.PRIVATE_BETA_ACCESS_CODE ?? "")) {
    return NextResponse.json({ error: "Invalid private beta access code." }, { status: 401 });
  }

  const user = await getOrCreateUserByEmail({ email, displayName: body.name });
  const workspace = await getOrCreateDefaultWorkspaceForUser({ userId: user.id, workspaceName: body.workspaceName });
  const cookie = createSessionCookie({ userId: user.id, email: user.email, workspaceId: workspace.workspaceId });

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

function getMissingLoginEnv() {
  return [
    process.env.SESSION_SECRET ? null : "SESSION_SECRET",
    isDatabaseConfigured() ? null : "DATABASE_URL",
    process.env.PRIVATE_BETA_ACCESS_CODE ? null : "PRIVATE_BETA_ACCESS_CODE",
  ].filter((value): value is string => Boolean(value));
}

async function readJson(request: Request): Promise<LoginRequest> {
  try {
    return await request.json() as LoginRequest;
  } catch {
    return {};
  }
}

function isValidAccessCode(supplied: string, expected: string) {
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}