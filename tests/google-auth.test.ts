import assert from "node:assert/strict";
import { generateKeyPair } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createLocalJWKSet, exportJWK, SignJWT } from "jose";

import { verifyGoogleIdToken } from "../src/lib/server/google-auth";

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

function generateKeyPairAsync() {
  return new Promise<{ publicKey: import("node:crypto").KeyObject; privateKey: import("node:crypto").KeyObject }>((resolve, reject) => {
    generateKeyPair("rsa", { modulusLength: 2048 }, (error, publicKey, privateKey) => {
      if (error) reject(error);
      else resolve({ publicKey, privateKey });
    });
  });
}