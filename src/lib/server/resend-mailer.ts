import "server-only";

const resendTimeoutMs = 8_000;

export class ResendDeliveryError extends Error {
  constructor(
    public readonly code:
      | "configuration"
      | "provider_conflict"
      | "provider_rate_limited"
      | "provider_unavailable"
      | "provider_rejected"
      | "timeout"
      | "network"
      | "unknown",
    public readonly retryable: boolean,
  ) {
    super(`Resend delivery failed (${code}).`);
    this.name = "ResendDeliveryError";
  }
}

export function isResendConfigured() {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.RESEND_FROM_EMAIL?.trim());
}

export async function sendWithResend(input: {
  email: string;
  idempotencyKey: string;
  message: { subject: string; text: string; html: string };
}) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!apiKey || !from) throw new ResendDeliveryError("configuration", false);

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": input.idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to: input.email,
        subject: input.message.subject,
        text: input.message.text,
        html: input.message.html,
      }),
      signal: AbortSignal.timeout(resendTimeoutMs),
    });

    if (response.ok) return;
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 409) throw new ResendDeliveryError("provider_conflict", true);
    if (response.status === 429) throw new ResendDeliveryError("provider_rate_limited", true);
    if (response.status >= 500) throw new ResendDeliveryError("provider_unavailable", true);
    throw new ResendDeliveryError("provider_rejected", false);
  } catch (error) {
    if (error instanceof ResendDeliveryError) throw error;
    if (isTimeoutError(error)) throw new ResendDeliveryError("timeout", true);
    if (error instanceof TypeError) throw new ResendDeliveryError("network", true);
    throw new ResendDeliveryError("unknown", true);
  }
}

function isTimeoutError(error: unknown) {
  return error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError");
}
