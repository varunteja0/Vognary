import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as signBytes,
  type KeyObject,
} from "node:crypto";
import {
  buildIssuerSignaturePayload,
  type PackIssuerSignature,
  type UnsignedPackIntegrity,
} from "@/lib/audit-pack";

type SigningConfiguration =
  | { status: "not-configured"; message: string }
  | { status: "invalid"; message: string }
  | {
      status: "ready";
      keyId: string;
      privateKey: KeyObject;
      publicKeySpki: string;
      publicKeyFingerprint: string;
    };

export type PublicAuditPackSigningKey = {
  keyId: string;
  algorithm: "Ed25519";
  publicKeySpki: string;
  publicKeyFingerprint: string;
  current: boolean;
};

export function checkAuditPackSigningConfiguration(): SigningConfiguration {
  const encodedPrivateKey = process.env.AUDIT_PACK_SIGNING_PRIVATE_KEY?.trim();
  if (!encodedPrivateKey) {
    return {
      status: "not-configured",
      message: "AUDIT_PACK_SIGNING_PRIVATE_KEY is not configured; exports retain their offline self-checksum without an issuer signature.",
    };
  }

  try {
    const privateKey = parsePrivateKey(encodedPrivateKey);
    if (privateKey.asymmetricKeyType !== "ed25519") {
      return { status: "invalid", message: "AUDIT_PACK_SIGNING_PRIVATE_KEY must be an Ed25519 PKCS#8 private key." };
    }

    const publicKey = createPublicKey(privateKey);
    const publicKeySpki = publicKey.export({ format: "der", type: "spki" }).toString("base64");
    const publicKeyFingerprint = fingerprintSpki(publicKeySpki);
    const configuredKeyId = process.env.AUDIT_PACK_SIGNING_KEY_ID?.trim();
    const keyId = configuredKeyId || `vognary-${publicKeyFingerprint.slice(0, 16)}`;
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(keyId)) {
      return { status: "invalid", message: "AUDIT_PACK_SIGNING_KEY_ID must use 1–64 letters, numbers, dots, underscores, or hyphens." };
    }

    return { status: "ready", keyId, privateKey, publicKeySpki, publicKeyFingerprint };
  } catch {
    return {
      status: "invalid",
      message: "AUDIT_PACK_SIGNING_PRIVATE_KEY is not a valid Ed25519 PKCS#8 PEM or base64 DER key.",
    };
  }
}

export function getPublicAuditPackSigningKeys(): PublicAuditPackSigningKey[] {
  const keys = new Map<string, PublicAuditPackSigningKey>();
  const current = checkAuditPackSigningConfiguration();
  if (current.status === "ready") {
    keys.set(current.keyId, {
      keyId: current.keyId,
      algorithm: "Ed25519",
      publicKeySpki: current.publicKeySpki,
      publicKeyFingerprint: current.publicKeyFingerprint,
      current: true,
    });
  }

  const historical = parseHistoricalPublicKeys(process.env.AUDIT_PACK_TRUSTED_PUBLIC_KEYS);
  for (const [keyId, publicKeySpki] of Object.entries(historical)) {
    if (keys.has(keyId)) continue;
    try {
      const publicKey = createPublicKey({
        key: Buffer.from(publicKeySpki, "base64"),
        format: "der",
        type: "spki",
      });
      if (publicKey.asymmetricKeyType !== "ed25519") continue;
      keys.set(keyId, {
        keyId,
        algorithm: "Ed25519",
        publicKeySpki,
        publicKeyFingerprint: fingerprintSpki(publicKeySpki),
        current: false,
      });
    } catch {
      // Invalid historical entries are omitted instead of weakening trust.
    }
  }

  return [...keys.values()];
}

export function signAuditPackIntegrity(
  integrity: UnsignedPackIntegrity,
  workspaceId: string,
  issuedAt = new Date().toISOString(),
): PackIssuerSignature {
  const configuration = checkAuditPackSigningConfiguration();
  if (configuration.status !== "ready") throw new Error(configuration.message);

  const metadata: Omit<PackIssuerSignature, "signature"> = {
    version: 1,
    issuer: "Vognary",
    algorithm: "Ed25519",
    keyId: configuration.keyId,
    publicKeyFingerprint: configuration.publicKeyFingerprint,
    issuedAt,
    workspaceRef: createHash("sha256").update(`vognary-workspace-v1:${workspaceId}`).digest("hex"),
  };
  const payload = buildIssuerSignaturePayload(integrity, metadata);
  const signature = signBytes(null, Buffer.from(payload, "utf8"), configuration.privateKey).toString("base64");
  return { ...metadata, signature };
}

function parsePrivateKey(value: string): KeyObject {
  const normalized = value.includes("BEGIN PRIVATE KEY") ? value.replace(/\\n/g, "\n") : value;
  if (normalized.includes("BEGIN PRIVATE KEY")) return createPrivateKey(normalized);
  return createPrivateKey({ key: Buffer.from(normalized, "base64"), format: "der", type: "pkcs8" });
}

function parseHistoricalPublicKeys(value: string | undefined): Record<string, string> {
  if (!value?.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([keyId, publicKey]) =>
          /^[A-Za-z0-9._-]{1,64}$/.test(keyId)
          && typeof publicKey === "string"
          && /^[A-Za-z0-9+/]+={0,2}$/.test(publicKey)),
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

function fingerprintSpki(publicKeySpki: string): string {
  return createHash("sha256").update(Buffer.from(publicKeySpki, "base64")).digest("hex");
}
