import { NextResponse, type NextRequest } from "next/server";

const retiredModeHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Old Vognary demo retired</title>
</head>
<body>
  <main>
    <h1>This old Vognary demo is retired</h1>
    <p>Vognary now works only from evidence you add to your saved workspace. No sample financial records are shown.</p>
    <a href="/login?next=/app">Open current Vognary</a>
  </main>
</body>
</html>`;

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/app"
    && (request.nextUrl.searchParams.has("demo") || request.nextUrl.searchParams.has("guest"))) {
    return new NextResponse(retiredModeHtml, {
      status: 410,
      headers: {
        "cache-control": "public, max-age=300",
        "content-security-policy": "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        "content-type": "text/html; charset=utf-8",
        "x-content-type-options": "nosniff",
        "x-robots-tag": "noindex, nofollow",
      },
    });
  }

  const isDevelopment = process.env.NODE_ENV !== "production";
  const isHttps = request.nextUrl.protocol === "https:"
    || request.headers.get("x-forwarded-proto") === "https";
  // Same policy as next.config.ts public pages. A nonce on style-src strips
  // Next's inlined CSS (CSP3 ignores style unsafe-inline when a nonce is set),
  // which rendered /app as unstyled HTML. Do not reintroduce style nonces.
  const contentSecurityPolicy = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' https://www.googleapis.com https://oauth2.googleapis.com",
    "object-src 'none'",
    "media-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "manifest-src 'self'",
    ...(isDevelopment || !isHttps ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
  const response = NextResponse.next();
  response.headers.set("content-security-policy", contentSecurityPolicy);
  response.headers.set("x-robots-tag", "noindex, nofollow");
  return response;
}

export const config = {
  matcher: ["/app/:path*", "/login", "/profile/:path*", "/billing/:path*"],
};
