type RateLimitOptions = {
  namespace: string;
  limit: number;
  windowMs: number;
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
};

const globalStore = globalThis as typeof globalThis & {
  __vognaryRateLimits?: Map<string, RateLimitBucket>;
};

const buckets = globalStore.__vognaryRateLimits ?? new Map<string, RateLimitBucket>();
globalStore.__vognaryRateLimits = buckets;

export function rateLimit(request: Request, options: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const identity = getClientIdentity(request);
  const key = `${options.namespace}:${identity}`;
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    const resetAt = now + options.windowMs;
    buckets.set(key, { count: 1, resetAt });
    pruneExpiredBuckets(now);
    return buildResult(true, options.limit, options.limit - 1, resetAt, now);
  }

  if (current.count >= options.limit) {
    return buildResult(false, options.limit, 0, current.resetAt, now);
  }

  current.count += 1;
  return buildResult(true, options.limit, Math.max(0, options.limit - current.count), current.resetAt, now);
}

export function rateLimitExceeded(result: RateLimitResult) {
  return Response.json(
    {
      error: "Too many requests. Try again after the retry window.",
      retryAfter: result.retryAfter,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfter),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
        "X-RateLimit-Reset": result.resetAt,
      },
    },
  );
}

function getClientIdentity(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedFor || request.headers.get("x-real-ip") || "local";
}

function buildResult(allowed: boolean, limit: number, remaining: number, resetAt: number, now: number): RateLimitResult {
  return {
    allowed,
    limit,
    remaining,
    retryAfter: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    resetAt: new Date(resetAt).toISOString(),
  };
}

function pruneExpiredBuckets(now: number) {
  if (buckets.size < 5000) return;

  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}