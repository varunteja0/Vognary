const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Reject browser cross-site mutations before cookie-authenticated handlers do
 * any work. SameSite cookies are useful defense-in-depth, but Origin checking
 * is the explicit CSRF boundary for every state-changing product API.
 */
export function rejectCrossSiteMutation(request: Request): Response | null {
  if (safeMethods.has(request.method.toUpperCase())) return null;

  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite === "cross-site") return csrfResponse();

  const suppliedOrigin = normalizeOrigin(request.headers.get("origin"));
  const allowedOrigins = getAllowedOrigins(request);

  if (!suppliedOrigin) {
    // Non-browser jobs generally omit both headers. Browser mutation requests
    // send Origin; fail closed in production when a browser context is clear.
    if (process.env.NODE_ENV === "production" && fetchSite) return csrfResponse();
    return null;
  }

  if (!allowedOrigins.has(suppliedOrigin)) return csrfResponse();
  return null;
}

function getAllowedOrigins(request: Request) {
  const origins = new Set<string>();
  const requestOrigin = normalizeOrigin(new URL(request.url).origin);
  if (requestOrigin) origins.add(requestOrigin);

  for (const configured of [
    process.env.APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.AUTH_URL,
  ]) {
    const origin = normalizeOrigin(configured ?? null);
    if (origin) origins.add(origin);
  }

  return origins;
}

function normalizeOrigin(value: string | null) {
  if (!value) return null;
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return null;
  }
}

function csrfResponse() {
  return Response.json({
    error: "Cross-site mutation blocked.",
    code: "cross_site_request",
    hint: "Retry this action from the Vognary application.",
  }, { status: 403 });
}
