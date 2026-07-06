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

export function getMonitoringBackendStatus(): MonitoringBackendStatus {
  if (process.env.SENTRY_DSN?.trim()) return "sentry";
  if (process.env.BETTER_STACK_SOURCE_TOKEN?.trim()) return "better-stack";
  if (process.env.AXIOM_TOKEN?.trim()) return "axiom-token-configured-needs-dataset";
  return "not-configured";
}

export async function reportServerError(error: unknown, request: MonitoringErrorRequest, context: MonitoringErrorContext) {
  const normalized = normalizeError(error);
  const backend = getMonitoringBackendStatus();

  try {
    if (backend === "sentry") {
      await sendSentryEvent(normalized, request, context);
      return;
    }
    if (backend === "better-stack") {
      await sendBetterStackLog(normalized, request, context);
    }
  } catch {
    // Monitoring must never make the user-facing failure path worse.
  }
}

async function sendSentryEvent(error: NormalizedError, request: MonitoringErrorRequest, context: MonitoringErrorContext) {
  const endpoint = getSentryEnvelopeEndpoint();
  if (!endpoint) return;

  const eventId = createEventId();
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

  await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-sentry-envelope" },
    body: [
      JSON.stringify({ event_id: eventId, sent_at: sentAt }),
      JSON.stringify({ type: "event" }),
      JSON.stringify(event),
    ].join("\n"),
    signal: getMonitoringTimeoutSignal(),
  });
}

async function sendBetterStackLog(error: NormalizedError, request: MonitoringErrorRequest, context: MonitoringErrorContext) {
  const token = process.env.BETTER_STACK_SOURCE_TOKEN?.trim();
  if (!token) return;

  await fetch("https://in.logs.betterstack.com/", {
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
      message: error.message || "Unhandled server error",
      stack: error.stack,
      digest: readDigest(error),
    };
  }

  return {
    name: "UnknownError",
    message: typeof error === "string" ? error : "Unhandled server error",
    digest: readDigest(error),
  };
}

function readDigest(value: unknown) {
  return value && typeof value === "object" && "digest" in value ? String(value.digest) : undefined;
}

function sanitizeHeaders(headers: Record<string, string | string[] | undefined>) {
  const allowed = new Set(["host", "referer", "user-agent", "x-forwarded-for", "x-real-ip", "x-vercel-id"]);
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([key, value]) => value !== undefined && allowed.has(key.toLowerCase()))
      .map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : value]),
  );
}

function createEventId() {
  return globalThis.crypto?.randomUUID?.().replace(/-/g, "") ?? `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 18)}`.slice(0, 32);
}

function getMonitoringTimeoutSignal() {
  return typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(2500) : undefined;
}