export type UnsignedPackIntegrity = {
  version: 1;
  algorithm: "SHA-256";
  contentHash: string;
  prevHash: string | null;
  chainIndex: number;
  sealedAt: string;
};

export type PackIssuerSignature = {
  version: 1;
  issuer: "Vognary";
  algorithm: "Ed25519";
  keyId: string;
  publicKeyFingerprint: string;
  issuedAt: string;
  /** One-way binding to the authenticated workspace; never the workspace id. */
  workspaceRef: string;
  signature: string;
};

export type PackIntegrity = UnsignedPackIntegrity & {
  issuerSignature?: PackIssuerSignature;
};

export type SealedAuditPack = Record<string, unknown> & {
  integrity: PackIntegrity;
};

export type PackChainState = {
  lastHash: string;
  chainIndex: number;
};

export type PackIssuerSignatureStatus =
  | "not-present"
  | "valid"
  | "invalid"
  | "unknown-key"
  | "verification-unavailable";

export type PackIssuerSignatureVerification = {
  status: PackIssuerSignatureStatus;
  detail: string;
  keyId?: string;
  issuedAt?: string;
  publicKeyFingerprint?: string;
};

export type PackVerificationOptions = {
  /** Trusted Vognary Ed25519 public keys as base64-encoded SPKI DER. */
  trustedIssuerKeys?: Record<string, string>;
};

export type PackVerification = {
  /** True when the content checksum is intact and no claimed signature is invalid. */
  valid: boolean;
  checksumValid: boolean;
  reasons: string[];
  issuerSignature: PackIssuerSignatureVerification;
  contentHash?: string;
  integrity?: PackIntegrity;
};

const issuerSignatureDomain = "vognary.audit-pack.issuer-signature.v1";
const sha256Pattern = /^[0-9a-f]{64}$/;
const keyIdPattern = /^[A-Za-z0-9._-]{1,64}$/;
const base64Pattern = /^[A-Za-z0-9+/]+={0,2}$/;

// Canonical JSON: object keys sorted at every depth, arrays kept in order.
// Two copies of the same report content always hash identically, so its
// offline self-checksum can be recomputed without contacting Vognary.
export function canonicalize(value: unknown): string {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (value === undefined) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalize(entryValue)}`);
    return `{${entries.join(",")}}`;
  }
  return "null";
}

export async function hashContent(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

// The offline seal is deliberately a self-checksum, not proof of authorship.
// It detects report-content edits. The chain fields are self-declared unless
// an authenticated server adds an issuer signature that binds those fields.
export async function sealAuditPack(
  pack: Record<string, unknown>,
  previous: PackChainState | null,
): Promise<{ sealed: SealedAuditPack; chain: PackChainState }> {
  const { integrity: _dropped, ...content } = pack as { integrity?: unknown } & Record<string, unknown>;
  void _dropped;
  const contentHash = await hashContent(canonicalize(content));
  const integrity: PackIntegrity = {
    version: 1,
    algorithm: "SHA-256",
    contentHash,
    prevHash: previous?.lastHash ?? null,
    chainIndex: (previous?.chainIndex ?? 0) + 1,
    sealedAt: new Date().toISOString(),
  };

  return {
    sealed: { ...content, integrity },
    chain: { lastHash: contentHash, chainIndex: integrity.chainIndex },
  };
}

export function attachIssuerSignature(
  pack: SealedAuditPack,
  issuerSignature: PackIssuerSignature,
): SealedAuditPack {
  return {
    ...pack,
    integrity: {
      ...pack.integrity,
      issuerSignature,
    },
  };
}

// This exact canonical payload is signed by the server and verified in the
// browser. It contains hashes and issuance metadata only—never report rows,
// merchant names, amounts, notes, or other financial content.
export function buildIssuerSignaturePayload(
  integrity: UnsignedPackIntegrity,
  issuerSignature: Omit<PackIssuerSignature, "signature">,
): string {
  return canonicalize({
    domain: issuerSignatureDomain,
    integrity: {
      version: integrity.version,
      algorithm: integrity.algorithm,
      contentHash: integrity.contentHash,
      prevHash: integrity.prevHash,
      chainIndex: integrity.chainIndex,
      sealedAt: integrity.sealedAt,
    },
    issuer: {
      version: issuerSignature.version,
      name: issuerSignature.issuer,
      algorithm: issuerSignature.algorithm,
      keyId: issuerSignature.keyId,
      publicKeyFingerprint: issuerSignature.publicKeyFingerprint,
      issuedAt: issuerSignature.issuedAt,
      workspaceRef: issuerSignature.workspaceRef,
    },
  });
}

export async function verifyAuditPack(
  candidate: unknown,
  options: PackVerificationOptions = {},
): Promise<PackVerification> {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return invalidPack("The file is not a JSON object.");
  }

  const { integrity: rawIntegrity, ...content } = candidate as { integrity?: unknown } & Record<string, unknown>;
  const integrityReasons = validateIntegrity(rawIntegrity);
  if (integrityReasons.length || !rawIntegrity || typeof rawIntegrity !== "object") {
    return {
      ...invalidPack(integrityReasons[0] ?? "No integrity block found."),
      reasons: integrityReasons.length ? integrityReasons : ["No integrity block found."],
    };
  }

  const integrity = rawIntegrity as PackIntegrity;
  const recomputed = await hashContent(canonicalize(content));
  const checksumValid = recomputed === integrity.contentHash;
  const issuerSignature = await verifyIssuerSignature(integrity, options.trustedIssuerKeys ?? {});
  const signatureContradicted = issuerSignature.status === "invalid";

  const reasons = [
    checksumValid
      ? "Self-checksum matches the report content. This detects edits but does not, by itself, prove who created or issued the pack."
      : "Content checksum mismatch: the report content changed after this checksum was created.",
    issuerSignature.detail,
  ];

  return {
    valid: checksumValid && !signatureContradicted,
    checksumValid,
    reasons,
    issuerSignature,
    contentHash: recomputed,
    integrity,
  };
}

function validateIntegrity(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return ["No integrity block found. This may be an older export or a non-Vognary JSON file."];
  }

  const integrity = value as Partial<PackIntegrity>;
  const reasons: string[] = [];
  if (integrity.algorithm !== "SHA-256" || integrity.version !== 1) {
    reasons.push("Unknown checksum version or algorithm.");
  }
  if (typeof integrity.contentHash !== "string" || !sha256Pattern.test(integrity.contentHash)) {
    reasons.push("The integrity block does not carry a valid SHA-256 content hash.");
  }
  if (integrity.prevHash !== null && (typeof integrity.prevHash !== "string" || !sha256Pattern.test(integrity.prevHash))) {
    reasons.push("The previous-export hash is malformed.");
  }
  if (!Number.isSafeInteger(integrity.chainIndex) || Number(integrity.chainIndex) < 1) {
    reasons.push("The export chain index must be a positive integer.");
  }
  if (typeof integrity.sealedAt !== "string" || !isIsoDate(integrity.sealedAt)) {
    reasons.push("The checksum timestamp is malformed.");
  }
  return reasons;
}

async function verifyIssuerSignature(
  integrity: PackIntegrity,
  trustedIssuerKeys: Record<string, string>,
): Promise<PackIssuerSignatureVerification> {
  const signature = integrity.issuerSignature;
  if (!signature) {
    return {
      status: "not-present",
      detail: "No Vognary issuer signature is present. Anyone can create a matching self-checksum, so authorship is not established.",
    };
  }

  const malformedReason = validateIssuerSignature(signature);
  if (malformedReason) {
    return {
      status: "invalid",
      detail: `The claimed Vognary issuer signature is malformed: ${malformedReason}`,
      keyId: typeof signature.keyId === "string" ? signature.keyId : undefined,
    };
  }

  const summary = {
    keyId: signature.keyId,
    issuedAt: signature.issuedAt,
    publicKeyFingerprint: signature.publicKeyFingerprint,
  };
  const publicKeySpki = trustedIssuerKeys[signature.keyId];
  if (!publicKeySpki) {
    return {
      status: "unknown-key",
      detail: `An Ed25519 signature is present, but key “${signature.keyId}” is not in the trusted Vognary key registry. Issuance cannot be confirmed.`,
      ...summary,
    };
  }

  try {
    const publicKeyBytes = decodeBase64(publicKeySpki);
    const fingerprint = await sha256Bytes(publicKeyBytes);
    if (fingerprint !== signature.publicKeyFingerprint) {
      return {
        status: "invalid",
        detail: "The claimed signing-key fingerprint does not match the trusted Vognary public key.",
        ...summary,
      };
    }

    const signatureBytes = decodeBase64(signature.signature);
    const publicKey = await globalThis.crypto.subtle.importKey(
      "spki",
      toArrayBuffer(publicKeyBytes),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const { signature: _signature, ...metadata } = signature;
    void _signature;
    const payload = new TextEncoder().encode(buildIssuerSignaturePayload(integrity, metadata));
    const valid = await globalThis.crypto.subtle.verify(
      { name: "Ed25519" },
      publicKey,
      toArrayBuffer(signatureBytes),
      toArrayBuffer(payload),
    );

    return valid
      ? {
          status: "valid",
          detail: `Valid Ed25519 issuer signature from trusted Vognary key “${signature.keyId}”. This proves the signing service issued this hash for an authenticated workspace; it does not independently validate the financial claims.`,
          ...summary,
        }
      : {
          status: "invalid",
          detail: "The claimed Vognary issuer signature does not match the signed hash and metadata.",
          ...summary,
        };
  } catch {
    return {
      status: "verification-unavailable",
      detail: "This browser could not perform Ed25519 verification with the configured public key. The self-checksum result remains available, but issuer trust is unconfirmed.",
      ...summary,
    };
  }
}

function validateIssuerSignature(signature: Partial<PackIssuerSignature>): string | null {
  if (signature.version !== 1 || signature.issuer !== "Vognary" || signature.algorithm !== "Ed25519") {
    return "unknown issuer-signature version or algorithm";
  }
  if (typeof signature.keyId !== "string" || !keyIdPattern.test(signature.keyId)) return "invalid key id";
  if (typeof signature.publicKeyFingerprint !== "string" || !sha256Pattern.test(signature.publicKeyFingerprint)) {
    return "invalid public-key fingerprint";
  }
  if (typeof signature.workspaceRef !== "string" || !sha256Pattern.test(signature.workspaceRef)) return "invalid workspace binding";
  if (typeof signature.issuedAt !== "string" || !isIsoDate(signature.issuedAt)) return "invalid issuance timestamp";
  if (typeof signature.signature !== "string" || !base64Pattern.test(signature.signature)) return "invalid signature encoding";
  try {
    if (decodeBase64(signature.signature).byteLength !== 64) return "invalid Ed25519 signature length";
  } catch {
    return "invalid signature encoding";
  }
  return null;
}

function invalidPack(reason: string): PackVerification {
  return {
    valid: false,
    checksumValid: false,
    reasons: [reason],
    issuerSignature: {
      status: "not-present",
      detail: "Issuer signature was not checked because the pack structure is invalid.",
    },
  };
}

function isIsoDate(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function decodeBase64(value: string): Uint8Array {
  if (!base64Pattern.test(value)) throw new Error("Invalid base64.");
  const binary = globalThis.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", toArrayBuffer(bytes));
  return bytesToHex(new Uint8Array(digest));
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
