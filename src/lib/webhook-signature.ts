import { createHmac, timingSafeEqual } from "node:crypto";

export type WebhookSignatureResult = {
  ok: boolean;
  reason?: string;
  secretEnvVar?: string;
};

export function getConnectorWebhookSecret(connectorId: string) {
  const envVar = connectorWebhookSecretEnvVar(connectorId);
  return {
    envVar,
    secret: process.env[envVar] || process.env.CONNECTOR_WEBHOOK_SECRET,
  };
}

export function verifyWebhookSignature(connectorId: string, rawBody: string, signatureHeader: string | null): WebhookSignatureResult {
  const { envVar, secret } = getConnectorWebhookSecret(connectorId);
  if (!secret) return { ok: false, reason: "missing-secret", secretEnvVar: envVar };
  if (!signatureHeader) return { ok: false, reason: "missing-signature", secretEnvVar: envVar };

  const supplied = normalizeSignature(signatureHeader);
  if (!supplied) return { ok: false, reason: "invalid-signature-format", secretEnvVar: envVar };

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const suppliedBuffer = Buffer.from(supplied, "hex");

  if (expectedBuffer.length !== suppliedBuffer.length) {
    return { ok: false, reason: "signature-mismatch", secretEnvVar: envVar };
  }

  return {
    ok: timingSafeEqual(expectedBuffer, suppliedBuffer),
    reason: timingSafeEqual(expectedBuffer, suppliedBuffer) ? undefined : "signature-mismatch",
    secretEnvVar: envVar,
  };
}

export function connectorWebhookSecretEnvVar(connectorId: string) {
  return `CONNECTOR_WEBHOOK_SECRET_${connectorId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}

function normalizeSignature(value: string) {
  const trimmed = value.trim();
  const withoutPrefix = trimmed.startsWith("sha256=") ? trimmed.slice("sha256=".length) : trimmed;
  return /^[a-f0-9]{64}$/i.test(withoutPrefix) ? withoutPrefix.toLowerCase() : null;
}