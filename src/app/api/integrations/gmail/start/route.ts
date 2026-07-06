import { NextResponse } from "next/server";
import { gmailOAuthStateCookie, oauthStateCookieOptions } from "@/lib/oauth-state";

export const dynamic = "force-dynamic";

const gmailReadonlyScope = "https://www.googleapis.com/auth/gmail.readonly";

export function GET(request: Request) {
  const url = new URL(request.url);
  const wantsJson = url.searchParams.get("mode") === "json";
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    const payload = {
      status: "not-configured",
      integration: "gmail-readonly",
      requiredEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_REDIRECT_URI"],
      scope: gmailReadonlyScope,
    };

    if (wantsJson) return NextResponse.json(payload);

    return NextResponse.json(
      payload,
      { status: 501 },
    );
  }

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", gmailReadonlyScope);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  const state = crypto.randomUUID();
  authUrl.searchParams.set("state", state);

  if (wantsJson) {
    const response = NextResponse.json({
      status: "ready",
      integration: "gmail-readonly",
      authUrl: authUrl.toString(),
      scope: gmailReadonlyScope,
    });
    response.cookies.set(gmailOAuthStateCookie, state, oauthStateCookieOptions());
    return response;
  }

  const response = NextResponse.redirect(authUrl);
  response.cookies.set(gmailOAuthStateCookie, state, oauthStateCookieOptions());
  return response;
}