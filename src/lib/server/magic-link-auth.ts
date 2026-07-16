import { createHash, randomBytes } from "node:crypto";
import { getDatabasePool, isDatabaseConfigured } from "@/lib/server/database";
import { checkSessionConfiguration } from "@/lib/server/session";

export type MagicLinkConfiguration = {
  status: "not-configured" | "ready";
  missing: string[];
};

type MagicLinkChallengeInput = {
  email: string;
  displayName?: string;
  workspaceName?: string;
  redirectPath?: string;
};

type MagicLinkChallenge = {
  token: string;
  email: string;
  expiresAt: string;
};

type ConsumedMagicLinkChallenge = {
  email: string;
  displayName: string | null;
  workspaceName: string | null;
  redirectPath: string;
};

export function checkMagicLinkConfiguration(): MagicLinkConfiguration {
  const missing = [
    isDatabaseConfigured() ? null : "DATABASE_URL",
    checkSessionConfiguration().status === "ready" ? null : "SESSION_SECRET",
    process.env.RESEND_API_KEY?.trim() ? null : "RESEND_API_KEY",
    process.env.RESEND_FROM_EMAIL?.trim() ? null : "RESEND_FROM_EMAIL",
    process.env.NODE_ENV !== "production" || getMagicLinkAppOrigin() ? null : "NEXT_PUBLIC_APP_URL or APP_URL",
  ].filter((value): value is string => Boolean(value));

  return { status: missing.length ? "not-configured" : "ready", missing };
}

export function getMagicLinkAppOrigin(requestOrigin?: string) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim();
  const candidate = configured || (process.env.NODE_ENV !== "production" ? requestOrigin : undefined);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (!url.hostname || (process.env.NODE_ENV === "production" && url.protocol !== "https:")) return null;
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export async function createMagicLinkChallenge(input: MagicLinkChallengeInput): Promise<MagicLinkChallenge> {
  await ensureMagicLinkTable();

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  const redirectPath = normalizeRedirectPath(input.redirectPath);

  await getDatabasePool().query(
    `insert into auth_magic_links (token_hash, email, display_name, workspace_name, redirect_path, expires_at)
     values ($1, $2, nullif($3, ''), nullif($4, ''), $5, $6)`,
    [tokenHash, input.email, input.displayName?.trim() ?? "", input.workspaceName?.trim() ?? "", redirectPath, expiresAt],
  );

  return { token, email: input.email, expiresAt };
}

export async function consumeMagicLinkChallenge(token: string): Promise<ConsumedMagicLinkChallenge | null> {
  await ensureMagicLinkTable();

  const result = await getDatabasePool().query<{
    email: string;
    display_name: string | null;
    workspace_name: string | null;
    redirect_path: string | null;
  }>(
    `delete from auth_magic_links
     where token_hash = $1
       and expires_at > now()
     returning email, display_name, workspace_name, redirect_path`,
    [hashToken(token)],
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    email: row.email,
    displayName: row.display_name,
    workspaceName: row.workspace_name,
    redirectPath: normalizeRedirectPath(row.redirect_path),
  };
}

export async function sendMagicLinkEmail(input: { email: string; link: string; expiresAt: string }) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!apiKey || !from) throw new Error("Resend is not configured.");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: input.email,
      subject: "Sign in to Vognary",
      text: `Use this link to sign in to Vognary: ${input.link}\n\nThis link expires at ${input.expiresAt}.`,
      html: `<p>Use this link to sign in to Vognary:</p><p><a href="${escapeHtml(input.link)}">Sign in to Vognary</a></p><p>This link expires at ${escapeHtml(input.expiresAt)}.</p>`,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Resend email send failed: ${response.status}${detail ? ` ${detail.slice(0, 180)}` : ""}`);
  }
}

export function maskEmail(email: string) {
  const [local = "", domain = ""] = email.split("@");
  const visible = local.slice(0, 2);
  return `${visible}${local.length > 2 ? "***" : "*"}@${domain}`;
}

async function ensureMagicLinkTable() {
  await getDatabasePool().query("create extension if not exists pgcrypto");
  await getDatabasePool().query(
    `create table if not exists auth_magic_links (
       id uuid primary key default gen_random_uuid(),
       token_hash text unique not null,
       email text not null,
       display_name text,
       workspace_name text,
       redirect_path text not null default '/',
       expires_at timestamptz not null,
       created_at timestamptz not null default now()
     )`,
  );
  await getDatabasePool().query("create index if not exists auth_magic_links_expires_idx on auth_magic_links(expires_at)");
  await getDatabasePool().query("delete from auth_magic_links where expires_at <= now()");
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function normalizeRedirectPath(path: string | null | undefined) {
  if (!path || path.length > 256 || path !== path.trim()) return "/";
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return "/";

  // Reject encoded and double-encoded separators/control characters too. URL
  // parsers disagree about backslashes, so validating only startsWith("//") is
  // insufficient for a security boundary.
  let decoded = path;
  for (let pass = 0; pass < 3; pass += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next.startsWith("//") || next.includes("\\") || /[\u0000-\u001f\u007f]/.test(next)) return "/";
      if (next === decoded) break;
      decoded = next;
    } catch {
      return "/";
    }
  }

  try {
    const base = new URL("https://vognary.invalid/");
    const parsed = new URL(path, base);
    if (parsed.origin !== base.origin || parsed.username || parsed.password) return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
