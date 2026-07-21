import { NextRequest, NextResponse } from "next/server";
import { buildConnectorConsentResourceKey } from "@/lib/consent";
import { gmailOAuthBindingCookie, gmailOAuthStateCookie, oauthStateCookieOptions } from "@/lib/oauth-state";
import { currentPrivacyNoticeVersion } from "@/lib/privacy-notice";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { getDatabasePool, isDatabaseConfigured } from "@/lib/server/database";
import { verifyOAuthSessionBinding } from "@/lib/server/oauth-session-binding";
import { readCurrentSession } from "@/lib/server/session";
import { checkTokenVaultConfiguration } from "@/lib/server/token-vault";
import { upsertConnectedAccount, storeConnectorSecret } from "@/lib/server/connector-token-store";
import { createConnectorSyncJob } from "@/lib/server/sync-job-store";
import { requireWorkspaceRole } from "@/lib/server/workspace-auth";
import { recordConsentGrant } from "@/lib/server/consent-store";
import { runConnectorSyncJob } from "@/lib/server/connector-sync-runner";

export const dynamic = "force-dynamic";

const gmailReadonlyScope = "https://www.googleapis.com/auth/gmail.readonly";

type GoogleTokenPayload = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

type GmailProfile = {
  emailAddress?: string;
  messagesTotal?: number;
  threadsTotal?: number;
  historyId?: string;
};

export async function GET(request: NextRequest) {
  const limit = await rateLimit(request, { namespace: "gmail-callback", limit: 20, windowMs: 10 * 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get(gmailOAuthStateCookie)?.value;
  const clientId = getGmailClientId();
  const clientSecret = getGmailClientSecret();
  const redirectUri = getGmailRedirectUri(request.nextUrl.origin);
  const missingEnv = [
    clientId ? null : "GOOGLE_CLIENT_ID or GOOGLE_AUTH_CLIENT_ID",
    clientSecret ? null : "GOOGLE_CLIENT_SECRET or GOOGLE_AUTH_CLIENT_SECRET",
    redirectUri ? null : "GOOGLE_REDIRECT_URI",
  ].filter((value): value is string => Boolean(value));

  if (missingEnv.length) {
    return NextResponse.json(
      {
        status: "not-available",
        integration: "gmail-readonly",
        availability: "company-activation-pending",
        message: "Email connection is not available yet. Vognary is completing the provider approval and company setup.",
      },
      { status: 501 },
    );
  }

  if (!code) {
    return NextResponse.json({ error: "Missing OAuth code." }, { status: 400 });
  }

  if (!state || !expectedState || state !== expectedState) {
    return clearOAuthState(NextResponse.json({ error: "Invalid OAuth state." }, { status: 400 }));
  }

  const currentSession = await readCurrentSession(request);
  if (!currentSession) {
    return clearOAuthState(NextResponse.redirect(new URL("/login?next=/sources", request.nextUrl.origin)));
  }
  if (!currentSession.workspaceId) return clearOAuthState(NextResponse.json({ error: "Session has no workspace. Sign in again." }, { status: 400 }));
  const initialAuthorization = await requireWorkspaceRole(request, currentSession.workspaceId, "admin");
  if (initialAuthorization instanceof Response) return clearOAuthState(initialAuthorization);
  const binding = request.cookies.get(gmailOAuthBindingCookie)?.value;
  if (!verifyOAuthSessionBinding(binding, currentSession, "gmail-readonly")) {
    return clearOAuthState(NextResponse.json({ error: "OAuth session changed before the callback completed." }, { status: 400 }));
  }

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
    signal: AbortSignal.timeout(15_000),
  });

  if (!tokenResponse.ok) {
    return clearOAuthState(NextResponse.json({ error: "Google token exchange failed." }, { status: 502 }));
  }

  const tokenPayload = await tokenResponse.json() as GoogleTokenPayload;
  if (!tokenPayload.access_token) {
    return clearOAuthState(NextResponse.json({ error: "Google token response did not include an access token." }, { status: 502 }));
  }

  try {
    const profile = await fetchGmailProfile(tokenPayload.access_token);
    const scopes = tokenPayload.scope?.split(/\s+/).filter(Boolean) ?? [];
    if (!scopes.includes(gmailReadonlyScope)) throw new Error("Google did not grant the required Gmail scope.");

    const verifiedSession = await readCurrentSession(request);
    if (!verifiedSession?.workspaceId || !verifyOAuthSessionBinding(binding, verifiedSession, "gmail-readonly")) {
      await revokeGoogleTokenBestEffort(tokenPayload.refresh_token ?? tokenPayload.access_token);
      return clearOAuthState(NextResponse.json({ error: "OAuth session expired before the connection could be stored." }, { status: 400 }));
    }
    const authorization = await requireWorkspaceRole(request, verifiedSession.workspaceId, "admin");
    if (authorization instanceof Response) {
      await revokeGoogleTokenBestEffort(tokenPayload.refresh_token ?? tokenPayload.access_token);
      return clearOAuthState(authorization);
    }

    const persistence = await persistSignedInGmailConnection(verifiedSession, tokenPayload, profile);
    if (persistence.status !== "stored") {
      await revokeGoogleTokenBestEffort(tokenPayload.refresh_token ?? tokenPayload.access_token);
      return clearOAuthState(NextResponse.redirect(new URL(`/sources?gmail=${encodeURIComponent(persistence.status)}`, request.nextUrl.origin)));
    }

    const syncResult = await runConnectorSyncJob(persistence.syncJobId, "initial-setup");
    const outcome = syncResult.status === "succeeded" ? "connected" : "sync-pending";
    // Land the user on the workspace, where the first-sync moment renders what
    // was found; /sources stays the destination only for failure states.
    return clearOAuthState(NextResponse.redirect(new URL(`/app?gmail=${outcome}`, request.nextUrl.origin)));
  } catch {
    await revokeGoogleTokenBestEffort(tokenPayload.refresh_token ?? tokenPayload.access_token);
    return clearOAuthState(NextResponse.json({ error: "Gmail identity or scope could not be verified. No connection was stored." }, { status: 502 }));
  }
}

function clearOAuthState(response: Response) {
  const nextResponse = response instanceof NextResponse
    ? response
    : new NextResponse(response.body, { status: response.status, statusText: response.statusText, headers: response.headers });
  nextResponse.cookies.set(gmailOAuthStateCookie, "", { ...oauthStateCookieOptions(), maxAge: 0 });
  nextResponse.cookies.set(gmailOAuthBindingCookie, "", { ...oauthStateCookieOptions(), maxAge: 0 });
  return nextResponse;
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

async function fetchGmailProfile(accessToken: string): Promise<GmailProfile> {
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("Gmail profile request failed.");
  const profile = await response.json() as GmailProfile;
  if (!profile.emailAddress || !/^\S+@\S+\.\S+$/.test(profile.emailAddress)) throw new Error("Gmail profile did not include a valid account email.");
  return profile;
}

async function persistSignedInGmailConnection(session: NonNullable<Awaited<ReturnType<typeof readCurrentSession>>>, tokenPayload: GoogleTokenPayload, profile: GmailProfile) {
  if (!isDatabaseConfigured()) return { status: "database-not-configured" as const };
  if (checkTokenVaultConfiguration().status !== "ready") return { status: "token-vault-not-ready" as const };

  try {
    if (!session.workspaceId) return { status: "workspace-not-configured" as const };
    const workspaceId = session.workspaceId;
    const scopes = tokenPayload.scope?.split(/\s+/).filter(Boolean) ?? [];
    const email = profile.emailAddress!.toLowerCase();
    const client = await getDatabasePool().connect();
    let connectedAccount: Awaited<ReturnType<typeof upsertConnectedAccount>>;
    let syncJob: Awaited<ReturnType<typeof createConnectorSyncJob>>;
    try {
      await client.query("begin");
      const consent = await recordConsentGrant({
        workspaceId,
        userId: session.userId,
        subjectEmail: session.email,
        resourceKey: buildConnectorConsentResourceKey("gmail-readonly", email),
        purpose: "gmail-readonly-sync",
        noticeVersion: currentPrivacyNoticeVersion,
        source: "gmail-oauth-callback",
        scopes,
      }, client);
      connectedAccount = await upsertConnectedAccount({
        workspaceId,
        consentGrantId: consent.id,
        connectorId: "gmail-readonly",
        authType: "oauth",
        providerAccountId: email,
        displayName: `Gmail receipts (${email})`,
        scopes,
        metadata: {
          provider: "google",
          emailAddress: email,
          messagesTotal: profile.messagesTotal ?? null,
          threadsTotal: profile.threadsTotal ?? null,
          historyId: profile.historyId ?? null,
          connectedAt: new Date().toISOString(),
        },
      }, client);
      await storeConnectorSecret({
        connectedAccountId: connectedAccount.id,
        tokenKind: "access",
        secret: tokenPayload.access_token ?? "",
        scopes,
        expiresAt: tokenPayload.expires_in ? new Date(Date.now() + tokenPayload.expires_in * 1000).toISOString() : null,
        metadata: { provider: "google", tokenType: tokenPayload.token_type ?? "Bearer" },
      }, client);
      if (tokenPayload.refresh_token) {
        await storeConnectorSecret({
          connectedAccountId: connectedAccount.id,
          tokenKind: "refresh",
          secret: tokenPayload.refresh_token,
          scopes,
          metadata: { provider: "google" },
        }, client);
      }
      syncJob = await createConnectorSyncJob({
        workspaceId,
        connectedAccountId: connectedAccount.id,
        connectorId: "gmail-readonly",
        jobType: "initial_sync",
        priority: 40,
        cursorState: { source: "gmail-oauth-callback" },
      }, client);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      await revokeGoogleTokenBestEffort(tokenPayload.refresh_token ?? tokenPayload.access_token ?? "");
      throw error;
    } finally {
      client.release();
    }

    return {
      status: "stored" as const,
      workspaceId,
      connectedAccountId: connectedAccount.id,
      syncJobId: syncJob.id,
      refreshTokenStored: Boolean(tokenPayload.refresh_token),
    };
  } catch (error) {
    return {
      status: "storage-failed" as const,
      message: error instanceof Error ? error.message : "Could not persist Gmail connection.",
    };
  }
}

async function revokeGoogleTokenBestEffort(token: string) {
  if (!token) return;
  await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
}
