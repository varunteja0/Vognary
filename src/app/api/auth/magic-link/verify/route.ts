import { NextRequest, NextResponse } from "next/server";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { checkMagicLinkConfiguration, consumeMagicLinkChallenge } from "@/lib/server/magic-link-auth";
import { createSessionCookie, sessionCookieOptions } from "@/lib/server/session";
import { getOrCreateDefaultWorkspaceForUser, getOrCreateUserByEmail } from "@/lib/server/workspace-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const limit = await rateLimit(request, { namespace: "magic-link-verify", limit: 12, windowMs: 60 * 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const configuration = checkMagicLinkConfiguration();
  if (configuration.status !== "ready") {
    return NextResponse.json({ status: "not-configured", requiredEnv: configuration.missing }, { status: 501 });
  }

  const token = request.nextUrl.searchParams.get("token")?.trim() ?? "";
  if (!token) return redirectToLogin(request, "missing");

  const challenge = await consumeMagicLinkChallenge(token);
  if (!challenge) return redirectToLogin(request, "invalid");

  const user = await getOrCreateUserByEmail({ email: challenge.email, displayName: challenge.displayName ?? undefined });
  const workspace = await getOrCreateDefaultWorkspaceForUser({ userId: user.id, workspaceName: challenge.workspaceName ?? undefined });
  const cookie = await createSessionCookie({ userId: user.id, workspaceId: workspace.workspaceId });

  const response = NextResponse.redirect(new URL(challenge.redirectPath, getCanonicalAppOrigin(request)));
  response.cookies.set(cookie.name, cookie.value, sessionCookieOptions(cookie.maxAgeSeconds));
  return response;
}

function getCanonicalAppOrigin(request: NextRequest) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured) return request.nextUrl.origin;

  try {
    return new URL(configured).origin;
  } catch {
    return request.nextUrl.origin;
  }
}

function redirectToLogin(request: NextRequest, reason: string) {
  const url = new URL("/login", request.nextUrl.origin);
  url.searchParams.set("magic", reason);
  return NextResponse.redirect(url);
}
