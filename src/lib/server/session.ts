import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getDatabasePool, isDatabaseConfigured } from "@/lib/server/database";

export const sessionCookieName = "vognary_session";

/**
 * Claims stored in the signed browser cookie. Keep this deliberately small: the
 * user's email and role are resolved from PostgreSQL for every protected action.
 */
export type SessionClaims = {
  sessionToken: string;
  userId: string;
  workspaceId?: string;
  issuedAt: number;
  expiresAt: number;
};

export type AuthSession = SessionClaims & {
  email: string;
};

export type SessionStatus = {
  status: "not-configured" | "ready";
  cookieName: string;
};

export function checkSessionConfiguration(): SessionStatus {
  return {
    status: getSessionSecret() ? "ready" : "not-configured",
    cookieName: sessionCookieName,
  };
}

/**
 * Verify only the signed cookie and expiry. This is suitable for optimistic UI
 * routing, never for authorizing access to workspace data or mutations.
 */
export function readSession(request: Request): SessionClaims | null {
  const secret = getSessionSecret();
  if (!secret) return null;

  const cookie = readCookie(request, sessionCookieName);
  if (!cookie) return null;

  const [payload, signature] = cookie.split(".");
  if (!payload || !signature) return null;

  const expected = signPayload(payload, secret);
  if (!safeEqual(expected, signature)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionClaims;
    if (!session.sessionToken || !session.userId || !session.expiresAt || !session.issuedAt) return null;
    if (session.expiresAt <= Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

/**
 * Authoritative session validation. The opaque token must still be active, the
 * user must exist, and any workspace in the cookie must still have a matching
 * membership. Removing a membership or revoking the token takes effect on the
 * next protected request.
 */
export async function readCurrentSession(request: Request): Promise<AuthSession | null> {
  const claims = readSession(request);
  if (!claims || !isDatabaseConfigured()) return null;

  const result = await getDatabasePool().query<{ email: string }>(
    `select u.email
     from auth_sessions s
     join users u on u.id = s.user_id and u.deleted_at is null
     where s.token_hash = $1
       and s.user_id = $2
       and s.workspace_id is not distinct from $3::uuid
       and s.revoked_at is null
       and s.expires_at > now()
       and (
         s.workspace_id is null
         or exists (
           select 1
           from workspace_members wm
           where wm.workspace_id = s.workspace_id
             and wm.user_id = s.user_id
         )
       )
     limit 1`,
    [hashSessionToken(claims.sessionToken), claims.userId, claims.workspaceId ?? null],
  );

  const row = result.rows[0];
  return row ? { ...claims, email: row.email } : null;
}

export async function createSessionCookie(input: { userId: string; workspaceId?: string; maxAgeSeconds?: number }) {
  const secret = getSessionSecret();
  if (!secret) throw new Error("SESSION_SECRET is not configured or is too short for production.");
  if (!isDatabaseConfigured()) throw new Error("DATABASE_URL is required for revocable sessions.");

  const maxAgeSeconds = input.maxAgeSeconds ?? 7 * 24 * 60 * 60;
  const issuedAt = Date.now();
  const expiresAt = issuedAt + maxAgeSeconds * 1000;
  const sessionToken = randomBytes(32).toString("base64url");
  const session: SessionClaims = {
    sessionToken,
    userId: input.userId,
    workspaceId: input.workspaceId,
    issuedAt,
    expiresAt,
  };

  await getDatabasePool().query(
    `insert into auth_sessions (token_hash, user_id, workspace_id, expires_at)
     values ($1, $2, $3, $4)`,
    [hashSessionToken(sessionToken), input.userId, input.workspaceId ?? null, new Date(expiresAt)],
  );

  const payload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  const signature = signPayload(payload, secret);

  return {
    name: sessionCookieName,
    value: `${payload}.${signature}`,
    maxAgeSeconds,
  };
}

export async function revokeCurrentSession(request: Request) {
  const session = readSession(request);
  if (!session || !isDatabaseConfigured()) return false;

  const result = await getDatabasePool().query(
    `update auth_sessions
     set revoked_at = coalesce(revoked_at, now())
     where token_hash = $1
       and user_id = $2
       and revoked_at is null`,
    [hashSessionToken(session.sessionToken), session.userId],
  );
  return Boolean(result.rowCount);
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

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  if (process.env.NODE_ENV === "production" && Buffer.byteLength(secret, "utf8") < 32) return null;
  return secret;
}

function signPayload(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(expected: string, supplied: string) {
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}
