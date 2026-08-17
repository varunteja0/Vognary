import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST as logoutPost } from "../src/app/api/auth/logout/route";
import { POST as connectorPreviewPost } from "../src/app/api/connectors/[id]/sync/route";
import { openAiCostsAdapter } from "../src/lib/connectors/openai-costs-adapter";
import { checkDevelopmentLoginConfiguration, validateDevelopmentLogin } from "../src/lib/server/development-login";
import { checkMagicLinkConfiguration, getMagicLinkAppOrigin, normalizeRedirectPath, sendMagicLinkEmail } from "../src/lib/server/magic-link-auth";
import { requireCronSecret, requireInternalSecret } from "../src/lib/server/internal-auth";
import { requireRetentionExecutorSecret } from "../src/lib/server/retention-auth";
import { isEnvironmentConnectorPreviewEnabled } from "../src/lib/server/connector-preview-policy";
import { readSession, sessionCookieName } from "../src/lib/server/session";

test("development code login is impossible in production and email-bound elsewhere", () => {
  const configured = {
    NODE_ENV: "development",
    ENABLE_DEVELOPMENT_LOGIN: "true",
    DEVELOPMENT_LOGIN_EMAIL: "developer@example.com",
    DEVELOPMENT_LOGIN_ACCESS_CODE: "local-only-secret",
  };

  assert.equal(checkDevelopmentLoginConfiguration({ ...configured, NODE_ENV: "production" }).status, "disabled");
  assert.equal(validateDevelopmentLogin(
    { email: "developer@example.com", accessCode: "local-only-secret" },
    { ...configured, NODE_ENV: "production" },
  ), false);
  assert.equal(validateDevelopmentLogin(
    { email: "victim@example.com", accessCode: "local-only-secret" },
    configured,
  ), false);
  assert.equal(validateDevelopmentLogin(
    { email: "Developer@Example.com", accessCode: "local-only-secret" },
    configured,
  ), true);
});

test("magic-link redirects accept canonical local paths and reject parser-confusion attacks", () => {
  assert.equal(normalizeRedirectPath("/app?tab=renewals#next"), "/app?tab=renewals#next");
  assert.equal(normalizeRedirectPath("/connect"), "/connect");

  for (const attack of [
    "https://evil.example/steal",
    "//evil.example/steal",
    "/\\evil.example/steal",
    "/%5cevil.example/steal",
    "/%255cevil.example/steal",
    "/%2f%2fevil.example/steal",
    "/%252f%252fevil.example/steal",
    "/app%0d%0aLocation:%20https://evil.example",
  ]) {
    assert.equal(normalizeRedirectPath(attack), "/", attack);
  }
});

test("production magic links require and use a canonical HTTPS app origin", () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    APP_URL: process.env.APP_URL,
  };
  try {
    Reflect.set(process.env, "NODE_ENV", "production");
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.APP_URL;
    assert.equal(getMagicLinkAppOrigin("https://attacker.example"), null);
    assert.ok(checkMagicLinkConfiguration().missing.includes("NEXT_PUBLIC_APP_URL or APP_URL"));

    process.env.NEXT_PUBLIC_APP_URL = "https://www.vognary.com/path-is-ignored";
    assert.equal(getMagicLinkAppOrigin("https://attacker.example"), "https://www.vognary.com");
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("magic-link login stays deferred unless an explicit non-launch opt-in is set", () => {
  const names = ["DATABASE_URL", "SESSION_SECRET", "RESEND_API_KEY", "RESEND_FROM_EMAIL", "NEXT_PUBLIC_APP_URL", "ENABLE_MAGIC_LINK_LOGIN"] as const;
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  try {
    process.env.DATABASE_URL = "postgresql://example.invalid/vognary";
    process.env.SESSION_SECRET = "magic-link-deferred-test-session-secret-0123456789";
    process.env.RESEND_API_KEY = "resend-test";
    process.env.RESEND_FROM_EMAIL = "login@vognary.test";
    process.env.NEXT_PUBLIC_APP_URL = "https://www.vognary.com";
    delete process.env.ENABLE_MAGIC_LINK_LOGIN;
    assert.equal(checkMagicLinkConfiguration().status, "not-configured");
    assert.ok(checkMagicLinkConfiguration().missing.includes("ENABLE_MAGIC_LINK_LOGIN=true (deferred)"));

    process.env.ENABLE_MAGIC_LINK_LOGIN = "true";
    assert.equal(checkMagicLinkConfiguration().status, "ready");
  } finally {
    for (const name of names) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("magic-link provider failures never surface the provider response body", async () => {
  const previous = {
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.RESEND_FROM_EMAIL,
    fetch: globalThis.fetch,
  };
  process.env.RESEND_API_KEY = "resend-test-key";
  process.env.RESEND_FROM_EMAIL = "login@vognary.test";
  globalThis.fetch = async () => new Response("provider-private-diagnostic", { status: 400 });
  try {
    await assert.rejects(
      sendMagicLinkEmail({ email: "owner@example.test", link: "https://vognary.test/login", expiresAt: "2026-08-17T00:00:00.000Z" }),
      (error: Error) => {
        assert.match(error.message, /Resend email send failed: 400/);
        assert.doesNotMatch(error.message, /provider-private-diagnostic/);
        return true;
      },
    );
  } finally {
    if (previous.apiKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previous.apiKey;
    if (previous.from === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = previous.from;
    globalThis.fetch = previous.fetch;
  }
});

test("internal and cron execution reject configured secrets shorter than 32 bytes", async () => {
  const previous = {
    internal: process.env.INTERNAL_SYNC_SECRET,
    cron: process.env.CRON_SECRET,
  };
  process.env.INTERNAL_SYNC_SECRET = "short-internal";
  process.env.CRON_SECRET = "short-cron";
  try {
    const internal = requireInternalSecret(new Request("https://vognary.test/internal", {
      headers: { authorization: "Bearer short-internal" },
    }));
    const cron = requireCronSecret(new Request("https://vognary.test/cron", {
      headers: { authorization: "Bearer short-cron" },
    }));
    const retention = requireRetentionExecutorSecret(new Request("https://vognary.test/retention", {
      headers: { authorization: "Bearer short-cron" },
    }));
    assert.ok(internal instanceof Response);
    assert.ok(cron instanceof Response);
    assert.ok(retention instanceof Response);
    assert.equal(internal.status, 501);
    assert.equal(cron.status, 501);
    assert.equal(retention.status, 501);
  } finally {
    if (previous.internal === undefined) delete process.env.INTERNAL_SYNC_SECRET;
    else process.env.INTERNAL_SYNC_SECRET = previous.internal;
    if (previous.cron === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous.cron;
  }
});

test("Compose config supplies distinct valid operational secrets", () => {
  const compose = readFileSync("docker-compose.yml", "utf8");
  const internal = compose.match(/^\s*INTERNAL_SYNC_SECRET:\s*(\S+)\s*$/m)?.[1] ?? "";
  const cron = compose.match(/^\s*CRON_SECRET:\s*(\S+)\s*$/m)?.[1] ?? "";
  assert.ok(Buffer.byteLength(internal, "utf8") >= 32);
  assert.ok(Buffer.byteLength(cron, "utf8") >= 32);
  assert.notEqual(internal, cron);
});

test("environment-backed connector previews can never be enabled in production", () => {
  assert.equal(isEnvironmentConnectorPreviewEnabled({ NODE_ENV: "production", ENABLE_ENV_CONNECTOR_PREVIEW: "true" }), false);
  assert.equal(isEnvironmentConnectorPreviewEnabled({ NODE_ENV: "development", ENABLE_ENV_CONNECTOR_PREVIEW: "false" }), false);
  assert.equal(isEnvironmentConnectorPreviewEnabled({ NODE_ENV: "development", ENABLE_ENV_CONNECTOR_PREVIEW: "true" }), true);
});

test("a workspace connector cannot fall back to the deployment-wide OpenAI key", async () => {
  const previousKey = process.env.OPENAI_ADMIN_API_KEY;
  const previousPreview = process.env.ENABLE_ENV_CONNECTOR_PREVIEW;
  process.env.OPENAI_ADMIN_API_KEY = "deployment-wide-key-must-not-be-used";
  process.env.ENABLE_ENV_CONNECTOR_PREVIEW = "true";

  try {
    await assert.rejects(openAiCostsAdapter.connect({
      connectorId: "openai-costs",
      connectedAccountId: "00000000-0000-4000-8000-000000000010",
      workspaceId: "00000000-0000-4000-8000-000000000011",
      scopes: [],
    }), /not configured|not stored/i);
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_ADMIN_API_KEY;
    else process.env.OPENAI_ADMIN_API_KEY = previousKey;
    if (previousPreview === undefined) delete process.env.ENABLE_ENV_CONNECTOR_PREVIEW;
    else process.env.ENABLE_ENV_CONNECTOR_PREVIEW = previousPreview;
  }
});

test("connector preview POST is retired before adapter execution", async () => {
  const response = await connectorPreviewPost(
    new Request("https://vognary.example/api/connectors/openai-costs/sync", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "security-test-unauthenticated" },
      body: JSON.stringify({ workspaceId: "env-preview" }),
    }),
    { params: Promise.resolve({ id: "openai-costs" }) },
  );

  assert.equal(response.status, 410);
  assert.deepEqual(await response.json(), {
    status: "retired",
    ledgerAuthority: "RECOVERY_V1",
    message: "Direct provider connections are not part of the Recovery launch.",
    replacements: {
      forwardedReceipts: "/api/workspaces/current/sources/receipt-inbox",
      manualEvidence: "/api/workspaces/current/evidence",
    },
  });
});

test("signed cookie parsing rejects tampering and expiry without storing an email claim", () => {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "security-test-session-secret-with-sufficient-entropy";

  try {
    const claims = {
      sessionToken: "opaque-session-token",
      userId: "00000000-0000-4000-8000-000000000001",
      workspaceId: "00000000-0000-4000-8000-000000000002",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    };
    const value = signCookie(claims, process.env.SESSION_SECRET);
    const parsed = readSession(new NextRequest("https://vognary.example/app", {
      headers: { cookie: `${sessionCookieName}=${encodeURIComponent(value)}` },
    }));

    assert.deepEqual(parsed, claims);
    assert.equal("email" in (parsed ?? {}), false);

    const tampered = `${value.slice(0, -1)}${value.endsWith("a") ? "b" : "a"}`;
    assert.equal(readSession(new Request("https://vognary.example", {
      headers: { cookie: `${sessionCookieName}=${encodeURIComponent(tampered)}` },
    })), null);

    const expired = signCookie({ ...claims, expiresAt: Date.now() - 1 }, process.env.SESSION_SECRET);
    assert.equal(readSession(new Request("https://vognary.example", {
      headers: { cookie: `${sessionCookieName}=${encodeURIComponent(expired)}` },
    })), null);
  } finally {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});

test("logout always expires the browser cookie when no current session exists", async () => {
  const response = await logoutPost(new Request("https://vognary.example/api/auth/logout", { method: "POST" }));
  assert.equal(response.status, 200);
  const cookies = response.headers.get("set-cookie") ?? "";
  assert.match(cookies, /vognary_session=;/);
  assert.match(cookies, /vognary_gmail_oauth_state=;/);
  assert.match(cookies, /vognary_gmail_oauth_binding=;/);
  assert.match(cookies, /vognary_google_auth_state=;/);
  assert.match(cookies, /vognary_google_auth_next=;/);
  assert.match(cookies, /vognary_google_auth_nonce=;/);
  assert.match(cookies, /vognary_google_auth_pkce=;/);
  assert.match(cookies, /Max-Age=0/i);
});

function signCookie(payload: Record<string, unknown>, secret: string) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}
