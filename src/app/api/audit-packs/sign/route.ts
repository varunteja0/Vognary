import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import type { UnsignedPackIntegrity } from "@/lib/audit-pack";
import {
  checkAuditPackSigningConfiguration,
  getPublicAuditPackSigningKeys,
  signAuditPackIntegrity,
} from "@/lib/server/audit-pack-signing";
import {
  readLimitedJson,
  RequestBodyTooLargeError,
  UnsupportedContentTypeError,
} from "@/lib/server/request-body";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import { requireSession } from "@/lib/server/workspace-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const maxSigningRequestBytes = 16 * 1024;
const sha256Pattern = /^[0-9a-f]{64}$/;

// Public key discovery lets /verify validate signatures locally. No pack
// content is sent to this endpoint.
export async function GET() {
  const keys = getPublicAuditPackSigningKeys();
  const signing = checkAuditPackSigningConfiguration();
  return Response.json({
    status: keys.length ? "ready" : "not-configured",
    algorithm: "Ed25519",
    signingAvailable: signing.status === "ready",
    keys,
  }, {
    headers: {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
    },
  });
}

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;

  const limit = await rateLimit(request, { namespace: "audit-pack-sign", limit: 30, windowMs: 60 * 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const session = await requireSession(request);
  if (session instanceof Response) return session;
  if (!session.workspaceId) {
    return Response.json({ error: "Session has no workspace. Sign in again." }, { status: 400 });
  }

  const signing = checkAuditPackSigningConfiguration();
  if (signing.status !== "ready") {
    return Response.json({
      status: signing.status,
      error: signing.message,
      requiredEnv: ["AUDIT_PACK_SIGNING_PRIVATE_KEY"],
    }, { status: 501 });
  }

  let body: Record<string, unknown>;
  try {
    body = await readLimitedJson<Record<string, unknown>>(request, maxSigningRequestBytes);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return Response.json({ error: "Signing request is too large. Send only the integrity metadata." }, { status: 413 });
    }
    if (error instanceof UnsupportedContentTypeError) {
      return Response.json({ error: "Content-Type must be application/json." }, { status: 415 });
    }
    return Response.json({ error: "Valid JSON object required." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Valid JSON object required." }, { status: 400 });
  }
  const integrity = readUnsignedIntegrity(body.integrity);
  if (!integrity) {
    return Response.json({
      error: "A valid SHA-256 audit-pack integrity block is required. Report content must not be sent to this endpoint.",
    }, { status: 400 });
  }

  const issuerSignature = signAuditPackIntegrity(integrity, session.workspaceId);
  return Response.json({ status: "signed", issuerSignature }, { status: 201 });
}

function readUnsignedIntegrity(value: unknown): UnsignedPackIntegrity | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const integrity = value as Partial<UnsignedPackIntegrity>;
  if (integrity.version !== 1 || integrity.algorithm !== "SHA-256") return null;
  if (typeof integrity.contentHash !== "string" || !sha256Pattern.test(integrity.contentHash)) return null;
  if (integrity.prevHash !== null && (typeof integrity.prevHash !== "string" || !sha256Pattern.test(integrity.prevHash))) return null;
  if (typeof integrity.chainIndex !== "number" || !Number.isSafeInteger(integrity.chainIndex) || integrity.chainIndex < 1) return null;
  if (typeof integrity.sealedAt !== "string" || !isIsoDate(integrity.sealedAt)) return null;
  return {
    version: 1,
    algorithm: "SHA-256",
    contentHash: integrity.contentHash,
    prevHash: integrity.prevHash,
    chainIndex: integrity.chainIndex,
    sealedAt: integrity.sealedAt,
  };
}

function isIsoDate(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}
