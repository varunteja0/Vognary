import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV !== "production";
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
  ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const nextConfig: NextConfig = {
  agentRules: false,
  output: process.env.VERCEL ? undefined : "standalone",
  // pdf.js resolves its worker relative to its own module at runtime. Keep the
  // parser external so standalone output preserves that module boundary, then
  // trace the worker explicitly because pdf.js loads it dynamically.
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas"],
  outputFileTracingIncludes: {
    "/api/ingest": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
  },
  experimental: {
    inlineCss: true,
  },
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // The indicator covered Account at top-right and sheet footers at bottom-left.
  devIndicators: false,
  poweredByHeader: false,
  async redirects() {
    return [
      { source: "/connect", destination: "/app", permanent: true },
      { source: "/integrations", destination: "/app", permanent: true },
      { source: "/sources", destination: "/app", permanent: true },
      { source: "/guide", destination: "/", permanent: true },
      { source: "/partners", destination: "/", permanent: true },
      { source: "/beta-readiness", destination: "/", permanent: true },
      { source: "/integration-model", destination: "/", permanent: true },
      { source: "/launch", destination: "/private-audit", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          ...(isDevelopment ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
        ],
      },
    ];
  },
};

export default nextConfig;
