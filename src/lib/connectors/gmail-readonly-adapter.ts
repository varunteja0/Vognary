import { createHash } from "node:crypto";
import type { ConnectorAdapter, ConnectorConnection, ConnectorEvidence } from "@/lib/connector-runtime";
import { extractReceiptCandidates } from "@/lib/receipt-parser";
import { storeConnectorSecret } from "@/lib/server/connector-token-store";

type GmailMessageList = {
  messages?: Array<{ id: string }>;
};

type GmailMessage = {
  id?: string;
  snippet?: string;
};

type GmailProfile = {
  emailAddress?: string;
  messagesTotal?: number;
  threadsTotal?: number;
  historyId?: string;
};

type GoogleRefreshTokenPayload = {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

const gmailReadonlyScope = "https://www.googleapis.com/auth/gmail.readonly";
const receiptQuery = '(invoice OR receipt OR subscription OR renewal OR "payment successful") newer_than:365d';

export const gmailReadonlyAdapter: ConnectorAdapter = {
  id: "gmail-readonly",
  async connect(connection) {
    const accessToken = await getUsableAccessToken(connection);
    return {
      ...connection,
      accessToken,
      accessRef: connection.accessRef ?? "vault:access",
      scopes: connection.scopes.length ? connection.scopes : [gmailReadonlyScope],
    };
  },
  async sync(connection) {
    if (!connection.accessToken) throw new Error("Gmail access token is not available for sync.");

    const profile = await fetchGmailProfile(connection.accessToken);
    const snippets = await fetchReceiptSnippets(connection.accessToken);
    const candidates = extractReceiptCandidates(snippets.map((message) => message.snippet ?? ""));
    const observedAt = new Date().toISOString();

    return candidates.map((candidate, index): ConnectorEvidence => ({
      connectorId: gmailReadonlyAdapter.id,
      provider: "gmail",
      observedAt,
      evidenceType: "receipt",
      merchantRaw: candidate.merchant,
      amount: candidate.amount,
      currency: inferCurrency(candidate.evidenceText),
      cadenceHint: candidate.frequency,
      nextDebitHint: candidate.nextExpectedDate,
      sourcePayloadHash: hashPayload({
        connectedAccountId: connection.connectedAccountId,
        emailAddress: profile?.emailAddress,
        historyId: profile?.historyId,
        candidateId: candidate.id,
        index,
        evidenceText: candidate.evidenceText,
      }),
      confidence: candidate.confidenceScore,
    }));
  },
};

async function getUsableAccessToken(connection: ConnectorConnection) {
  if (connection.accessToken && !isExpiringSoon(connection.expiresAt)) return connection.accessToken;
  if (!connection.refreshToken) {
    if (connection.accessToken) return connection.accessToken;
    throw new Error("Gmail refresh token is missing. Ask the user to reconnect Gmail.");
  }

  const clientId = getGmailClientId();
  const clientSecret = getGmailClientSecret();
  if (!clientId || !clientSecret) throw new Error("Google OAuth client credentials are required to refresh Gmail access.");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: connection.refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) throw new Error(`Gmail token refresh failed with ${response.status}.`);

  const payload = await response.json() as GoogleRefreshTokenPayload;
  if (!payload.access_token) throw new Error("Gmail token refresh did not return an access token.");

  if (connection.connectedAccountId) {
    await storeConnectorSecret({
      connectedAccountId: connection.connectedAccountId,
      tokenKind: "access",
      secret: payload.access_token,
      scopes: payload.scope?.split(/\s+/).filter(Boolean) ?? connection.scopes,
      expiresAt: payload.expires_in ? new Date(Date.now() + payload.expires_in * 1000).toISOString() : null,
      metadata: { provider: "google", tokenType: payload.token_type ?? "Bearer", refreshedAt: new Date().toISOString() },
    });
  }

  return payload.access_token;
}

async function fetchGmailProfile(accessToken: string): Promise<GmailProfile | null> {
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) return null;
  return await response.json() as GmailProfile;
}

async function fetchReceiptSnippets(accessToken: string) {
  const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  listUrl.searchParams.set("q", receiptQuery);
  listUrl.searchParams.set("maxResults", "30");

  const listResponse = await fetch(listUrl, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });

  if (!listResponse.ok) throw new Error(`Gmail message search failed with ${listResponse.status}.`);

  const listPayload = await listResponse.json() as GmailMessageList;
  const messages = await Promise.all((listPayload.messages ?? []).slice(0, 30).map(async (message) => {
    const messageUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}`);
    messageUrl.searchParams.set("format", "metadata");

    const messageResponse = await fetch(messageUrl, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (!messageResponse.ok) return { id: message.id, snippet: "" } satisfies GmailMessage;
    return await messageResponse.json() as GmailMessage;
  }));

  return messages.filter((message) => Boolean(message.snippet));
}

function isExpiringSoon(expiresAt: string | undefined) {
  if (!expiresAt) return false;
  const expiresAtMs = new Date(expiresAt).getTime();
  return Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now() + 60_000;
}

function getGmailClientId() {
  return process.env.GOOGLE_CLIENT_ID?.trim() || process.env.GOOGLE_AUTH_CLIENT_ID?.trim() || "";
}

function getGmailClientSecret() {
  return process.env.GOOGLE_CLIENT_SECRET?.trim() || process.env.GOOGLE_AUTH_CLIENT_SECRET?.trim() || "";
}

function inferCurrency(evidenceText: string) {
  if (/\$|USD/i.test(evidenceText)) return "USD";
  return "INR";
}

function hashPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("base64url");
}