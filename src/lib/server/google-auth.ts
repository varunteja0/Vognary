import { isDatabaseConfigured } from "@/lib/server/database";
import { checkSessionConfiguration } from "@/lib/server/session";

export type GoogleAuthConfiguration = {
  status: "not-configured" | "ready";
  missing: string[];
};

export type GoogleTokenInfo = {
  aud?: string;
  email?: string;
  email_verified?: string | boolean;
  name?: string;
  picture?: string;
  sub?: string;
};

export function checkGoogleAuthConfiguration(): GoogleAuthConfiguration {
  const missing = [
    isDatabaseConfigured() ? null : "DATABASE_URL",
    checkSessionConfiguration().status === "ready" ? null : "SESSION_SECRET",
    getGoogleAuthClientId() ? null : "GOOGLE_AUTH_CLIENT_ID or GOOGLE_CLIENT_ID",
    getGoogleAuthClientSecret() ? null : "GOOGLE_AUTH_CLIENT_SECRET or GOOGLE_CLIENT_SECRET",
  ].filter((value): value is string => Boolean(value));

  return { status: missing.length ? "not-configured" : "ready", missing };
}

export function getGoogleAuthClientId() {
  return process.env.GOOGLE_AUTH_CLIENT_ID?.trim() || process.env.GOOGLE_CLIENT_ID?.trim() || "";
}

export function getGoogleAuthClientSecret() {
  return process.env.GOOGLE_AUTH_CLIENT_SECRET?.trim() || process.env.GOOGLE_CLIENT_SECRET?.trim() || "";
}

export function getGoogleAuthRedirectUri(origin: string) {
  return process.env.GOOGLE_AUTH_REDIRECT_URI?.trim() || `${origin.replace(/\/$/, "")}/api/auth/google/callback`;
}

export function getGoogleAuthOrigin(requestOrigin: string) {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || requestOrigin;
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