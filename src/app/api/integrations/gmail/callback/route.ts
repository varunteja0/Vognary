import { NextRequest, NextResponse } from "next/server";
import { gmailOAuthStateCookie, oauthStateCookieOptions } from "@/lib/oauth-state";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { extractReceiptCandidates } from "@/lib/receipt-parser";

export const dynamic = "force-dynamic";

type GmailMessageList = {
  messages?: Array<{ id: string }>;
};

type GmailMessage = {
  snippet?: string;
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
  ].filter((value): value is string => Boolean(value));

  if (missingEnv.length) {
    return NextResponse.json(
      {
        status: "not-configured",
        integration: "gmail-readonly",
        requiredEnv: missingEnv,
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

  if (!tokenResponse.ok) {
    return clearOAuthState(NextResponse.json({ error: "Google token exchange failed." }, { status: 502 }));
  }

  const tokenPayload = await tokenResponse.json() as { access_token?: string };
  if (!tokenPayload.access_token) {
    return clearOAuthState(NextResponse.json({ error: "Google token response did not include an access token." }, { status: 502 }));
  }

  const query = encodeURIComponent('(invoice OR receipt OR subscription OR renewal OR "payment successful") newer_than:365d');
  const listResponse = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=20`, {
    headers: { authorization: `Bearer ${tokenPayload.access_token}` },
  });

  if (!listResponse.ok) {
    return clearOAuthState(NextResponse.json({ error: "Gmail message search failed." }, { status: 502 }));
  }

  const listPayload = await listResponse.json() as GmailMessageList;
  const snippets = await Promise.all((listPayload.messages ?? []).slice(0, 20).map(async (message) => {
    const messageResponse = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}?format=metadata`, {
      headers: { authorization: `Bearer ${tokenPayload.access_token}` },
    });
    if (!messageResponse.ok) return "";
    const payload = await messageResponse.json() as GmailMessage;
    return payload.snippet ?? "";
  }));

  return clearOAuthState(buildGmailImportResponse({
    candidates: extractReceiptCandidates(snippets),
    messageCount: snippets.filter(Boolean).length,
  }));
}

function clearOAuthState(response: NextResponse) {
  response.cookies.set(gmailOAuthStateCookie, "", { ...oauthStateCookieOptions(), maxAge: 0 });
  return response;
}

function getGmailClientId() {
  return process.env.GOOGLE_CLIENT_ID?.trim() || process.env.GOOGLE_AUTH_CLIENT_ID?.trim() || "";
}

function getGmailClientSecret() {
  return process.env.GOOGLE_CLIENT_SECRET?.trim() || process.env.GOOGLE_AUTH_CLIENT_SECRET?.trim() || "";
}

function getGmailRedirectUri(origin: string) {
  const appOrigin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || origin.replace(/\/$/, "");
  return process.env.GOOGLE_REDIRECT_URI?.trim() || `${appOrigin}/api/integrations/gmail/callback`;
}

function buildGmailImportResponse(payload: { candidates: ReturnType<typeof extractReceiptCandidates>; messageCount: number }) {
  const serialized = JSON.stringify({
    status: "connected-preview",
    storage: "browser-import",
    importedAt: new Date().toISOString(),
    ...payload,
  }).replace(/</g, "\\u003c");

  return new NextResponse(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Gmail connected · Vognary</title>
  <style>
    body { background: #0b0c0f; color: #edeef1; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif; display: grid; min-height: 100vh; place-items: center; margin: 0; }
    main { max-width: 32rem; padding: 2rem; border: 1px solid rgba(255,255,255,.12); border-radius: 1rem; background: #131519; }
    p { color: #a6aab4; line-height: 1.6; }
  </style>
</head>
<body>
  <main>
    <h1>Gmail receipt scan complete</h1>
    <p>Found ${payload.candidates.length} recurring candidate(s) from ${payload.messageCount} receipt-like message(s). Returning to your Vognary workspace.</p>
  </main>
  <script>
    localStorage.setItem("vognary.gmail.receipts.v1", ${JSON.stringify(serialized)});
    window.location.replace("/app?gmail=connected");
  </script>
</body>
</html>`, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}