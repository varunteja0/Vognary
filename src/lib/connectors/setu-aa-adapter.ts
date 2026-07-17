import { createHash } from "node:crypto";
import type { ConnectorAdapter, ConnectorConnection, ConnectorEvidence, ConnectorSyncResult } from "@/lib/connector-runtime";

/**
 * India Account Aggregator adapter — Setu FIU rail (RBI-regulated, consent-based).
 *
 * Flow per Setu's published FIU APIs (docs.setu.co/data/account-aggregator):
 *   1. POST /consents with the user's VUA (e.g. 99xxxxxx99@onemoney) → consent
 *      id + an approval URL the account holder opens on the AA of their choice.
 *   2. GET /consents/:id until the holder approves (PENDING → ACTIVE/APPROVED).
 *   3. POST /sessions against the approved consent → FI data preparation.
 *   4. GET /sessions/:id → decrypted transactions once PARTIAL/COMPLETED.
 *
 * Environment (issued by Setu after FIU onboarding — sandbox keys are
 * self-serve on the Bridge dashboard; production requires the signed
 * agreement tracked in ACCOUNT_AGGREGATOR_PARTNER_STATUS):
 *   SETU_AA_CLIENT_ID, SETU_AA_CLIENT_SECRET, SETU_AA_PRODUCT_INSTANCE_ID
 *   SETU_AA_BASE_URL (default https://fiu-sandbox.setu.co)
 *
 * The registry keeps this connector `partner-required`; nothing in this file
 * changes a public claim. It exists so the day credentials arrive, the rail
 * lights up without a code change.
 */

const DEFAULT_BASE_URL = "https://fiu-sandbox.setu.co";
const REQUEST_TIMEOUT_MS = 15_000;
const DATA_WINDOW_DAYS = 180;

type SetuConsentResponse = {
  id?: string;
  url?: string;
  status?: string;
  detail?: { consentExpiry?: string };
};

type SetuSessionResponse = {
  id?: string;
  status?: string;
  payload?: SetuFiPayload[];
};

type SetuFiPayload = {
  data?: Array<{
    linkRefNumber?: string;
    maskedAccNumber?: string;
    decryptedFI?: SetuDecryptedFi | SetuDecryptedFi[];
  }>;
};

type SetuDecryptedFi = {
  account?: {
    transactions?: {
      transaction?: SetuTransaction[];
    };
  };
};

type SetuTransaction = {
  txnId?: string;
  amount?: string | number;
  narration?: string;
  reference?: string;
  type?: string;
  mode?: string;
  transactionTimestamp?: string;
  valueDate?: string;
  currentBalance?: string;
};

export const setuAccountAggregatorAdapter: ConnectorAdapter = {
  id: "account-aggregator",

  async connect(connection) {
    const credentials = getSetuCredentials(connection);

    // A VUA (looks like 9999999999@aa-handle) means "open a fresh consent".
    // Anything else is treated as an existing consent id to resume.
    const target = connection.providerAccountId?.trim();
    if (!target) {
      throw new Error(
        "Provide the account holder's VUA (for example 9999999999@onemoney) to request a consent, or an existing Setu consent id.",
      );
    }

    if (target.includes("@")) {
      const consent = await createConsent(credentials, target);
      if (!consent.id) throw new Error("Setu did not return a consent id.");
      return {
        ...connection,
        providerAccountId: consent.id,
        accessRef: connection.accessRef ?? "env:SETU_AA_CLIENT_ID",
        expiresAt: consent.detail?.consentExpiry,
        scopes: connection.scopes.length ? connection.scopes : ["aa:consent", "aa:fi-data:deposit"],
      };
    }

    // Existing consent id — verify it is real before storing the connection.
    await getConsent(credentials, target);
    return {
      ...connection,
      providerAccountId: target,
      accessRef: connection.accessRef ?? "env:SETU_AA_CLIENT_ID",
      scopes: connection.scopes.length ? connection.scopes : ["aa:consent", "aa:fi-data:deposit"],
    };
  },

  async sync(connection, context): Promise<ConnectorSyncResult> {
    const credentials = getSetuCredentials(connection);
    const consentId = connection.providerAccountId?.trim();
    if (!consentId) throw new Error("Account Aggregator sync needs a consent id on the connection.");

    // Resume a data session that was still preparing on the previous run.
    const pendingSessionId = asString(context?.cursorState.pendingSessionId);
    if (pendingSessionId) {
      const session = await getSession(credentials, pendingSessionId);
      if (isSessionReady(session.status)) {
        return buildResultFromSession(session, consentId);
      }
      if (isSessionFailed(session.status)) {
        throw new Error(`Setu data session ${pendingSessionId} ended as ${session.status}.`);
      }
      return {
        evidence: [],
        nextCursorState: { ...context?.cursorState, pendingSessionId },
        continuation: true,
      };
    }

    const consent = await getConsent(credentials, consentId);
    const consentStatus = (consent.status ?? "").toUpperCase();
    if (consentStatus === "PENDING") {
      throw new Error(
        `Consent ${consentId} is awaiting the account holder's approval${consent.url ? ` at ${consent.url}` : ""}. Sync resumes automatically once approved.`,
      );
    }
    if (consentStatus !== "ACTIVE" && consentStatus !== "APPROVED") {
      throw new Error(`Consent ${consentId} is ${consent.status ?? "in an unknown state"}; a new consent is required.`);
    }

    const now = new Date();
    const from = asString(context?.cursorState.coveredUntil)
      ?? new Date(now.getTime() - DATA_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const session = await createSession(credentials, consentId, from, now.toISOString());
    if (!session.id) throw new Error("Setu did not return a data session id.");

    const fresh = await getSession(credentials, session.id);
    if (isSessionReady(fresh.status)) {
      return buildResultFromSession(fresh, consentId);
    }
    if (isSessionFailed(fresh.status)) {
      throw new Error(`Setu data session ${session.id} ended as ${fresh.status}.`);
    }
    // FIP data is still being prepared; hand the session back to the queue.
    return {
      evidence: [],
      nextCursorState: { pendingSessionId: session.id, coveredUntil: from },
      continuation: true,
    };
  },
};

type SetuCredentials = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  productInstanceId: string;
};

function getSetuCredentials(connection: ConnectorConnection): SetuCredentials {
  const clientId = process.env.SETU_AA_CLIENT_ID;
  const clientSecret = connection.apiKey ?? process.env.SETU_AA_CLIENT_SECRET;
  const productInstanceId = process.env.SETU_AA_PRODUCT_INSTANCE_ID;
  if (!clientId || !clientSecret || !productInstanceId) {
    throw new Error(
      "Account Aggregator credentials are not configured. Set SETU_AA_CLIENT_ID, SETU_AA_CLIENT_SECRET, and SETU_AA_PRODUCT_INSTANCE_ID once Setu FIU onboarding issues them.",
    );
  }
  return {
    baseUrl: (process.env.SETU_AA_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, ""),
    clientId,
    clientSecret,
    productInstanceId,
  };
}

async function setuFetch<T>(credentials: SetuCredentials, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${credentials.baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-client-id": credentials.clientId,
      "x-client-secret": credentials.clientSecret,
      "x-product-instance-id": credentials.productInstanceId,
      ...init?.headers,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Setu AA request ${path} failed with ${response.status}.`);
  }
  return await response.json() as T;
}

function createConsent(credentials: SetuCredentials, vua: string) {
  const now = new Date();
  const dataFrom = new Date(now.getTime() - DATA_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const consentExpiry = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  return setuFetch<SetuConsentResponse>(credentials, "/consents", {
    method: "POST",
    body: JSON.stringify({
      consentDuration: { unit: "MONTH", value: "12" },
      vua,
      dataRange: { from: dataFrom.toISOString(), to: consentExpiry.toISOString() },
      context: [],
      additionalParams: { tags: ["vognary-recurring-audit"] },
    }),
  });
}

function getConsent(credentials: SetuCredentials, consentId: string) {
  return setuFetch<SetuConsentResponse>(credentials, `/consents/${encodeURIComponent(consentId)}`);
}

function createSession(credentials: SetuCredentials, consentId: string, from: string, to: string) {
  return setuFetch<SetuSessionResponse>(credentials, "/sessions", {
    method: "POST",
    body: JSON.stringify({
      consentId,
      dataRange: { from, to },
      format: "json",
    }),
  });
}

function getSession(credentials: SetuCredentials, sessionId: string) {
  return setuFetch<SetuSessionResponse>(credentials, `/sessions/${encodeURIComponent(sessionId)}`);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

function isSessionReady(status?: string) {
  const value = (status ?? "").toUpperCase();
  return value === "COMPLETED" || value === "PARTIAL";
}

function isSessionFailed(status?: string) {
  const value = (status ?? "").toUpperCase();
  return value === "FAILED" || value === "EXPIRED" || value === "REJECTED";
}

function buildResultFromSession(session: SetuSessionResponse, consentId: string): ConnectorSyncResult {
  const evidence = extractTransactions(session).map((entry) => toEvidence(entry, consentId));
  const nowIso = new Date().toISOString();
  return {
    evidence,
    nextCursorState: { coveredUntil: nowIso },
    nextSyncAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    coverage: { endAt: nowIso, completeness: session.status?.toUpperCase() === "PARTIAL" ? "partial" : "complete" },
  };
}

function extractTransactions(session: SetuSessionResponse): SetuTransaction[] {
  const transactions: SetuTransaction[] = [];
  for (const payload of session.payload ?? []) {
    for (const account of payload.data ?? []) {
      const decrypted = Array.isArray(account.decryptedFI) ? account.decryptedFI : account.decryptedFI ? [account.decryptedFI] : [];
      for (const fi of decrypted) {
        for (const transaction of fi.account?.transactions?.transaction ?? []) {
          if ((transaction.type ?? "").toUpperCase() === "DEBIT") transactions.push(transaction);
        }
      }
    }
  }
  return transactions;
}

function toEvidence(transaction: SetuTransaction, consentId: string): ConnectorEvidence {
  const amount = typeof transaction.amount === "string" ? Number.parseFloat(transaction.amount) : transaction.amount;
  const observedAt = transaction.transactionTimestamp ?? transaction.valueDate ?? new Date().toISOString();
  const externalId = transaction.txnId
    ?? createHash("sha256").update(`${consentId}:${transaction.reference ?? ""}:${observedAt}:${amount ?? ""}`).digest("hex").slice(0, 32);
  return {
    connectorId: "account-aggregator",
    externalId,
    provider: "setu-aa",
    observedAt,
    evidenceType: "transaction",
    merchantRaw: transaction.narration ?? transaction.reference ?? undefined,
    amount: Number.isFinite(amount) ? amount : undefined,
    currency: "INR",
    cadenceHint: transaction.mode ? `mode:${transaction.mode}` : undefined,
    sourcePayloadHash: createHash("sha256").update(JSON.stringify(transaction)).digest("hex"),
    confidence: 0.9,
  };
}
