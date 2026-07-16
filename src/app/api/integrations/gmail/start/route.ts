import { NextResponse } from "next/server";
import { gmailOAuthBindingCookie, gmailOAuthStateCookie, oauthStateCookieOptions } from "@/lib/oauth-state";
import { currentPrivacyNoticeVersion } from "@/lib/privacy-notice";
import { isDatabaseConfigured } from "@/lib/server/database";
import { createOAuthSessionBinding } from "@/lib/server/oauth-session-binding";
import { readCurrentSession } from "@/lib/server/session";
import { checkTokenVaultConfiguration } from "@/lib/server/token-vault";
import { requireWorkspaceRole } from "@/lib/server/workspace-auth";

export const dynamic = "force-dynamic";

const gmailReadonlyScope = "https://www.googleapis.com/auth/gmail.readonly";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const wantsJson = url.searchParams.get("mode") === "json";
  const session = await readCurrentSession(request);
  if (!session) {
    if (wantsJson) return NextResponse.json({ status: "unauthenticated", message: "Sign in before connecting Gmail." }, { status: 401 });
    return NextResponse.redirect(new URL("/login?next=/sources", url.origin));
  }
  if (!session.workspaceId) return NextResponse.json({ error: "Session has no workspace. Sign in again." }, { status: 400 });
  const authorization = await requireWorkspaceRole(request, session.workspaceId, "admin");
  if (authorization instanceof Response) return authorization;
  const clientId = getGmailClientId();
  const clientSecret = getGmailClientSecret();
  const redirectUri = getGmailRedirectUri(url.origin);
  const missingEnv = [
    isDatabaseConfigured() ? null : "DATABASE_URL",
    checkTokenVaultConfiguration().status === "ready" ? null : "TOKEN_ENCRYPTION_KEY",
    clientId ? null : "GOOGLE_CLIENT_ID or GOOGLE_AUTH_CLIENT_ID",
    clientSecret ? null : "GOOGLE_CLIENT_SECRET or GOOGLE_AUTH_CLIENT_SECRET",
    redirectUri ? null : "GOOGLE_REDIRECT_URI",
    process.env.NODE_ENV !== "production" || process.env.GOOGLE_OAUTH_VERIFICATION_COMPLETE === "true"
      ? null
      : "GOOGLE_OAUTH_VERIFICATION_COMPLETE=true",
  ].filter((value): value is string => Boolean(value));

  if (missingEnv.length) {
    const payload = {
      status: "not-configured",
      integration: "gmail-readonly",
      requiredEnv: missingEnv,
      redirectUri,
      scope: gmailReadonlyScope,
      noticeVersion: currentPrivacyNoticeVersion,
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
  authUrl.searchParams.set("include_granted_scopes", "true");
  const state = crypto.randomUUID();
  const binding = createOAuthSessionBinding(session, "gmail-readonly");
  authUrl.searchParams.set("state", state);

  if (wantsJson) {
    const response = NextResponse.json({
      status: "ready",
      integration: "gmail-readonly",
      authUrl: authUrl.toString(),
      redirectUri,
      scope: gmailReadonlyScope,
      noticeVersion: currentPrivacyNoticeVersion,
    });
    response.cookies.set(gmailOAuthStateCookie, state, oauthStateCookieOptions());
    response.cookies.set(gmailOAuthBindingCookie, binding, oauthStateCookieOptions());
    return response;
  }

  const response = NextResponse.redirect(authUrl);
  response.cookies.set(gmailOAuthStateCookie, state, oauthStateCookieOptions());
  response.cookies.set(gmailOAuthBindingCookie, binding, oauthStateCookieOptions());
  return response;
}

function getGmailClientId() {
  return process.env.GOOGLE_CLIENT_ID?.trim() || process.env.GOOGLE_AUTH_CLIENT_ID?.trim() || "";
}

function getGmailClientSecret() {
  return process.env.GOOGLE_CLIENT_SECRET?.trim() || process.env.GOOGLE_AUTH_CLIENT_SECRET?.trim() || "";
}

function getGmailRedirectUri(origin: string) {
  const configured = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === "https:" || (process.env.NODE_ENV !== "production" && url.protocol === "http:")) return url.toString();
    } catch {
      return "";
    }
  }
  return process.env.NODE_ENV === "production" ? "" : `${origin.replace(/\/$/, "")}/api/integrations/gmail/callback`;
}
