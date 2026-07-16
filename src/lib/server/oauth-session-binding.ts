import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { AuthSession } from "./session";

type OAuthSessionBinding = {
  version: 1;
  purpose: string;
  userId: string;
  workspaceId: string | null;
  sessionTokenHash: string;
  expiresAt: number;
};

const bindingTtlMs = 10 * 60_000;

export function createOAuthSessionBinding(session: AuthSession, purpose: string, now = Date.now()) {
  const secret = getSigningSecret();
  if (!secret) throw new Error("SESSION_SECRET is not configured for OAuth binding.");
  const binding: OAuthSessionBinding = {
    version: 1,
    purpose,
    userId: session.userId,
    workspaceId: session.workspaceId ?? null,
    sessionTokenHash: hashToken(session.sessionToken),
    expiresAt: now + bindingTtlMs,
  };
  const payload = Buffer.from(JSON.stringify(binding), "utf8").toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyOAuthSessionBinding(
  value: string | null | undefined,
  session: AuthSession,
  purpose: string,
  now = Date.now(),
) {
  const secret = getSigningSecret();
  if (!value || !secret) return false;
  const [payload, signature] = value.split(".");
  if (!payload || !signature || !safeEqual(sign(payload, secret), signature)) return false;

  try {
    const binding = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthSessionBinding;
    return binding.version === 1
      && binding.purpose === purpose
      && binding.userId === session.userId
      && binding.workspaceId === (session.workspaceId ?? null)
      && binding.sessionTokenHash === hashToken(session.sessionToken)
      && Number.isFinite(binding.expiresAt)
      && binding.expiresAt > now
      && binding.expiresAt <= now + bindingTtlMs;
  } catch {
    return false;
  }
}

function getSigningSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  if (process.env.NODE_ENV === "production" && Buffer.byteLength(secret, "utf8") < 32) return null;
  return secret;
}

function hashToken(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(expected: string, supplied: string) {
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}