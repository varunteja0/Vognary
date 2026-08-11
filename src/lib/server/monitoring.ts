import { redactText } from "@/lib/redaction";
type MonitoringErrorRequest = {
  path: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
};

type MonitoringErrorContext = Record<string, unknown>;

type NormalizedError = {
  name: string;
  message: string;
  stack?: string;
  digest?: string;
};

export type MonitoringBackendStatus =
  | "sentry"
  | "better-stack"
  | "axiom-token-configured-needs-dataset"
  | "not-configured";

export type MonitoringDeliveryResult = {
  status: "delivered" | "not-configured" | "failed";
  backend: MonitoringBackendStatus;
  eventId?: string;
  message?: string;
};

export function getMonitoringBackendStatus(): MonitoringBackendStatus {
  if (process.env.SENTRY_DSN?.trim()) return "sentry";
  if (process.env.BETTER_STACK_SOURCE_TOKEN?.trim()) return "better-stack";
  if (process.env.AXIOM_TOKEN?.trim()) return "axiom-token-configured-needs-dataset";
  return "not-configured";
}

export async function reportServerError(error: unknown, request: MonitoringErrorRequest, context: MonitoringErrorContext) {
  await deliverServerError(error, request, context);
}

export async function sendMonitoringTestEvent(source: string): Promise<MonitoringDeliveryResult> {
  const eventId = createEventId();
  return deliverServerError(
    new Error(`Vognary monitoring delivery test ${eventId}`),
    {
      path: `/internal/monitoring/test/${source}`,
      method: "POST",
      headers: {},
    },
    {
      source,
      synthetic: true,
      eventId,
      timestamp: new Date().toISOString(),
    },
    eventId,
  );
}

async function deliverServerError(
  error: unknown,
  request: MonitoringErrorRequest,
  context: MonitoringErrorContext,
  suppliedEventId?: string,
): Promise<MonitoringDeliveryResult> {
  const normalized = normalizeError(error);
  const safeRequest = sanitizeRequest(request);
  const safeContext = sanitizeMonitoringValue(context) as MonitoringErrorContext;
  const backend = getMonitoringBackendStatus();

  if (backend === "not-configured" || backend === "axiom-token-configured-needs-dataset") {
    return {
      status: "not-configured",
      backend,
      message: backend === "axiom-token-configured-needs-dataset"
        ? "AXIOM_TOKEN is set but AXIOM_DATASET is not wired for delivery. Configure SENTRY_DSN or BETTER_STACK_SOURCE_TOKEN for server-error delivery."
        : "Configure SENTRY_DSN or BETTER_STACK_SOURCE_TOKEN for server-error delivery.",
    };
  }

  try {
    if (backend === "sentry") {
      const eventId = await sendSentryEvent(normalized, safeRequest, safeContext, suppliedEventId);
      return { status: "delivered", backend, eventId };
    }
    if (backend === "better-stack") {
      await sendBetterStackLog(normalized, safeRequest, safeContext);
      return { status: "delivered", backend, eventId: suppliedEventId };
    }
  } catch (error) {
    // Monitoring must never make the user-facing failure path worse.
    return {
      status: "failed",
      backend,
      eventId: suppliedEventId,
      message: error instanceof Error ? error.message : "Monitoring delivery failed.",
    };
  }

  return { status: "not-configured", backend };
}

async function sendSentryEvent(error: NormalizedError, request: MonitoringErrorRequest, context: MonitoringErrorContext, suppliedEventId?: string) {
  const endpoint = getSentryEnvelopeEndpoint();
  if (!endpoint) throw new Error("SENTRY_DSN is invalid or missing a project id.");

  const eventId = suppliedEventId ?? createEventId();
  const sentAt = new Date().toISOString();
  const event = {
    event_id: eventId,
    timestamp: sentAt,
    platform: "javascript",
    level: "error",
    logger: "vognary.next",
    environment: process.env.NODE_ENV,
    release: process.env.VERCEL_GIT_COMMIT_SHA || undefined,
    message: error.message,
    exception: {
      values: [
        {
          type: error.name,
          value: error.message,
        },
      ],
    },
    request: {
      url: request.path,
      method: request.method,
      headers: sanitizeHeaders(request.headers),
    },
    contexts: {
      next: context,
    },
    extra: {
      digest: error.digest,
      stack: error.stack,
    },
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-sentry-envelope" },
    body: [
      JSON.stringify({ event_id: eventId, sent_at: sentAt }),
      JSON.stringify({ type: "event" }),
      JSON.stringify(event),
    ].join("\n"),
    signal: getMonitoringTimeoutSignal(),
  });

  if (!response.ok) throw new Error(`Sentry delivery failed with HTTP ${response.status}.`);
  return eventId;
}

async function sendBetterStackLog(error: NormalizedError, request: MonitoringErrorRequest, context: MonitoringErrorContext) {
  const token = process.env.BETTER_STACK_SOURCE_TOKEN?.trim();
  if (!token) return;

  const response = await fetch("https://in.logs.betterstack.com/", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      dt: new Date().toISOString(),
      level: "error",
      message: error.message,
      errorName: error.name,
      digest: error.digest,
      stack: error.stack,
      request: {
        path: request.path,
        method: request.method,
        headers: sanitizeHeaders(request.headers),
      },
      next: context,
      service: "vognary-web",
    }),
    signal: getMonitoringTimeoutSignal(),
  });

  if (!response.ok) throw new Error(`Better Stack delivery failed with HTTP ${response.status}.`);
}

function getSentryEnvelopeEndpoint() {
  const rawDsn = process.env.SENTRY_DSN?.trim();
  if (!rawDsn) return null;

  try {
    const dsn = new URL(rawDsn);
    const publicKey = dsn.username;
    const pathParts = dsn.pathname.split("/").filter(Boolean);
    const projectId = pathParts.at(-1);
    if (!publicKey || !projectId) return null;

    const pathPrefix = pathParts.slice(0, -1).join("/");
    const endpoint = new URL(`${pathPrefix ? `/${pathPrefix}` : ""}/api/${projectId}/envelope/`, `${dsn.protocol}//${dsn.host}`);
    endpoint.searchParams.set("sentry_key", publicKey);
    endpoint.searchParams.set("sentry_version", "7");
    endpoint.searchParams.set("sentry_client", "vognary-next/0.1");
    return endpoint.toString();
  } catch {
    return null;
  }
}

function normalizeError(error: unknown): NormalizedError {
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: redactMonitoringText(error.message || "Unhandled server error"),
      stack: error.stack ? redactMonitoringText(error.stack) : undefined,
      digest: readDigest(error),
    };
  }

  return {
    name: "UnknownError",
    message: typeof error === "string" ? redactMonitoringText(error) : "Unhandled server error",
    digest: readDigest(error),
  };
}

function readDigest(value: unknown) {
  return value && typeof value === "object" && "digest" in value ? String(value.digest) : undefined;
}

function sanitizeHeaders(headers: Record<string, string | string[] | undefined>) {
  const allowed = new Set(["host", "referer", "user-agent", "x-vercel-id"]);
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([key, value]) => value !== undefined && allowed.has(key.toLowerCase()))
      .map(([key, value]) => {
        const normalized = Array.isArray(value) ? value.join(", ") : value ?? "";
        return [key, key.toLowerCase() === "referer" ? sanitizeMonitoringPath(normalized) : redactMonitoringText(normalized)];
      }),
  );
}

function sanitizeRequest(request: MonitoringErrorRequest): MonitoringErrorRequest {
  return {
    path: sanitizeMonitoringPath(request.path),
    method: request.method.slice(0, 16).toUpperCase(),
    headers: sanitizeHeaders(request.headers),
  };
}

export function sanitizeMonitoringPath(rawPath: string) {
  if (!rawPath) return "/";
  try {
    const parsed = new URL(rawPath, "https://monitoring.invalid");
    return redactMonitoringText(parsed.pathname || "/");
  } catch {
    return redactMonitoringText(rawPath.split(/[?#]/, 1)[0] || "/");
  }
}

export function sanitizeMonitoringValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[TRUNCATED]";
  if (typeof value === "string") return redactMonitoringText(value).slice(0, 2_000);
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 25).map((entry) => sanitizeMonitoringValue(entry, depth + 1));
  if (typeof value !== "object") return String(value);

  const blockedKeys = /(?:authorization|cookie|token|secret|password|passcode|code|state|email|phone|account|card|payload|body|query|search|alias|recipient|subject|message|attachment|svix)/i;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !blockedKeys.test(key))
      .slice(0, 50)
      .map(([key, entry]) => [key, sanitizeMonitoringValue(entry, depth + 1)]),
  );
}

export function redactMonitoringText(value: string) {
  return redactText(value).text
    .replace(/\b(?:postgres(?:ql)?|redis|https?):\/\/[^\s]+/gi, "[REDACTED_URL]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk|rk|pk|sess|token)[-_][A-Za-z0-9_-]{12,}\b/gi, "[REDACTED_SECRET]")
    .replace(/\brcpt_[a-f0-9]{40}\b/gi, "[REDACTED_RECEIPT_ALIAS]")
    .replace(/\b[A-Fa-f0-9]{40,}\b/g, "[REDACTED_SECRET]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/([?&](?:token|code|state|key|secret|email)=)[^&#\s]*/gi, "$1[REDACTED]");
}

function createEventId() {
  return globalThis.crypto?.randomUUID?.().replace(/-/g, "") ?? `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 18)}`.slice(0, 32);
}

function getMonitoringTimeoutSignal() {
  return typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(2500) : undefined;
}
