import { NextRequest, NextResponse } from "next/server";
import { googleAuthStateCookie, oauthStateCookieOptions } from "@/lib/oauth-state";
import { getGoogleAuthClientId, getGoogleAuthOrigin, getGoogleAuthRedirectUri } from "@/lib/server/google-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const googleAuthScope = "openid email profile";

export function GET(request: NextRequest) {
  const wantsJson = request.nextUrl.searchParams.get("mode") === "json";
  const origin = getGoogleAuthOrigin(request.nextUrl.origin);
  const clientId = getGoogleAuthClientId();
  const redirectUri = getGoogleAuthRedirectUri(origin);

  if (!clientId) {
    const payload = {
      status: "not-configured",
      provider: "google-auth",
      requiredEnv: ["GOOGLE_AUTH_CLIENT_ID or GOOGLE_CLIENT_ID"],
      redirectUri,
      message: "Google login needs a Google OAuth client ID.",
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
      redirectUri,
      scope: googleAuthScope,
    });
    response.cookies.set(googleAuthStateCookie, state, oauthStateCookieOptions());
    return response;
  }

  const response = NextResponse.redirect(authUrl);
  response.cookies.set(googleAuthStateCookie, state, oauthStateCookieOptions());
  return response;
}