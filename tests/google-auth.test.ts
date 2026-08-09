import assert from "node:assert/strict";
import { generateKeyPair } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createLocalJWKSet, exportJWK, SignJWT } from "jose";
import { NextRequest } from "next/server";

import { GET as startGoogleAuth } from "../src/app/api/auth/google/start/route";
import {
  checkGoogleAuthConfiguration,
  getGoogleAuthClientId,
  getGoogleAuthClientSecret,
  verifyGoogleIdToken,
} from "../src/lib/server/google-auth";

const googleEnvironmentKeys = [
  "NODE_ENV",
  "DATABASE_URL",
  "SESSION_SECRET",
  "NEXT_PUBLIC_APP_URL",
  "APP_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "GOOGLE_AUTH_CLIENT_ID",
  "GOOGLE_AUTH_CLIENT_SECRET",
  "GOOGLE_AUTH_REDIRECT_URI",
] as const;

test("Google ID tokens are verified locally for signature, issuer, audience, and expiry", async () => {
  const { privateKey, publicKey } = await generateKeyPairAsync();
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "google-test-key";
  publicJwk.alg = "RS256";
  const keySet = createLocalJWKSet({ keys: [publicJwk] });
  const now = Math.floor(Date.now() / 1_000);
  const token = await new SignJWT({ email: "owner@example.com", email_verified: true, name: "Owner" })
    .setProtectedHeader({ alg: "RS256", kid: publicJwk.kid })
    .setIssuer("https://accounts.google.com")
    .setAudience("google-client-id")
    .setSubject("google-user-1")
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(privateKey);

  const claims = await verifyGoogleIdToken(token, "google-client-id", keySet);
  assert.equal(claims.iss, "https://accounts.google.com");
  assert.equal(claims.sub, "google-user-1");
  assert.equal(claims.email, "owner@example.com");
  assert.equal(claims.email_verified, true);
  await assert.rejects(verifyGoogleIdToken(token, "other-client-id", keySet));

  const callback = readFileSync("src/app/api/auth/google/callback/route.ts", "utf8");
  assert.doesNotMatch(callback, /tokeninfo\?id_token/);
});

test("Google sign-in never falls back to Gmail OAuth credentials", async () => {
  await withGoogleEnvironment({
    NODE_ENV: "development",
    DATABASE_URL: "postgresql://configured.invalid/vognary",
    SESSION_SECRET: "google-auth-test-session-secret",
    GOOGLE_CLIENT_ID: "gmail-client-id",
    GOOGLE_CLIENT_SECRET: "gmail-client-secret",
    GOOGLE_AUTH_CLIENT_ID: undefined,
    GOOGLE_AUTH_CLIENT_SECRET: undefined,
  }, async () => {
    assert.equal(getGoogleAuthClientId(), "");
    assert.equal(getGoogleAuthClientSecret(), "");
    assert.deepEqual(checkGoogleAuthConfiguration().missing, [
      "GOOGLE_AUTH_CLIENT_ID",
      "GOOGLE_AUTH_CLIENT_SECRET",
    ]);

    const response = startGoogleAuth(new NextRequest("http://localhost:3000/api/auth/google/start?mode=json"));
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.status, "not-available");
    assert.equal("authUrl" in payload, false);
  });
});

test("Google sign-in advertises only a fully configured OIDC flow", async () => {
  await withGoogleEnvironment({
    NODE_ENV: "development",
    DATABASE_URL: "postgresql://configured.invalid/vognary",
    SESSION_SECRET: "google-auth-test-session-secret",
    GOOGLE_AUTH_CLIENT_ID: "dedicated-auth-client-id",
    GOOGLE_AUTH_CLIENT_SECRET: "dedicated-auth-client-secret",
    GOOGLE_AUTH_REDIRECT_URI: "http://localhost:3000/api/auth/google/callback",
    GOOGLE_CLIENT_ID: "gmail-client-id",
    GOOGLE_CLIENT_SECRET: "gmail-client-secret",
  }, async () => {
    assert.equal(checkGoogleAuthConfiguration().status, "ready");
    assert.equal(getGoogleAuthClientId(), "dedicated-auth-client-id");
    assert.equal(getGoogleAuthClientSecret(), "dedicated-auth-client-secret");

    const response = startGoogleAuth(new NextRequest("http://localhost:3000/api/auth/google/start?mode=json&next=/app"));
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.status, "ready");
    const authUrl = new URL(payload.authUrl);
    assert.equal(authUrl.searchParams.get("client_id"), "dedicated-auth-client-id");
    assert.equal(authUrl.searchParams.get("scope"), "openid email profile");
    assert.equal(authUrl.searchParams.get("redirect_uri"), "http://localhost:3000/api/auth/google/callback");
  });
});

async function withGoogleEnvironment(values: Partial<Record<(typeof googleEnvironmentKeys)[number], string | undefined>>, run: () => Promise<void>) {
  const previous = Object.fromEntries(googleEnvironmentKeys.map((name) => [name, process.env[name]]));
  try {
    for (const name of googleEnvironmentKeys) delete process.env[name];
    for (const [name, value] of Object.entries(values)) {
      if (value !== undefined) process.env[name] = value;
    }
    await run();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function generateKeyPairAsync() {
  return new Promise<{ publicKey: import("node:crypto").KeyObject; privateKey: import("node:crypto").KeyObject }>((resolve, reject) => {
    generateKeyPair("rsa", { modulusLength: 2048 }, (error, publicKey, privateKey) => {
      if (error) reject(error);
      else resolve({ publicKey, privateKey });
    });
  });
}