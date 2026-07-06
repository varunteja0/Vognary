import { NextRequest, NextResponse } from "next/server";
import { extractReceiptCandidates } from "@/lib/receipt-parser";

type GmailMessageList = {
  messages?: Array<{ id: string }>;
};

type GmailMessage = {
  snippet?: string;
};

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json(
      {
        status: "not-configured",
        integration: "gmail-readonly",
        requiredEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"],
      },
      { status: 501 },
    );
  }

  if (!code) {
    return NextResponse.json({ error: "Missing OAuth code." }, { status: 400 });
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
    return NextResponse.json({ error: "Google token exchange failed." }, { status: 502 });
  }

  const tokenPayload = await tokenResponse.json() as { access_token?: string };
  if (!tokenPayload.access_token) {
    return NextResponse.json({ error: "Google token response did not include an access token." }, { status: 502 });
  }

  const query = encodeURIComponent('(invoice OR receipt OR subscription OR renewal OR "payment successful") newer_than:365d');
  const listResponse = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=20`, {
    headers: { authorization: `Bearer ${tokenPayload.access_token}` },
  });

  if (!listResponse.ok) {
    return NextResponse.json({ error: "Gmail message search failed." }, { status: 502 });
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

  return NextResponse.json({
    status: "connected-preview",
    storage: "none",
    candidates: extractReceiptCandidates(snippets),
    messageCount: snippets.filter(Boolean).length,
  });
}