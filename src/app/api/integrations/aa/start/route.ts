import { buildConnectorConsentResourceKey } from "@/lib/consent";
import { getConnectorById } from "@/lib/connectors";
import { listSetuMissingEnv, requestSetuConsent } from "@/lib/connectors/setu-aa-adapter";
import { currentPrivacyNoticeVersion } from "@/lib/privacy-notice";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { recordConsentGrant } from "@/lib/server/consent-store";
import { upsertConnectedAccount } from "@/lib/server/connector-token-store";
import { getDatabasePool, isDatabaseConfigured } from "@/lib/server/database";
import {
  readLimitedJson,
  RequestBodyTooLargeError,
  UnsupportedContentTypeError,
} from "@/lib/server/request-body";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import { readCurrentSession } from "@/lib/server/session";
import { createConnectorSyncJob } from "@/lib/server/sync-job-store";
import { requireWorkspaceRole } from "@/lib/server/workspace-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const connectorId = "account-aggregator";
const aaScopes = ["aa:consent", "aa:fi-data:deposit"];
// VUA shape: identifier@aa-handle, e.g. 9999999999@onemoney.
const vuaPattern = /^[0-9A-Za-z._+-]{4,64}@[a-z][a-z0-9-]{1,32}$/;

export async function GET(request: Request) {
  const session = await readCurrentSession(request);
  if (!session) return Response.json({ status: "unauthenticated" }, { status: 401 });

  const requiredEnv = [
    ...(isDatabaseConfigured() ? [] : ["DATABASE_URL"]),
    ...listSetuMissingEnv(),
  ];
  return Response.json({
    status: requiredEnv.length ? "not-configured" : "ready",
    integration: connectorId,
    requiredEnv,
    partnerStatus: process.env.ACCOUNT_AGGREGATOR_PARTNER_STATUS?.trim() || "not-started",
  });
}

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;

  const limit = await rateLimit(request, { namespace: "aa-consent-start", limit: 10, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const session = await readCurrentSession(request);
  if (!session) {
    return Response.json({ status: "unauthenticated", message: "Sign in before linking bank data." }, { status: 401 });
  }
  if (!session.workspaceId) {
    return Response.json({ error: "Session has no workspace. Sign in again." }, { status: 400 });
  }
  const authorization = await requireWorkspaceRole(request, session.workspaceId, "admin");
  if (authorization instanceof Response) return authorization;

  const requiredEnv = [
    ...(isDatabaseConfigured() ? [] : ["DATABASE_URL"]),
    ...listSetuMissingEnv(),
  ];
  if (requiredEnv.length) {
    return Response.json({
      status: "not-configured",
      integration: connectorId,
      requiredEnv,
      message: "The Account Aggregator rail activates once Setu FIU credentials are configured. Nothing is needed from the account holder.",
    }, { status: 501 });
  }

  let body: Record<string, unknown>;
  try {
    body = await readLimitedJson<Record<string, unknown>>(request, 4 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return Response.json({ error: "Consent request payload is too large." }, { status: 413 });
    }
    if (error instanceof UnsupportedContentTypeError) {
      return Response.json({ error: "Consent requests require application/json." }, { status: 415 });
    }
    return Response.json({ error: "Consent request payload is not valid JSON." }, { status: 400 });
  }

  const vua = typeof body.vua === "string" ? body.vua.trim().toLowerCase() : "";
  if (!vuaPattern.test(vua)) {
    return Response.json({
      error: "Provide the AA handle to link, for example 9999999999@onemoney. It identifies the account holder — it is not a password or key.",
    }, { status: 400 });
  }

  const connector = getConnectorById(connectorId);
  if (!connector) return Response.json({ error: "Account Aggregator connector is not registered." }, { status: 500 });

  let consent: Awaited<ReturnType<typeof requestSetuConsent>>;
  try {
    consent = await requestSetuConsent(vua, getConsentReturnUrl(request));
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "The consent request could not be created.",
    }, { status: 502 });
  }

  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    const grant = await recordConsentGrant({
      workspaceId: session.workspaceId,
      userId: authorization.session.userId,
      subjectEmail: authorization.session.email,
      resourceKey: buildConnectorConsentResourceKey(connectorId, consent.consentId),
      purpose: "provider-connector-sync",
      noticeVersion: currentPrivacyNoticeVersion,
      source: "aa-consent-start",
      scopes: aaScopes,
    }, client);
    const connectedAccount = await upsertConnectedAccount({
      workspaceId: session.workspaceId,
      consentGrantId: grant.id,
      connectorId,
      authType: connector.authType,
      providerAccountId: consent.consentId,
      displayName: "Bank & UPI (Account Aggregator)",
      scopes: aaScopes,
      metadata: {
        connectedByUserId: authorization.session.userId,
        connectedAt: new Date().toISOString(),
        source: "aa-consent-start",
        consentExpiry: consent.consentExpiry ?? null,
      },
      status: "pending",
    }, client);
    const syncJob = await createConnectorSyncJob({
      workspaceId: session.workspaceId,
      connectedAccountId: connectedAccount.id,
      connectorId,
      jobType: "initial_sync",
      priority: 50,
      cursorState: { source: "aa-consent-start", consentStatus: "pending" },
    }, client);
    await client.query("commit");

    return Response.json({
      status: "consent-requested",
      integration: connectorId,
      consentId: consent.consentId,
      approvalUrl: consent.approvalUrl,
      connectedAccount: { id: connectedAccount.id, displayName: connectedAccount.displayName, status: connectedAccount.status },
      syncJob: { id: syncJob.id },
      message: consent.approvalUrl
        ? "Approve the request in the Account Aggregator flow. Vognary will show the source as connected only after approval is confirmed."
        : "The consent was created. Approve it in your Account Aggregator app; Vognary will poll for confirmation before activating the source.",
    }, { status: 201 });
  } catch {
    await client.query("rollback");
    return Response.json({
      error: "The consent could not be stored. No synchronization job was activated.",
    }, { status: 502 });
  } finally {
    client.release();
  }
}

function getConsentReturnUrl(request: Request) {
  const configured = process.env.SETU_AA_REDIRECT_URI?.trim();
  if (configured) return new URL(configured).toString();
  const base = process.env.APP_URL?.trim() || request.url;
  const url = new URL("/app", base);
  url.searchParams.set("aa", "returned");
  return url.toString();
}
