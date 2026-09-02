import { NextResponse, type NextRequest } from "next/server";
import { agentLinkHeader, agentNotFoundMarkdown } from "./lib/agent-content";

// Every public page route belongs here. A route that is missing answers the
// negotiated agent 404 below — and its RSC prefetch 404s in the browser console
// — even though the page renders fine for a normal HTML request.
// tests/agent-surface.test.ts keeps this in step with src/app/**/page.tsx.
const publicPagePaths = new Set([
  "/",
  "/.well-known/security.txt",
  "/brand",
  "/about",
  "/contact",
  "/security",
  "/privacy",
  "/terms",
  "/start",
  "/demo",
  "/pay",
  "/offline",
  "/verify",
]);

// Browsers, next/image and link-preview crawlers request assets with an Accept
// header that carries no text/html, so the negotiated agent 404 below would
// otherwise claim every real file under public/ and answer with Markdown.
// Anything holding a static asset extension belongs to Next's file handler,
// which serves the file or raises its own 404.
const staticAssetPathPattern =
  /\.(?:avif|css|gif|ico|jpe?g|js|json|map|mjs|mp4|otf|pdf|png|svg|ttf|txt|webm|webp|woff2?)$/i;

function prefersAgentNotFound(accept: string | null): boolean {
  if (!accept) return true;
  const entries = accept.split(",").map((entry) => {
    const [rawType = "", ...parameters] = entry.trim().toLowerCase().split(";");
    const qualityParameter = parameters.find((parameter) => parameter.trim().startsWith("q="));
    const quality = qualityParameter ? Number(qualityParameter.trim().slice(2)) : 1;
    return { type: rawType.trim(), quality: Number.isFinite(quality) ? quality : 0 };
  });
  if (entries.some(({ type, quality }) => quality > 0 && (type === "text/html" || type === "application/xhtml+xml"))) {
    return false;
  }
  return entries.some(({ type, quality }) => quality > 0 && (type === "text/markdown" || type === "*/*"));
}

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
  const pathname = request.nextUrl.pathname;

  if (pathname === "/index.md") {
    const url = request.nextUrl.clone();
    url.pathname = "/api/agent-home";
    url.search = "";
    return NextResponse.rewrite(url);
  }

  if (pathname === "/") {
    const response = NextResponse.next();
    response.headers.set("link", agentLinkHeader);
    return response;
  }

  const isSensitiveProductPath = pathname === "/app"
    || pathname.startsWith("/app/")
    || pathname === "/login"
    || pathname === "/profile"
    || pathname.startsWith("/profile/")
    || pathname.startsWith("/billing/");

  if (!isSensitiveProductPath) {
    if (!publicPagePaths.has(pathname)
      && !staticAssetPathPattern.test(pathname)
      && !request.headers.has("rsc")
      && prefersAgentNotFound(request.headers.get("accept"))) {
      // Vercel may normalize Vary on Next responses, so this negotiated 404 must never enter a shared cache.
      return new NextResponse(agentNotFoundMarkdown, {
        status: 404,
        headers: {
          "cache-control": "private, no-store",
          "content-type": "text/markdown; charset=utf-8",
          link: agentLinkHeader,
          vary: "Accept",
          "x-content-type-options": "nosniff",
        },
      });
    }
    return NextResponse.next();
  }

  if (pathname === "/app"
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
  matcher: [
    "/index.md",
    "/((?!api|_next/static|_next/image|autopilot|pwa|favicon.ico|icon.svg|apple-icon|opengraph-image.png|twitter-image.png|manifest.webmanifest|robots.txt|sitemap.xml|llms.txt|sw.js).*)",
  ],
};
