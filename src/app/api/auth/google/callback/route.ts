import { NextRequest, NextResponse } from "next/server";
import { googleAuthNextCookie, googleAuthStateCookie, oauthStateCookieOptions, sanitizeOAuthReturnPath } from "@/lib/oauth-state";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import {
  checkGoogleAuthConfiguration,
  getGoogleAuthClientId,
  getGoogleAuthClientSecret,
  getGoogleAuthOrigin,
  getGoogleAuthRedirectUri,
  getGoogleWorkspaceName,
  isGoogleEmailAllowed,
  verifyGoogleIdToken,
} from "@/lib/server/google-auth";
import { createSessionCookie, sessionCookieOptions } from "@/lib/server/session";
import {
  getOrCreateDefaultWorkspaceForUser,
  getOrCreateUserByGoogleIdentity,
  WorkspaceIdentityConflictError,
} from "@/lib/server/workspace-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const limit = await rateLimit(request, { namespace: "google-auth-callback", limit: 20, windowMs: 10 * 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const configuration = checkGoogleAuthConfiguration();
  if (configuration.status !== "ready") {
    return NextResponse.json({ status: "not-configured", provider: "google-auth", requiredEnv: configuration.missing }, { status: 501 });
  }

  const code = request.nextUrl.searchParams.get("code")?.trim() ?? "";
  const state = request.nextUrl.searchParams.get("state")?.trim() ?? "";
  const expectedState = request.cookies.get(googleAuthStateCookie)?.value;
  if (!code) return redirectToLogin(request, "missing-code");
  if (!state || !expectedState || state !== expectedState) return redirectToLogin(request, "invalid-state");

  const origin = getGoogleAuthOrigin(request.nextUrl.origin);
  const clientId = getGoogleAuthClientId();
  const clientSecret = getGoogleAuthClientSecret();
  const redirectUri = getGoogleAuthRedirectUri(origin);

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenResponse.ok) return redirectToLogin(request, "token-exchange-failed");
  const tokenPayload = await tokenResponse.json() as { id_token?: string };
  if (!tokenPayload.id_token) return redirectToLogin(request, "missing-id-token");

  const tokenInfo = await verifyGoogleIdToken(tokenPayload.id_token, clientId).catch(() => null);
  if (!tokenInfo) return redirectToLogin(request, "token-validation-failed");

  if (tokenInfo.aud !== clientId) return redirectToLogin(request, "audience-mismatch");
  if (tokenInfo.email_verified !== true && tokenInfo.email_verified !== "true") return redirectToLogin(request, "email-not-verified");
  if (!tokenInfo.email) return redirectToLogin(request, "missing-email");
  if (!tokenInfo.iss || !tokenInfo.sub) return redirectToLogin(request, "missing-subject");
  if (!isGoogleEmailAllowed(tokenInfo.email)) return redirectToLogin(request, "not-allowed");

  let user;
  try {
    user = await getOrCreateUserByGoogleIdentity({
      issuer: tokenInfo.iss,
      subject: tokenInfo.sub,
      email: tokenInfo.email.toLowerCase(),
      displayName: tokenInfo.name,
    });
  } catch (error) {
    if (error instanceof WorkspaceIdentityConflictError) return redirectToLogin(request, "identity-conflict");
    throw error;
  }
  const workspace = await getOrCreateDefaultWorkspaceForUser({ userId: user.id, workspaceName: getGoogleWorkspaceName(tokenInfo) });
  const cookie = await createSessionCookie({ userId: user.id, workspaceId: workspace.workspaceId });

  const nextPath = sanitizeOAuthReturnPath(request.cookies.get(googleAuthNextCookie)?.value);
  const response = clearGoogleState(NextResponse.redirect(new URL(nextPath, request.nextUrl.origin)));
  response.cookies.set(cookie.name, cookie.value, sessionCookieOptions(cookie.maxAgeSeconds));
  return response;
}

function redirectToLogin(request: NextRequest, reason: string) {
  const url = new URL("/login", request.nextUrl.origin);
  url.searchParams.set("google", reason);
  const nextPath = sanitizeOAuthReturnPath(request.cookies.get(googleAuthNextCookie)?.value);
  if (nextPath !== "/app") url.searchParams.set("next", nextPath);
  return clearGoogleState(NextResponse.redirect(url));
}

function clearGoogleState(response: NextResponse) {
  response.cookies.set(googleAuthStateCookie, "", { ...oauthStateCookieOptions(), maxAge: 0 });
  response.cookies.set(googleAuthNextCookie, "", { ...oauthStateCookieOptions(), maxAge: 0 });
  return response;
}
