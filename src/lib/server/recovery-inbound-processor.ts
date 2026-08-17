import "server-only";

import { createHash } from "node:crypto";
import { extractForwardedReceiptTexts, forwardedEmailMaxMimeBytes } from "@/lib/recovery/inbound-email";
import { getDatabasePool } from "@/lib/server/database";
import { reportServerError } from "@/lib/server/monitoring";
import { RecoveryMaterializationError } from "@/lib/server/recovery-api";
import {
  getReceiptInboxConfiguration,
  lockReceiptInboxAuthority,
  recordGmailForwardingVerification,
  resolveReceiptInboxAlias,
} from "@/lib/server/recovery-inbound-store";
import {
  ResendInboundRetryableError,
  type ResendReceivedEvent,
} from "@/lib/server/recovery-inbound-webhook";
import { listKnownSenderDomains, materializeForwardedEmailEvidence } from "@/lib/server/recovery-store";
import { getReceiptInboxTrustedAuthorities } from "@/lib/server/receipt-inbox-sender-trust";

type ProcessorDependencies = {
  retrieveRawEmail?: (emailId: string) => Promise<string | Uint8Array>;
  afterAuthorityInspection?: () => Promise<void>;
  reportProcessingFailure?: (error: Error, context: Record<string, unknown>) => Promise<void>;
};

type ReservedEvent = {
  id: string;
  workspaceId: string;
  attemptCount: number;
};

const processingLeaseMinutes = 5;

class ResendInboundTerminalError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ResendInboundTerminalError";
  }
}

export async function processResendReceivedEvent(
  event: ResendReceivedEvent,
  dependencies: ProcessorDependencies = {},
): Promise<{ status: "processed" | "duplicate" | "ignored" }> {
  const existing = await findExistingInboundEvent(event);
  const alias = existing ?? await resolveReceiptInboxAlias(event.recipient);
  if (!alias) return { status: "ignored" };

  const reservation = await reserveInboundEvent(event, alias);
  if (!reservation) return { status: "duplicate" };

  let raw: string | Uint8Array;
  try {
    raw = await (dependencies.retrieveRawEmail ?? retrieveResendRawEmail)(event.emailId);
  } catch (error) {
    if (error instanceof ResendInboundTerminalError) {
      const marked = await markTerminalFailure(reservation, error.code);
      if (marked) await reportTerminalFailure(reservation, error.code, dependencies);
      return { status: marked ? "ignored" : "duplicate" };
    }
    const released = await releaseForRetry(reservation, "PROVIDER_RETRIEVAL_FAILED");
    if (!released) return { status: "duplicate" };
    throw error instanceof ResendInboundRetryableError
      ? error
      : new ResendInboundRetryableError("Receipt provider retrieval failed.");
  }

  // Kept outside the MIME block so storage trouble retries instead of being
  // recorded as an unparseable message.
  let knownSenderDomains: readonly string[];
  try {
    knownSenderDomains = await listKnownSenderDomains(reservation.workspaceId);
  } catch {
    const released = await releaseForRetry(reservation, "SENDER_HISTORY_UNAVAILABLE");
    if (!released) return { status: "duplicate" };
    throw new ResendInboundRetryableError("Receipt sender history is unavailable.");
  }

  let extraction;
  try {
    extraction = await extractForwardedReceiptTexts(raw, {
      trustedAuthorities: getReceiptInboxTrustedAuthorities(),
      knownSenderDomains,
    });
  } catch {
    const marked = await markTerminalFailure(reservation, "MIME_INVALID");
    if (marked) await reportTerminalFailure(reservation, "MIME_INVALID", dependencies);
    return { status: marked ? "ignored" : "duplicate" };
  }
  const receipts = extraction.texts;
  if (extraction.gmailVerification) {
    await recordGmailForwardingVerification({
      workspaceId: reservation.workspaceId,
      aliasId: alias.aliasId,
      verification: extraction.gmailVerification,
    }).catch(() => undefined);
    const marked = await markTerminalFailure(reservation, "GMAIL_VERIFICATION_PENDING");
    return { status: marked ? "ignored" : "duplicate" };
  }
  if (!receipts.length) {
    const reason = extraction.skippedAttachments.length ? "UNSUPPORTED_ATTACHMENT" : "NO_PLAIN_TEXT_RECEIPT";
    const marked = await markTerminalFailure(
      reservation,
      reason,
    );
    if (marked) await reportTerminalFailure(reservation, reason, dependencies);
    return { status: marked ? "ignored" : "duplicate" };
  }

  try {
    const materialized = await materializeForwardedEmailEvidence({
      workspaceId: reservation.workspaceId,
      inboundEventId: reservation.id,
      providerEventId: event.svixId,
      expectedAttemptCount: reservation.attemptCount,
      currencyHint: extraction.currencyHint,
      historicalBackfillClientRefs: extraction.nestedReceiptClientRefs,
      request: {
        kind: "FORWARDED_EMAIL",
        receipts: receipts.map((receipt) => ({
          clientRef: receipt.clientRef,
          text: receipt.text,
          provenance: receipt.provenance,
        })),
      },
      afterAuthorityInspection: dependencies.afterAuthorityInspection,
    });
    if (materialized.submission.acceptedEvidenceCount > 0) return { status: "processed" };
    await reportTerminalFailure(reservation, "PARSE_FAILED", dependencies);
    return { status: "ignored" };
  } catch (error) {
    const released = await releaseForRetry(reservation, materializationFailureCode(error));
    if (!released) return { status: "duplicate" };
    throw error instanceof ResendInboundRetryableError
      ? error
      : new ResendInboundRetryableError("Receipt materialization failed.");
  }
}

async function reportTerminalFailure(
  reservation: ReservedEvent,
  reason: string,
  dependencies: ProcessorDependencies,
) {
  const reporter = dependencies.reportProcessingFailure ?? ((error, context) => reportServerError(error, {
    path: "/api/webhooks/resend/inbound",
    method: "POST",
    headers: {},
  }, context));
  await reporter(
    new Error("Receipt inbox processing ended without evidence."),
    {
      boundary: "receipt-inbound-processor",
      workspaceId: reservation.workspaceId,
      inboundEventId: reservation.id,
      outcome: "terminal",
      reason,
    },
  ).catch(() => undefined);
}

export function materializationFailureCode(error: unknown) {
  return error instanceof RecoveryMaterializationError
    ? `MATERIALIZATION_${error.stage}_${error.code}`
    : "MATERIALIZATION_FAILED";
}

async function findExistingInboundEvent(event: ResendReceivedEvent) {
  const result = await getDatabasePool().query<{ workspace_id: string; alias_id: string | null; alias_status: string | null }>(
    `select event.workspace_id, event.alias_id, alias.status as alias_status
     from recovery_inbound_events event
     left join recovery_inbound_aliases alias on alias.id = event.alias_id
     where event.provider = 'RESEND' and (event.svix_id = $1 or event.provider_email_id = $2)
     limit 1`,
    [event.svixId, event.emailId],
  );
  const row = result.rows[0];
  if (!row?.alias_id || row.alias_status !== "ACTIVE") return null;
  return { workspaceId: row.workspace_id, aliasId: row.alias_id };
}

async function reserveInboundEvent(
  event: ResendReceivedEvent,
  alias: { workspaceId: string; aliasId: string },
): Promise<ReservedEvent | null> {
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    const authority = await lockReceiptInboxAuthority(client, {
      workspaceId: alias.workspaceId,
      aliasId: alias.aliasId,
    });
    if (!authority.live) {
      await client.query("rollback");
      return null;
    }

    const existing = (await client.query<{
      id: string;
      workspace_id: string;
      status: string;
      processing_started_at: Date | null;
    }>(
      `select id, workspace_id, status, processing_started_at
       from recovery_inbound_events
       where provider = 'RESEND' and (svix_id = $1 or provider_email_id = $2)
       limit 1
       for update`,
      [event.svixId, event.emailId],
    )).rows[0] ?? null;

    let inserted: { id: string } | null = null;
    if (!existing) {
      const svixIdHash = createHash("sha256").update(event.svixId).digest("hex");
      const providerEmailIdHash = createHash("sha256").update(event.emailId).digest("hex");
      const replayKeys = await client.query<{ key_kind: string }>(
        `insert into recovery_inbound_replay_keys (
           provider, key_kind, key_hash, workspace_id
         ) values
           ('RESEND', 'SVIX_ID', $1, $3),
           ('RESEND', 'PROVIDER_EMAIL_ID', $2, $3)
         on conflict do nothing
         returning key_kind`,
        [svixIdHash, providerEmailIdHash, alias.workspaceId],
      );
      if (replayKeys.rows.length !== 2) {
        await client.query("rollback");
        return null;
      }

      inserted = (await client.query<{ id: string }>(
        `insert into recovery_inbound_events (
           provider, svix_id, provider_email_id, workspace_id, alias_id,
           event_type, payload_hash, status
         ) values ('RESEND', $1, $2, $3, $4, 'email.received', $5, 'RECEIVED')
         on conflict do nothing
         returning id`,
        [event.svixId, event.emailId, alias.workspaceId, alias.aliasId, event.payloadHash],
      )).rows[0] ?? null;
    }

    const eventId = inserted?.id ?? existing?.id;
    if (!eventId) {
      await client.query("rollback");
      throw new ResendInboundRetryableError("Receipt event could not be reserved.");
    }
    if (existing && existing.workspace_id !== alias.workspaceId) {
      await client.query("commit");
      return null;
    }
    if (existing && ["PROCESSED", "IGNORED", "TERMINAL_FAILED"].includes(existing.status)) {
      await client.query("commit");
      return null;
    }
    if (
      existing?.status === "PROCESSING"
      && existing.processing_started_at
      && existing.processing_started_at.getTime() >= Date.now() - processingLeaseMinutes * 60_000
    ) {
      await client.query("rollback");
      throw new ResendInboundRetryableError("Receipt event is already being processed.");
    }

    const claimed = await client.query<{ id: string; workspace_id: string; attempt_count: number }>(
      `update recovery_inbound_events
       set status = 'PROCESSING', processing_started_at = now(),
           attempt_count = attempt_count + 1, error_code = null
       where id = $1
         and workspace_id = $2
         and (
           status = 'RECEIVED'
           or (status = 'PROCESSING' and processing_started_at < now() - interval '5 minutes')
         )
      returning id, workspace_id, attempt_count`,
      [eventId, alias.workspaceId],
    );
    if (!claimed.rows[0]) {
      await client.query("commit");
      return null;
    }
    await client.query("commit");
    return {
      id: claimed.rows[0].id,
      workspaceId: claimed.rows[0].workspace_id,
      attemptCount: claimed.rows[0].attempt_count,
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function releaseForRetry(reservation: ReservedEvent, errorCode: string) {
  const result = await getDatabasePool().query(
    `update recovery_inbound_events
     set status = 'RECEIVED', processing_started_at = null,
         error_code = $4, processed_at = null
     where id = $1 and workspace_id = $2
       and status = 'PROCESSING' and attempt_count = $3`,
    [reservation.id, reservation.workspaceId, reservation.attemptCount, errorCode],
  );
  return result.rowCount === 1;
}

async function markTerminalFailure(reservation: ReservedEvent, errorCode: string) {
  const result = await getDatabasePool().query(
    `update recovery_inbound_events
     set status = 'TERMINAL_FAILED', processing_started_at = null,
         error_code = $4, processed_at = now()
     where id = $1 and workspace_id = $2
       and status = 'PROCESSING' and attempt_count = $3`,
    [reservation.id, reservation.workspaceId, reservation.attemptCount, errorCode],
  );
  return result.rowCount === 1;
}

export async function retrieveResendRawEmail(emailId: string) {
  const readiness = getReceiptInboxConfiguration();
  if (readiness.status !== "ready") throw new ResendInboundRetryableError("Receipt inbox is not configured.");
  const metadataResponse = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
    headers: { authorization: `Bearer ${readiness.configuration.receivingApiKey}` },
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!metadataResponse) throw new ResendInboundRetryableError("Receipt provider metadata request failed.");
  if (!metadataResponse.ok) {
    throw new ResendInboundRetryableError("Receipt provider metadata request failed.");
  }
  const metadataBytes = await readResponseBytes(metadataResponse, 512 * 1024);
  let metadata: unknown;
  try {
    metadata = JSON.parse(new TextDecoder().decode(metadataBytes));
  } catch {
    throw new ResendInboundRetryableError("Receipt provider metadata was unreadable.");
  }
  const rawUrl = readRawDownloadUrl(metadata);
  if (!rawUrl) throw new ResendInboundRetryableError("Receipt provider raw email is not available yet.");

  const rawResponse = await fetch(rawUrl, {
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
  }).catch(() => null);
  if (!rawResponse || !rawResponse.ok) throw new ResendInboundRetryableError("Receipt provider raw email request failed.");
  return readResponseBytes(rawResponse, forwardedEmailMaxMimeBytes);
}

function readRawDownloadUrl(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = (value as Record<string, unknown>).raw;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const downloadUrl = (raw as Record<string, unknown>).download_url;
  if (typeof downloadUrl !== "string") return null;
  try {
    const parsed = new URL(downloadUrl);
    const allowedHost = parsed.hostname === "resend.com"
      || parsed.hostname.endsWith(".resend.com")
      || parsed.hostname === "cdn.resend.app"
      || parsed.hostname.endsWith(".cloudfront.net");
    return parsed.protocol === "https:" && allowedHost ? parsed.toString() : null;
  } catch {
    return null;
  }
}

async function readResponseBytes(response: Response, maximum: number) {
  const declared = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > maximum) throw new ResendInboundTerminalError("PROVIDER_RESPONSE_TOO_LARGE");
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) {
        await reader.cancel();
        throw new ResendInboundTerminalError("PROVIDER_RESPONSE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}