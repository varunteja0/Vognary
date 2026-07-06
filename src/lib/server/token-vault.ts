import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const algorithm = "aes-256-gcm" as const;
const keyByteLength = 32;

export type TokenVaultStatus = {
  status: "not-configured" | "ready" | "invalid";
  keyFingerprint?: string;
  message?: string;
};

export type EncryptedSecret = {
  version: "v1";
  algorithm: "aes-256-gcm";
  iv: string;
  ciphertext: string;
  tag: string;
  keyFingerprint: string;
};

export function checkTokenVaultConfiguration(): TokenVaultStatus {
  const rawKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (!rawKey) return { status: "not-configured" };

  try {
    const key = parseTokenEncryptionKey(rawKey);
    assertRoundTripWithKey(key);
    return {
      status: "ready",
      keyFingerprint: fingerprintKey(key),
    };
  } catch (error) {
    return {
      status: "invalid",
      message: error instanceof Error ? error.message : "Token encryption key is invalid.",
    };
  }
}

export function encryptSecret(plaintext: string, associatedData: string) {
  const key = getTokenEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, key, iv);
  cipher.setAAD(Buffer.from(associatedData, "utf8"));

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: "v1" as const,
    algorithm,
    iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    tag: tag.toString("base64url"),
    keyFingerprint: fingerprintKey(key),
  };
}

export function decryptSecret(encrypted: EncryptedSecret, associatedData: string) {
  if (encrypted.version !== "v1" || encrypted.algorithm !== algorithm) {
    throw new Error("Unsupported encrypted secret payload.");
  }

  const key = getTokenEncryptionKey();
  const expectedFingerprint = Buffer.from(fingerprintKey(key));
  const actualFingerprint = Buffer.from(encrypted.keyFingerprint);
  if (expectedFingerprint.length !== actualFingerprint.length || !timingSafeEqual(expectedFingerprint, actualFingerprint)) {
    throw new Error("Token encryption key fingerprint does not match the encrypted payload.");
  }

  const decipher = createDecipheriv(algorithm, key, Buffer.from(encrypted.iv, "base64url"));
  decipher.setAAD(Buffer.from(associatedData, "utf8"));
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function assertTokenVaultRoundTrip() {
  const associatedData = "vognary-token-vault-self-test";
  const secret = `self-test-${cryptoRandomSuffix()}`;
  const encrypted = encryptSecret(secret, associatedData);
  const decrypted = decryptSecret(encrypted, associatedData);

  if (decrypted !== secret) {
    throw new Error("Token vault encryption round trip failed.");
  }

  return {
    status: "ok" as const,
    keyFingerprint: encrypted.keyFingerprint,
  };
}

function getTokenEncryptionKey() {
  const rawKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (!rawKey) throw new Error("TOKEN_ENCRYPTION_KEY is not configured.");
  return parseTokenEncryptionKey(rawKey);
}

function parseTokenEncryptionKey(rawKey: string) {
  const value = rawKey.trim();
  if (!value) throw new Error("TOKEN_ENCRYPTION_KEY is empty.");

  const key = /^[a-f0-9]{64}$/i.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64url");

  if (key.length !== keyByteLength) {
    throw new Error("TOKEN_ENCRYPTION_KEY must decode to 32 bytes for AES-256-GCM.");
  }

  return key;
}

function assertRoundTripWithKey(key: Buffer) {
  const associatedData = Buffer.from("vognary-token-vault-readiness", "utf8");
  const plaintext = Buffer.from("readiness-check", "utf8");
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, key, iv);
  cipher.setAAD(associatedData);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  const decipher = createDecipheriv(algorithm, key, iv);
  decipher.setAAD(associatedData);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  if (!timingSafeEqual(plaintext, decrypted)) {
    throw new Error("Token encryption key failed readiness round trip.");
  }
}

function fingerprintKey(key: Buffer) {
  return createHash("sha256").update(key).digest("base64url").slice(0, 16);
}

function cryptoRandomSuffix() {
  return randomBytes(8).toString("base64url");
}
