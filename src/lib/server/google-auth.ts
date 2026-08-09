import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { isDatabaseConfigured } from "@/lib/server/database";
import { checkSessionConfiguration } from "@/lib/server/session";

const googleJwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export type GoogleAuthConfiguration = {
  status: "not-configured" | "ready";
  missing: string[];
};

export type GoogleTokenInfo = {
  aud?: string;
  iss?: string;
  email?: string;
  email_verified?: string | boolean;
  name?: string;
  picture?: string;
  sub?: string;
};

export async function verifyGoogleIdToken(idToken: string, clientId: string, key: JWTVerifyGetKey = googleJwks): Promise<GoogleTokenInfo> {
  const { payload } = await jwtVerify(idToken, key, {
    algorithms: ["RS256"],
    audience: clientId,
    issuer: ["https://accounts.google.com", "accounts.google.com"],
  });
  return {
    aud: typeof payload.aud === "string" ? payload.aud : undefined,
    iss: typeof payload.iss === "string" ? payload.iss : undefined,
    email: typeof payload.email === "string" ? payload.email : undefined,
    email_verified: typeof payload.email_verified === "boolean" ? payload.email_verified : undefined,
    name: typeof payload.name === "string" ? payload.name : undefined,
    picture: typeof payload.picture === "string" ? payload.picture : undefined,
    sub: typeof payload.sub === "string" ? payload.sub : undefined,
  };
}

export function checkGoogleAuthConfiguration(): GoogleAuthConfiguration {
  const missing = [
    isDatabaseConfigured() ? null : "DATABASE_URL",
    checkSessionConfiguration().status === "ready" ? null : "SESSION_SECRET",
    getGoogleAuthClientId() ? null : "GOOGLE_AUTH_CLIENT_ID",
    getGoogleAuthClientSecret() ? null : "GOOGLE_AUTH_CLIENT_SECRET",
    process.env.NODE_ENV !== "production" || getGoogleAuthOrigin() ? null : "NEXT_PUBLIC_APP_URL or APP_URL",
  ].filter((value): value is string => Boolean(value));

  return { status: missing.length ? "not-configured" : "ready", missing };
}

export function getGoogleAuthClientId() {
  return process.env.GOOGLE_AUTH_CLIENT_ID?.trim() || "";
}

export function getGoogleAuthClientSecret() {
  return process.env.GOOGLE_AUTH_CLIENT_SECRET?.trim() || "";
}

export function getGoogleAuthRedirectUri(origin: string) {
  const configured = process.env.GOOGLE_AUTH_REDIRECT_URI?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (process.env.NODE_ENV !== "production" || url.protocol === "https:") return url.toString();
    } catch {
      return "";
    }
  }
  return `${origin.replace(/\/$/, "")}/api/auth/google/callback`;
}

export function getGoogleAuthOrigin(requestOrigin?: string) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim();
  const candidate = configured || (process.env.NODE_ENV !== "production" ? requestOrigin : undefined);
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    if (!url.hostname || (process.env.NODE_ENV === "production" && url.protocol !== "https:")) return "";
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.origin;
  } catch {
    return "";
  }
}

export function isGoogleEmailAllowed(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const allowedEmails = (process.env.GOOGLE_AUTH_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const allowedDomain = process.env.GOOGLE_AUTH_ALLOWED_DOMAIN?.trim().toLowerCase();

  if (!allowedEmails.length && !allowedDomain) return true;
  if (allowedEmails.includes(normalizedEmail)) return true;
  return Boolean(allowedDomain && normalizedEmail.endsWith(`@${allowedDomain}`));
}

export function getGoogleWorkspaceName(tokenInfo: GoogleTokenInfo) {
  const name = tokenInfo.name?.trim();
  if (name) return `${name}'s Vognary`;
  const emailLocal = tokenInfo.email?.split("@")[0]?.trim();
  return emailLocal ? `${emailLocal}'s Vognary` : "Vognary Workspace";
}