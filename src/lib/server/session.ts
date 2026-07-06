import { createHmac, timingSafeEqual } from "node:crypto";

export const sessionCookieName = "vognary_session";

export type AuthSession = {
  userId: string;
  email: string;
  workspaceId?: string;
  issuedAt: number;
  expiresAt: number;
};

export type SessionStatus = {
  status: "not-configured" | "ready";
  cookieName: string;
};

export function checkSessionConfiguration(): SessionStatus {
  return {
    status: process.env.SESSION_SECRET ? "ready" : "not-configured",
    cookieName: sessionCookieName,
  };
}

export function readSession(request: Request): AuthSession | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;

  const cookie = readCookie(request, sessionCookieName);
  if (!cookie) return null;

  const [payload, signature] = cookie.split(".");
  if (!payload || !signature) return null;

  const expected = signPayload(payload, secret);
  if (!safeEqual(expected, signature)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AuthSession;
    if (!session.userId || !session.email || !session.expiresAt) return null;
    if (session.expiresAt <= Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export function createSessionCookie(input: { userId: string; email: string; workspaceId?: string; maxAgeSeconds?: number }) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not configured.");

  const maxAgeSeconds = input.maxAgeSeconds ?? 7 * 24 * 60 * 60;
  const issuedAt = Date.now();
  const session: AuthSession = {
    userId: input.userId,
    email: input.email,
    workspaceId: input.workspaceId,
    issuedAt,
    expiresAt: issuedAt + maxAgeSeconds * 1000,
  };
  const payload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  const signature = signPayload(payload, secret);

  return {
    name: sessionCookieName,
    value: `${payload}.${signature}`,
    maxAgeSeconds,
  };
}

export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    maxAge: maxAgeSeconds,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}

function readCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookies = cookieHeader.split(";").map((cookie) => cookie.trim());
  const target = `${name}=`;
  const cookie = cookies.find((value) => value.startsWith(target));
  return cookie ? decodeURIComponent(cookie.slice(target.length)) : null;
}

function signPayload(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(expected: string, supplied: string) {
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}