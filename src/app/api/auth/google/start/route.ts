import { NextRequest, NextResponse } from "next/server";
import { googleAuthNextCookie, googleAuthStateCookie, oauthStateCookieOptions, sanitizeOAuthReturnPath } from "@/lib/oauth-state";
import { getGoogleAuthClientId, getGoogleAuthOrigin, getGoogleAuthRedirectUri } from "@/lib/server/google-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const googleAuthScope = "openid email profile";

export function GET(request: NextRequest) {
  const wantsJson = request.nextUrl.searchParams.get("mode") === "json";
  const nextPath = sanitizeOAuthReturnPath(request.nextUrl.searchParams.get("next"));
  const origin = getGoogleAuthOrigin(request.nextUrl.origin);
  const clientId = getGoogleAuthClientId();
  const redirectUri = getGoogleAuthRedirectUri(origin);

  if (!clientId || !origin || !redirectUri) {
    const payload = {
      status: "not-available",
      provider: "google-auth",
      availability: "company-activation-pending",
      message: "Google sign-in is not available yet. Vognary is completing the company setup.",
    };
    return NextResponse.json(payload, { status: wantsJson ? 200 : 501 });
  }

  const state = crypto.randomUUID();
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", googleAuthScope);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("prompt", "select_account");

  if (wantsJson) {
    const response = NextResponse.json({
      status: "ready",
      provider: "google-auth",
      authUrl: authUrl.toString(),
    });
    response.cookies.set(googleAuthStateCookie, state, oauthStateCookieOptions());
    response.cookies.set(googleAuthNextCookie, nextPath, oauthStateCookieOptions());
    return response;
  }

  const response = NextResponse.redirect(authUrl);
  response.cookies.set(googleAuthStateCookie, state, oauthStateCookieOptions());
  response.cookies.set(googleAuthNextCookie, nextPath, oauthStateCookieOptions());
  return response;
}
