import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import { GET as getAuditPackSigningKeys, POST as signAuditPackPost } from "../src/app/api/audit-packs/sign/route";
import {
  attachIssuerSignature,
  buildIssuerSignaturePayload,
  canonicalize,
  hashContent,
  sealAuditPack,
  verifyAuditPack,
  type PackIssuerSignature,
  type SealedAuditPack,
} from "../src/lib/audit-pack";
import {
  getPublicAuditPackSigningKeys,
  signAuditPackIntegrity,
} from "../src/lib/server/audit-pack-signing";

test("canonicalize is stable across key order", () => {
  const a = canonicalize({ b: 1, a: { d: [1, 2], c: "x" } });
  const b = canonicalize({ a: { c: "x", d: [1, 2] }, b: 1 });
  assert.equal(a, b);
  assert.equal(a, '{"a":{"c":"x","d":[1,2]},"b":1}');
});

test("issuer signing endpoint rejects unauthenticated callers before signing", async () => {
  const response = await signAuditPackPost(new Request("https://vognary.example/api/audit-packs/sign", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "audit-pack-unauthenticated-test",
    },
    body: JSON.stringify({ integrity: {} }),
  }));

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Authentication required." });
});

test("canonicalize drops undefined object members and preserves array order", () => {
  assert.equal(canonicalize({ a: undefined, b: 2 }), '{"b":2}');
  assert.equal(canonicalize([3, 1, 2]), "[3,1,2]");
});

test("seal then verify round-trips as valid", async () => {
  const pack = { merchant: "OpenAI", monthly: 1999, items: [{ id: "a", amount: 1999 }] };
  const { sealed, chain } = await sealAuditPack(pack, null);

  assert.equal(sealed.integrity.chainIndex, 1);
  assert.equal(sealed.integrity.prevHash, null);
  assert.match(sealed.integrity.contentHash, /^[0-9a-f]{64}$/);
  assert.equal(chain.lastHash, sealed.integrity.contentHash);

  const verification = await verifyAuditPack(sealed);
  assert.equal(verification.valid, true);
  assert.equal(verification.checksumValid, true);
  assert.equal(verification.issuerSignature.status, "not-present");
  assert.match(verification.issuerSignature.detail, /authorship is not established/i);
});

test("tampering with any field breaks the seal", async () => {
  const { sealed } = await sealAuditPack({ merchant: "OpenAI", monthly: 1999 }, null);
  const tampered = { ...sealed, monthly: 999 };

  const verification = await verifyAuditPack(tampered);
  assert.equal(verification.valid, false);
  assert.equal(verification.checksumValid, false);
  assert.ok(verification.reasons.some((reason) => reason.includes("changed")));
});

test("chains successive exports", async () => {
  const first = await sealAuditPack({ n: 1 }, null);
  const second = await sealAuditPack({ n: 2 }, first.chain);

  assert.equal(second.sealed.integrity.chainIndex, 2);
  assert.equal(second.sealed.integrity.prevHash, first.chain.lastHash);
});

test("rejects non-pack inputs with clear reasons", async () => {
  assert.equal((await verifyAuditPack("nope")).valid, false);
  assert.equal((await verifyAuditPack({ no: "integrity" })).valid, false);
});

test("hashContent matches a known SHA-256 vector", async () => {
  assert.equal(
    await hashContent("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("verifies an Ed25519 issuer signature only against a trusted Vognary key", async () => {
  const fixture = await createSignedFixture();
  const verification = await verifyAuditPack(fixture.pack, {
    trustedIssuerKeys: { [fixture.keyId]: fixture.publicKeySpki },
  });

  assert.equal(verification.checksumValid, true);
  assert.equal(verification.issuerSignature.status, "valid");
  assert.equal(verification.valid, true);
  assert.match(verification.issuerSignature.detail, /does not independently validate the financial claims/i);
});

test("server signing uses configured Ed25519 key and binds an opaque workspace reference", async () => {
  const { privateKey } = generateKeyPairSync("ed25519");
  const priorPrivateKey = process.env.AUDIT_PACK_SIGNING_PRIVATE_KEY;
  const priorKeyId = process.env.AUDIT_PACK_SIGNING_KEY_ID;
  process.env.AUDIT_PACK_SIGNING_PRIVATE_KEY = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
  process.env.AUDIT_PACK_SIGNING_KEY_ID = "vognary-server-test";

  try {
    const { sealed } = await sealAuditPack({ merchant: "OpenAI", monthly: 1999 }, null);
    const issuerSignature = signAuditPackIntegrity(sealed.integrity, "workspace-secret-id", "2026-07-11T10:00:00.000Z");
    const trustedKey = getPublicAuditPackSigningKeys().find((key) => key.keyId === issuerSignature.keyId);
    assert.ok(trustedKey);
    assert.equal(issuerSignature.workspaceRef.includes("workspace-secret-id"), false);

    const discoveryResponse = await getAuditPackSigningKeys();
    const discoveryText = await discoveryResponse.text();
    assert.match(discoveryText, /vognary-server-test/);
    assert.equal(discoveryText.includes(process.env.AUDIT_PACK_SIGNING_PRIVATE_KEY), false);

    const signed = attachIssuerSignature(sealed, issuerSignature);
    const verification = await verifyAuditPack(signed, {
      trustedIssuerKeys: { [trustedKey.keyId]: trustedKey.publicKeySpki },
    });
    assert.equal(verification.issuerSignature.status, "valid");
  } finally {
    restoreEnv("AUDIT_PACK_SIGNING_PRIVATE_KEY", priorPrivateKey);
    restoreEnv("AUDIT_PACK_SIGNING_KEY_ID", priorKeyId);
  }
});

test("a cryptographic signature from an unknown key does not establish Vognary issuance", async () => {
  const fixture = await createSignedFixture();
  const verification = await verifyAuditPack(fixture.pack, { trustedIssuerKeys: {} });

  assert.equal(verification.checksumValid, true);
  assert.equal(verification.issuerSignature.status, "unknown-key");
  assert.match(verification.issuerSignature.detail, /cannot be confirmed/i);
});

test("tampering with signed chain metadata invalidates the issuer signature", async () => {
  const fixture = await createSignedFixture();
  const tampered = {
    ...fixture.pack,
    integrity: { ...fixture.pack.integrity, chainIndex: fixture.pack.integrity.chainIndex + 1 },
  };
  const verification = await verifyAuditPack(tampered, {
    trustedIssuerKeys: { [fixture.keyId]: fixture.publicKeySpki },
  });

  assert.equal(verification.checksumValid, true, "the separate report-content checksum remains intact");
  assert.equal(verification.issuerSignature.status, "invalid");
  assert.equal(verification.valid, false);
});

test("a user can reseal edited content, so self-checksum alone is never issuer proof", async () => {
  const original = await sealAuditPack({ merchant: "OpenAI", monthly: 1999 }, null);
  const attackerResealed = await sealAuditPack({ merchant: "OpenAI", monthly: 1 }, null);

  assert.notEqual(original.sealed.integrity.contentHash, attackerResealed.sealed.integrity.contentHash);
  const verification = await verifyAuditPack(attackerResealed.sealed);
  assert.equal(verification.checksumValid, true);
  assert.equal(verification.issuerSignature.status, "not-present");
  assert.match(verification.reasons.join(" "), /does not, by itself, prove who created or issued/i);
});

test("rejects malformed chain metadata instead of presenting it as verified", async () => {
  const { sealed } = await sealAuditPack({ n: 1 }, null);
  const malformed = { ...sealed, integrity: { ...sealed.integrity, chainIndex: 0 } };
  const verification = await verifyAuditPack(malformed);

  assert.equal(verification.valid, false);
  assert.match(verification.reasons.join(" "), /positive integer/i);
});

async function createSignedFixture(): Promise<{
  pack: SealedAuditPack;
  keyId: string;
  publicKeySpki: string;
}> {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyBytes = publicKey.export({ format: "der", type: "spki" });
  const publicKeySpki = publicKeyBytes.toString("base64");
  const publicKeyFingerprint = createHash("sha256").update(publicKeyBytes).digest("hex");
  const keyId = "vognary-test-2026";
  const { sealed } = await sealAuditPack({ merchant: "OpenAI", monthly: 1999 }, null);
  const metadata: Omit<PackIssuerSignature, "signature"> = {
    version: 1,
    issuer: "Vognary",
    algorithm: "Ed25519",
    keyId,
    publicKeyFingerprint,
    issuedAt: "2026-07-11T10:00:00.000Z",
    workspaceRef: createHash("sha256").update("workspace-test").digest("hex"),
  };
  const signature = sign(
    null,
    Buffer.from(buildIssuerSignaturePayload(sealed.integrity, metadata), "utf8"),
    privateKey,
  ).toString("base64");

  return {
    pack: attachIssuerSignature(sealed, { ...metadata, signature }),
    keyId,
    publicKeySpki,
  };
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
