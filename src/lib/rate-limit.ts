type RateLimitOptions = {
  namespace: string;
  limit: number;
  windowMs: number;
  requireShared?: boolean;
  /** Already-opaque authenticated identity, such as an API-token row id. */
  identity?: string;
};

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfter: number;
  resetAt: string;
  backend: RateLimitBackendStatus;
  blockReason?: "limit-exceeded" | "shared-backend-required" | "shared-backend-error";
};

const globalStore = globalThis as typeof globalThis & {
  __vognaryRateLimits?: Map<string, RateLimitBucket>;
};

const buckets = globalStore.__vognaryRateLimits ?? new Map<string, RateLimitBucket>();
globalStore.__vognaryRateLimits = buckets;

type UpstashPipelineItem = {
  result?: unknown;
  error?: string;
};

type RateLimitBackendStatus =
  | "upstash-rest"
  | "upstash-missing-token"
  | "redis-url-configured-not-wired"
  | "shared-required-not-configured"
  | "in-memory";

export async function rateLimit(request: Request, options: RateLimitOptions): Promise<RateLimitResult> {
  const upstash = getUpstashConfig();
  if (upstash) {
    try {
      return await upstashRateLimit(request, options, upstash);
    } catch {
      if (requiresSharedBackend(options)) return sharedBackendUnavailable(options, "shared-backend-error");
      return memoryRateLimit(request, options);
    }
  }

  if (requiresSharedBackend(options)) return sharedBackendUnavailable(options, "shared-backend-required");
  return memoryRateLimit(request, options);
}

export function getRateLimitBackendStatus(): RateLimitBackendStatus {
  if (getUpstashConfig()) return "upstash-rest";
  if (process.env.UPSTASH_REDIS_REST_URL?.trim()) return "upstash-missing-token";
  if (process.env.REDIS_URL?.trim()) return "redis-url-configured-not-wired";
  if (requiresSharedBackend()) return "shared-required-not-configured";
  return "in-memory";
}

function memoryRateLimit(request: Request, options: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const identity = options.identity ?? getClientIdentity(request);
  const key = `${options.namespace}:${identity}`;
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    const resetAt = now + options.windowMs;
    buckets.set(key, { count: 1, resetAt });
    pruneExpiredBuckets(now);
    return buildResult(true, options.limit, options.limit - 1, resetAt, now, "in-memory");
  }

  if (current.count >= options.limit) {
    return buildResult(false, options.limit, 0, current.resetAt, now, "in-memory", "limit-exceeded");
  }

  current.count += 1;
  return buildResult(true, options.limit, Math.max(0, options.limit - current.count), current.resetAt, now, "in-memory");
}

async function upstashRateLimit(
  request: Request,
  options: RateLimitOptions,
  upstash: { url: string; token: string },
): Promise<RateLimitResult> {
  const now = Date.now();
  const identity = options.identity ?? getClientIdentity(request);
  const key = `rate-limit:${options.namespace}:${identity}`;

  const response = await fetch(`${upstash.url}/pipeline`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${upstash.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify([
      ["INCR", key],
      ["PEXPIRE", key, String(options.windowMs), "NX"],
      ["PTTL", key],
    ]),
    cache: "no-store",
  });

  if (!response.ok) throw new Error("Upstash rate limit request failed.");

  const results = await response.json() as UpstashPipelineItem[];
  const count = readRedisNumber(results[0]);
  const ttl = readRedisNumber(results[2]);
  if (!Number.isFinite(count) || results.some((item) => item.error)) {
    throw new Error("Upstash rate limit pipeline failed.");
  }

  const resetAt = now + (Number.isFinite(ttl) && ttl > 0 ? ttl : options.windowMs);
  return buildResult(count <= options.limit, options.limit, Math.max(0, options.limit - count), resetAt, now, "upstash-rest", count > options.limit ? "limit-exceeded" : undefined);
}

export function rateLimitExceeded(result: RateLimitResult) {
  const unavailable = result.blockReason === "shared-backend-required" || result.blockReason === "shared-backend-error";
  return Response.json(
    unavailable ? {
      error: result.blockReason === "shared-backend-error"
        ? "Shared rate limit backend is unavailable. Try again shortly."
        : "Shared rate limit backend is required before this production endpoint can accept traffic.",
      requiredEnv: ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
      backend: result.backend,
      retryAfter: result.retryAfter,
    } : {
      error: "Too many requests. Try again after the retry window.",
      retryAfter: result.retryAfter,
    },
    {
      status: unavailable ? 503 : 429,
      headers: {
        "Retry-After": String(result.retryAfter),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
        "X-RateLimit-Reset": result.resetAt,
      },
    },
  );
}

export function getClientIdentity(request: Request) {
  const session = readSession(request);
  if (session) return `user:${createHash("sha256").update(session.userId).digest("base64url").slice(0, 22)}`;
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwardedFor || request.headers.get("x-real-ip") || "local";
  return `network:${createHash("sha256").update(address).digest("base64url").slice(0, 22)}`;
}

function getUpstashConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim().replace(/\/$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  return url && token ? { url, token } : null;
}

function requiresSharedBackend(options?: Pick<RateLimitOptions, "requireShared">) {
  if (options?.requireShared) return true;
  if (process.env.ALLOW_IN_MEMORY_RATE_LIMITS === "true") return false;
  return process.env.NODE_ENV === "production";
}

function sharedBackendUnavailable(options: RateLimitOptions, blockReason: "shared-backend-required" | "shared-backend-error"): RateLimitResult {
  const now = Date.now();
  return buildResult(false, options.limit, 0, now + 60_000, now, getRateLimitBackendStatus(), blockReason);
}

function readRedisNumber(item: UpstashPipelineItem | undefined) {
  const value = item?.result;
  return typeof value === "number" ? value : Number(value);
}

function buildResult(
  allowed: boolean,
  limit: number,
  remaining: number,
  resetAt: number,
  now: number,
  backend: RateLimitBackendStatus,
  blockReason?: RateLimitResult["blockReason"],
): RateLimitResult {
  return {
    allowed,
    limit,
    remaining,
    retryAfter: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    resetAt: new Date(resetAt).toISOString(),
    backend,
    blockReason,
  };
}

function pruneExpiredBuckets(now: number) {
  if (buckets.size < 5000) return;

  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}
import { createHash } from "node:crypto";
import { readSession } from "@/lib/server/session";
