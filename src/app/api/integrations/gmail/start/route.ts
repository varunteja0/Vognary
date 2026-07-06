import { NextResponse } from "next/server";

const gmailReadonlyScope = "https://www.googleapis.com/auth/gmail.readonly";

export function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      {
        status: "not-configured",
        integration: "gmail-readonly",
        requiredEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_REDIRECT_URI"],
        scope: gmailReadonlyScope,
      },
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
  authUrl.searchParams.set("state", crypto.randomUUID());

  return NextResponse.redirect(authUrl);
}