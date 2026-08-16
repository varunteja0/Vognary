import { createHash } from "node:crypto";

import { vetoDeadlineFromDelivery } from "@/lib/recovery/notice-delivery";
import { signVetoToken } from "@/lib/recovery/veto-token";

export const autopilotNoticeVetoTtlMs = 14 * 24 * 60 * 60 * 1000;
/** Resend honors Idempotency-Key for 24 hours. Retries after that must fail closed. */
export const resendIdempotencyWindowMs = 24 * 60 * 60 * 1000;
/** Pending unmatched events that never bind are dead-lettered after the same 24h bound. */
export const unboundNoticeEventRetentionMs = resendIdempotencyWindowMs;
/** Constant non-PII tag on every Autopilot Resend payload. Not a workspace, email, or candidate id. */
export const autopilotNoticeResendTag = { name: "vognary", value: "autopilot-notice" } as const;
export const autopilotNoticePayloadVersion = 1;

export type AutopilotNoticeTag = { name: string; value: string };

export type FrozenAutopilotNotice = {
  token: string;
  tokenHash: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  tags: AutopilotNoticeTag[];
  payloadVersion: number;
  bodyHash: string;
  idempotencyKey: string;
};

export function autopilotNoticeIdempotencyKey(workspaceId: string, candidateId: string): string {
  return `notice:${workspaceId}:${candidateId}`;
}

export function resendIdempotencyWindowOpen(frozenAt: Date, now: Date): boolean {
  return now.getTime() - frozenAt.getTime() <= resendIdempotencyWindowMs;
}

/** The 48h clock may start only if the signed token is still valid at the veto deadline. */
export function noticeClockMayStart(input: { tokenExpiresAt: string; deliveredAt: Date }): boolean {
  const deadline = vetoDeadlineFromDelivery(input.deliveredAt);
  const expiresAt = Date.parse(input.tokenExpiresAt);
  if (Number.isNaN(expiresAt)) return false;
  return expiresAt >= deadline.getTime();
}

export function normalizeAutopilotNoticeTags(value: unknown): AutopilotNoticeTag[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((tag) => {
    if (!tag || typeof tag !== "object") return [];
    const record = tag as { name?: unknown; value?: unknown };
    if (typeof record.name !== "string" || typeof record.value !== "string") return [];
    if (!record.name.trim() || !record.value.trim()) return [];
    return [{ name: record.name, value: record.value }];
  });
}

export function hashAutopilotNoticeProviderPayload(input: {
  from: string;
  to: string;
  subject: string;
  text: string;
  tags: ReadonlyArray<AutopilotNoticeTag>;
  payloadVersion: number;
}): string {
  return createHash("sha256").update(JSON.stringify({
    from: input.from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    tags: input.tags.map((tag) => ({ name: tag.name, value: tag.value })),
    payloadVersion: input.payloadVersion,
  })).digest("hex");
}

/** Hash used by notices frozen before tags and payload-version binding shipped. */
export function hashLegacyAutopilotNoticeProviderPayload(input: {
  from: string;
  to: string;
  subject: string;
  text: string;
}): string {
  return createHash("sha256")
    .update(`${input.from}\0${input.to}\0${input.subject}\0${input.text}`)
    .digest("hex");
}

export function frozenAutopilotNoticeFromPersistence(input: {
  workspaceId: string;
  candidateId: string;
  tokenHash: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  tags: unknown;
  payloadVersion: number;
  bodyHash: string;
}): FrozenAutopilotNotice {
  const tags = normalizeAutopilotNoticeTags(input.tags);
  return {
    token: "",
    tokenHash: input.tokenHash,
    from: input.from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    tags,
    payloadVersion: input.payloadVersion,
    bodyHash: input.bodyHash,
    idempotencyKey: autopilotNoticeIdempotencyKey(input.workspaceId, input.candidateId),
  };
}

export function hasAutopilotNoticeTag(tags: unknown): boolean {
  const matches = (name: unknown, value: unknown) => (
    name === autopilotNoticeResendTag.name
    && typeof value === "string"
    && (value === autopilotNoticeResendTag.value || value.startsWith("autopilot-notice"))
  );
  if (Array.isArray(tags)) {
    return tags.some((tag) => {
      if (!tag || typeof tag !== "object") return false;
      const record = tag as { name?: unknown; value?: unknown };
      return matches(record.name, record.value);
    });
  }
  if (tags && typeof tags === "object") {
    const record = tags as Record<string, unknown>;
    return matches(autopilotNoticeResendTag.name, record[autopilotNoticeResendTag.name]);
  }
  return false;
}

/**
 * Authorization and execution may use only the persisted candidate clock plus a
 * currently DELIVERED notice with a provider message id. Do not rebuild the
 * deadline from notice.delivered_at.
 */
export function candidateClockAuthorizes(input: {
  noticeStatus?: string | null;
  providerMessageId?: string | null;
  noticeDeliveredAt?: Date | null;
  vetoDeadlineAt?: Date | null;
}): { noticeDelivered: boolean; vetoDeadline: Date | null } {
  if (
    input.noticeStatus !== "DELIVERED"
    || !input.providerMessageId
    || !input.noticeDeliveredAt
    || !input.vetoDeadlineAt
  ) {
    return { noticeDelivered: false, vetoDeadline: null };
  }
  return { noticeDelivered: true, vetoDeadline: input.vetoDeadlineAt };
}

export function freezeAutopilotNotice(input: {
  workspaceId: string;
  candidateId: string;
  expiresAt: string;
  appUrl: string;
  secret: string;
  from: string;
  to: string;
  tags?: ReadonlyArray<AutopilotNoticeTag>;
  payloadVersion?: number;
}): FrozenAutopilotNotice {
  const token = signVetoToken({
    workspaceId: input.workspaceId,
    candidateId: input.candidateId,
    expiresAt: input.expiresAt,
  }, input.secret);
  const origin = input.appUrl.replace(/\/+$/, "") || "https://vognary.com";
  const subject = "Vognary: a discretionary case is in its 48-hour veto window";
  const text = [
    "Vognary queued a discretionary cancellation case. This is not proof that anything was cancelled or saved.",
    "You have 48 hours after this notice is delivered to veto.",
    `Veto: ${origin}/autopilot/veto/${encodeURIComponent(token)}`,
  ].join("\n");
  const tags = normalizeAutopilotNoticeTags(input.tags ?? [autopilotNoticeResendTag]);
  const payloadVersion = input.payloadVersion ?? autopilotNoticePayloadVersion;
  return {
    token,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    from: input.from,
    to: input.to,
    subject,
    text,
    tags,
    payloadVersion,
    bodyHash: hashAutopilotNoticeProviderPayload({
      from: input.from,
      to: input.to,
      subject,
      text,
      tags,
      payloadVersion,
    }),
    idempotencyKey: autopilotNoticeIdempotencyKey(input.workspaceId, input.candidateId),
  };
}
