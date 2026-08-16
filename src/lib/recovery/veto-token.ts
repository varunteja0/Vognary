import { createHmac, timingSafeEqual } from "node:crypto";

export type VetoTokenPayload = {
  workspaceId: string;
  candidateId: string;
  expiresAt: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function signVetoToken(payload: VetoTokenPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyVetoToken(token: string, secret: string, now = new Date()): VetoTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = createHmac("sha256", secret).update(parts[0]).digest("base64url");
  const actualBuffer = Buffer.from(parts[1]);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Partial<VetoTokenPayload>;
    if (!uuidPattern.test(payload.workspaceId ?? "") || !uuidPattern.test(payload.candidateId ?? "")) return null;
    if (!payload.expiresAt || Number.isNaN(new Date(payload.expiresAt).getTime())) return null;
    if (now.getTime() > new Date(payload.expiresAt).getTime()) return null;
    return {
      workspaceId: payload.workspaceId!,
      candidateId: payload.candidateId!,
      expiresAt: payload.expiresAt,
    };
  } catch {
    return null;
  }
}
