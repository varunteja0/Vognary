import { createHash } from "node:crypto";
import type {
  ConnectorAdapter,
  ConnectorConnection,
  ConnectorEvidence,
  ConnectorSyncContext,
  ConnectorSyncResult,
} from "@/lib/connector-runtime";
import { ConnectorReauthorizationRequiredError } from "@/lib/connector-errors";
import { extractReceiptCandidates } from "@/lib/receipt-parser";
import { storeConnectorSecret } from "@/lib/server/connector-token-store";

type GmailMessageList = {
  messages?: Array<{ id?: string }>;
  nextPageToken?: string;
};

type GmailHistoryList = {
  history?: Array<{
    messagesAdded?: Array<{ message?: { id?: string } }>;
  }>;
  historyId?: string;
  nextPageToken?: string;
};

type GmailMessagePart = {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: {
    data?: string;
    size?: number;
    attachmentId?: string;
  };
  parts?: GmailMessagePart[];
};

type GmailMessage = {
  id?: string;
  snippet?: string;
  internalDate?: string;
  sizeEstimate?: number;
  payload?: GmailMessagePart;
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
  error?: string;
};

type GmailSearchBatch = {
  messageIds: string[];
  nextPageToken: string | null;
};

type GmailHistoryBatch = {
  messageIds: string[];
  nextPageToken: string | null;
  historyId: string | null;
};

const gmailReadonlyScope = "https://www.googleapis.com/auth/gmail.readonly";
const receiptQuery = '(invoice OR receipt OR subscription OR renewal OR "payment successful" OR "will be debited" OR autopay) newer_than:365d';
const gmailRequestTimeoutMs = 12_000;
const gmailListPageSize = 50;
const gmailListPagesPerRun = 2;
const gmailHistoryPagesPerRun = 2;
const gmailMessagesPerRun = 100;
const gmailMaxPendingMessageIds = 500;
const gmailMessageFetchConcurrency = 5;
const gmailMaxPartCount = 64;
const gmailMaxPartBytes = 128 * 1_024;
const gmailMaxEncodedPartChars = Math.ceil(gmailMaxPartBytes * 1.5);
const gmailMaxExtractedTextChars = 96 * 1_024;
const gmailSnippetFallbackChars = 1_024;
const gmailBackfillWindowMs = 365 * 24 * 60 * 60 * 1_000;

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
  async sync(connection, context) {
    if (!connection.accessToken) throw new Error("Gmail access token is not available for sync.");

    const observedAt = new Date().toISOString();
    const profile = await fetchGmailProfile(connection.accessToken);
    if (!profile.historyId) throw new Error("Gmail profile did not return a history cursor.");

    const previousHistoryId = asNonEmptyString(context?.cursorState.historyId);
    return previousHistoryId
      ? syncHistory(connection.accessToken, profile.historyId, previousHistoryId, context, observedAt)
      : syncBackfill(connection.accessToken, profile.historyId, context, observedAt, false);
  },
};

async function syncBackfill(
  accessToken: string,
  currentHistoryId: string,
  context: ConnectorSyncContext | undefined,
  observedAt: string,
  cursorExpired: boolean,
): Promise<ConnectorSyncResult> {
  const cursor = context?.cursorState ?? {};
  const pageToken = cursorExpired ? null : asNonEmptyString(cursor.gmailSearchPageToken);
  const targetHistoryId = cursorExpired
    ? currentHistoryId
    : asNonEmptyString(cursor.gmailBackfillHistoryId) ?? currentHistoryId;
  const coverageStartAt = cursorExpired
    ? backfillStart(observedAt)
    : asTimestamp(cursor.gmailBackfillStartedAt) ?? backfillStart(observedAt);
  const search = await searchReceiptMessageIds(accessToken, pageToken);
  const messages = await fetchGmailMessages(accessToken, search.messageIds);
  const evidence = normalizeReceiptEvidence(messages, observedAt);
  const continuation = Boolean(search.nextPageToken);

  return {
    evidence,
    nextCursorState: continuation
      ? {
        gmailSearchPageToken: search.nextPageToken,
        gmailBackfillHistoryId: targetHistoryId,
        gmailBackfillStartedAt: coverageStartAt,
      }
      : {
        historyId: targetHistoryId,
        syncedAt: observedAt,
      },
    nextSyncAt: nextSyncAt(continuation),
    continuation,
    coverage: {
      startAt: coverageStartAt,
      endAt: observedAt,
      completeness: continuation ? "partial" : "complete",
    },
  };
}

async function syncHistory(
  accessToken: string,
  currentHistoryId: string,
  previousHistoryId: string,
  context: ConnectorSyncContext | undefined,
  observedAt: string,
): Promise<ConnectorSyncResult> {
  const cursor = context?.cursorState ?? {};
  const previousSyncedAt = asTimestamp(cursor.syncedAt);
  const historyStartedAt = asTimestamp(cursor.gmailHistoryStartedAt) ?? previousSyncedAt ?? observedAt;
  const existingPending = asBoundedStringArray(cursor.gmailPendingMessageIds);
  let messageIds: string[];
  let remainingPending: string[];
  let nextPageToken = asNonEmptyString(cursor.historyPageToken);
  const targetHistoryId = asNonEmptyString(cursor.gmailHistoryTargetId) ?? currentHistoryId;

  if (existingPending.length) {
    messageIds = existingPending.slice(0, gmailMessagesPerRun);
    remainingPending = existingPending.slice(gmailMessagesPerRun);
  } else {
    const history = await fetchHistoryMessageIds(accessToken, previousHistoryId, nextPageToken);
    if (!history) {
      // Gmail uses 404 when startHistoryId is outside its retained history
      // window. Restart the bounded 365-day receipt backfill and establish a
      // fresh cursor without asking the user to upload anything.
      return syncBackfill(accessToken, currentHistoryId, undefined, observedAt, true);
    }

    if (history.messageIds.length > gmailMaxPendingMessageIds + gmailMessagesPerRun) {
      throw new Error("Gmail history batch exceeded the bounded pending-message limit.");
    }

    messageIds = history.messageIds.slice(0, gmailMessagesPerRun);
    remainingPending = history.messageIds.slice(gmailMessagesPerRun);
    nextPageToken = history.nextPageToken;
    // Keep the profile cursor captured before this history pass. Advancing to a
    // newer historyId returned while pagination is in flight could skip mail
    // that arrived after the captured boundary; replaying it next run is safe.
  }

  const messages = await fetchGmailMessages(accessToken, messageIds);
  const evidence = normalizeReceiptEvidence(messages, observedAt);
  const continuation = remainingPending.length > 0 || Boolean(nextPageToken);

  return {
    evidence,
    nextCursorState: continuation
      ? compactRecord({
        historyId: previousHistoryId,
        syncedAt: previousSyncedAt ?? historyStartedAt,
        historyPageToken: nextPageToken,
        gmailPendingMessageIds: remainingPending.length ? remainingPending : undefined,
        gmailHistoryTargetId: targetHistoryId,
        gmailHistoryStartedAt: historyStartedAt,
      })
      : {
        historyId: targetHistoryId,
        syncedAt: observedAt,
      },
    nextSyncAt: nextSyncAt(continuation),
    continuation,
    coverage: {
      startAt: previousSyncedAt ?? historyStartedAt,
      endAt: observedAt,
      completeness: continuation ? "partial" : "complete",
    },
  };
}

function normalizeReceiptEvidence(messages: GmailMessage[], observedAt: string): ConnectorEvidence[] {
  return messages.flatMap((message): ConnectorEvidence[] => {
    if (!message.id) return [];
    const selectedText = extractGmailMessageText(message);
    if (!selectedText) return [];

    const contentHash = hashText(selectedText);
    return extractReceiptCandidates([selectedText]).map((candidate, candidateIndex) => ({
      connectorId: gmailReadonlyAdapter.id,
      externalId: `gmail-message:${message.id}:receipt:${candidateIndex}`,
      provider: "gmail",
      observedAt: gmailMessageTimestamp(message.internalDate) ?? observedAt,
      evidenceType: "receipt",
      merchantRaw: candidate.merchant,
      amount: candidate.amount,
      currency: candidate.currency,
      category: candidate.category,
      cadenceHint: candidate.frequency,
      nextDebitHint: candidate.nextExpectedDate,
      // Only normalized fields and one-way digests leave this adapter. Neither
      // the MIME body, subject, snippet, nor parser evidenceText is persisted.
      sourcePayloadHash: hashPayload({
        messageId: message.id,
        candidateIndex,
        merchant: candidate.merchant,
        amount: candidate.amount,
        currency: candidate.currency,
        frequency: candidate.frequency,
        nextExpectedDate: candidate.nextExpectedDate,
        contentHash,
      }),
      confidence: candidate.confidenceScore,
    }));
  });
}

async function getUsableAccessToken(connection: ConnectorConnection) {
  if (connection.accessToken && !isExpiringSoon(connection.expiresAt)) return connection.accessToken;
  if (!connection.refreshToken) {
    throw gmailReauthorizationRequired();
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
    signal: AbortSignal.timeout(gmailRequestTimeoutMs),
  });

  const payload = await response.json().catch(() => ({})) as GoogleRefreshTokenPayload;
  if (response.status === 401 || payload.error === "invalid_grant") {
    throw gmailReauthorizationRequired();
  }
  if (!response.ok) throw new Error(`Gmail token refresh failed with ${response.status}.`);
  if (!payload.access_token) throw new Error("Gmail token refresh did not return an access token.");

  if (connection.connectedAccountId) {
    await storeConnectorSecret({
      connectedAccountId: connection.connectedAccountId,
      tokenKind: "access",
      secret: payload.access_token,
      scopes: payload.scope?.split(/\s+/).filter(Boolean) ?? connection.scopes,
      expiresAt: payload.expires_in ? new Date(Date.now() + payload.expires_in * 1_000).toISOString() : null,
      metadata: { provider: "google", tokenType: payload.token_type ?? "Bearer", refreshedAt: new Date().toISOString() },
    });
  }

  return payload.access_token;
}

async function fetchGmailProfile(accessToken: string): Promise<GmailProfile> {
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(gmailRequestTimeoutMs),
  });

  assertGmailResponseAuthorized(response, "profile fetch");
  return await response.json() as GmailProfile;
}

async function searchReceiptMessageIds(accessToken: string, initialPageToken: string | null): Promise<GmailSearchBatch> {
  const messageIds = new Set<string>();
  let pageToken = initialPageToken;
  let pagesRead = 0;

  do {
    const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    listUrl.searchParams.set("q", receiptQuery);
    listUrl.searchParams.set("maxResults", String(gmailListPageSize));
    if (pageToken) listUrl.searchParams.set("pageToken", pageToken);

    const response = await fetch(listUrl, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(gmailRequestTimeoutMs),
    });
    assertGmailResponseAuthorized(response, "message search");

    const payload = await response.json() as GmailMessageList;
    for (const message of payload.messages ?? []) {
      if (message.id) messageIds.add(message.id);
    }
    pageToken = asNonEmptyString(payload.nextPageToken);
    pagesRead += 1;
  } while (pageToken && pagesRead < gmailListPagesPerRun);

  return { messageIds: [...messageIds], nextPageToken: pageToken };
}

async function fetchHistoryMessageIds(
  accessToken: string,
  startHistoryId: string,
  initialPageToken: string | null,
): Promise<GmailHistoryBatch | null> {
  const messageIds = new Set<string>();
  let pageToken = initialPageToken;
  let pagesRead = 0;
  let latestHistoryId: string | null = null;

  do {
    const historyUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/history");
    historyUrl.searchParams.set("startHistoryId", startHistoryId);
    historyUrl.searchParams.set("historyTypes", "messageAdded");
    historyUrl.searchParams.set("maxResults", String(gmailListPageSize));
    if (pageToken) historyUrl.searchParams.set("pageToken", pageToken);

    const response = await fetch(historyUrl, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(gmailRequestTimeoutMs),
    });
    if (response.status === 404) return null;
    assertGmailResponseAuthorized(response, "history sync");

    const payload = await response.json() as GmailHistoryList;
    for (const entry of payload.history ?? []) {
      for (const added of entry.messagesAdded ?? []) {
        if (added.message?.id) messageIds.add(added.message.id);
      }
    }
    latestHistoryId = asNonEmptyString(payload.historyId) ?? latestHistoryId;
    pageToken = asNonEmptyString(payload.nextPageToken);
    pagesRead += 1;
  } while (pageToken && pagesRead < gmailHistoryPagesPerRun);

  return {
    messageIds: [...messageIds],
    nextPageToken: pageToken,
    historyId: latestHistoryId,
  };
}

async function fetchGmailMessages(accessToken: string, messageIds: string[]) {
  const messages = await mapWithConcurrency(messageIds, gmailMessageFetchConcurrency, (messageId) => (
    fetchGmailMessage(accessToken, messageId)
  ));
  return messages.filter((message): message is GmailMessage => Boolean(message));
}

async function fetchGmailMessage(accessToken: string, messageId: string) {
  const messageUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}`);
  messageUrl.searchParams.set("format", "full");
  messageUrl.searchParams.set("fields", "id,internalDate,sizeEstimate,snippet,payload");

  const response = await fetch(messageUrl, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(gmailRequestTimeoutMs),
  });

  if (response.status === 404) return null;
  assertGmailResponseAuthorized(response, "message fetch");
  return await response.json() as GmailMessage;
}

function assertGmailResponseAuthorized(response: Response, operation: string) {
  if (response.status === 401) throw gmailReauthorizationRequired();
  if (!response.ok) throw new Error(`Gmail ${operation} failed with ${response.status}.`);
}

function gmailReauthorizationRequired() {
  return new ConnectorReauthorizationRequiredError(
    "gmail",
    "Gmail authorization has expired or was revoked. Reconnect Gmail to resume automatic sync.",
  );
}

/** Decode one bounded Gmail base64url MIME body. Invalid/oversized input fails closed. */
export function decodeGmailBase64Url(data: string, maxBytes = gmailMaxPartBytes): string | null {
  if (!data || maxBytes <= 0 || data.length > gmailMaxEncodedPartChars) return null;
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(data)) return null;

  try {
    const unpadded = data.replace(/=+$/g, "");
    const base64 = unpadded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const decoded = Buffer.from(padded, "base64");
    if (!decoded.length || decoded.length > Math.min(maxBytes, gmailMaxPartBytes)) return null;
    return decoded.toString("utf8").replace(/\u0000/g, "");
  } catch {
    return null;
  }
}

/** Select bounded inline text/plain MIME content, falling back to sanitized HTML/snippet. */
export function extractGmailMessageText(message: GmailMessage): string {
  const plainParts: string[] = [];
  const htmlParts: string[] = [];
  let plainChars = 0;
  let htmlChars = 0;
  let visitedParts = 0;

  const addBounded = (parts: string[], value: string, currentChars: number) => {
    const remaining = gmailMaxExtractedTextChars - currentChars;
    if (remaining <= 0) return currentChars;
    const selected = value.slice(0, remaining);
    if (selected) parts.push(selected);
    return currentChars + selected.length;
  };

  const visit = (part: GmailMessagePart | undefined) => {
    if (!part || visitedParts >= gmailMaxPartCount) return;
    visitedParts += 1;

    const attachment = Boolean(part.filename?.trim() || part.body?.attachmentId || hasAttachmentDisposition(part.headers));
    const declaredSize = part.body?.size ?? 0;
    if (!attachment && part.body?.data && declaredSize <= gmailMaxPartBytes) {
      const decoded = decodeGmailBase64Url(part.body.data);
      if (decoded) {
        if (part.mimeType?.toLowerCase() === "text/plain") plainChars = addBounded(plainParts, decoded, plainChars);
        else if (part.mimeType?.toLowerCase() === "text/html") htmlChars = addBounded(htmlParts, htmlToText(decoded), htmlChars);
      }
    }

    for (const child of part.parts ?? []) visit(child);
  };

  visit(message.payload);
  const subject = headerValue(message.payload?.headers, "subject");
  const preferredBody = (plainParts.length ? plainParts : htmlParts).join("\n\n").trim();
  const fallback = preferredBody || message.snippet?.slice(0, gmailSnippetFallbackChars).trim() || "";
  return normalizeSelectedText([subject, fallback].filter(Boolean).join("\n\n"));
}

function htmlToText(html: string) {
  return decodeHtmlEntities(html
    .replace(/<\s*(?:script|style)[^>]*>[\s\S]*?<\s*\/\s*(?:script|style)\s*>/gi, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/\s*(?:p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " "));
}

function decodeHtmlEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\"",
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code.startsWith("#x")) return safeCodePoint(Number.parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return safeCodePoint(Number.parseInt(code.slice(1), 10));
    return named[code.toLowerCase()] ?? entity;
  });
}

function safeCodePoint(value: number) {
  try {
    return Number.isFinite(value) && value > 0 ? String.fromCodePoint(value) : " ";
  } catch {
    return " ";
  }
}

function normalizeSelectedText(value: string) {
  return value
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, gmailMaxExtractedTextChars);
}

function hasAttachmentDisposition(headers: GmailMessagePart["headers"]) {
  return headers?.some((header) => (
    header.name?.toLowerCase() === "content-disposition" && /attachment/i.test(header.value ?? "")
  )) ?? false;
}

function headerValue(headers: GmailMessagePart["headers"], name: string) {
  return headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value?.trim() ?? "";
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
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

function gmailMessageTimestamp(internalDate: string | undefined) {
  if (!internalDate) return null;
  const timestamp = Number(internalDate);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return new Date(timestamp).toISOString();
}

function backfillStart(observedAt: string) {
  return new Date(new Date(observedAt).getTime() - gmailBackfillWindowMs).toISOString();
}

function nextSyncAt(continuation: boolean) {
  return new Date(Date.now() + (continuation ? 30_000 : 15 * 60_000)).toISOString();
}

function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asTimestamp(value: unknown) {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function asBoundedStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .map((item) => item.trim()))]
    .slice(0, gmailMaxPendingMessageIds);
}

function compactRecord(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null));
}

function hashText(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

function hashPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("base64url");
}
