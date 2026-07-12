export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Public liveness intentionally exposes no deployment configuration, provider
// state, key fingerprints, or database errors. Detailed readiness is internal.
export function GET() {
  return Response.json({
    service: "vognary-web",
    status: "ok",
    timestamp: new Date().toISOString(),
  }, {
    headers: { "cache-control": "no-store" },
  });
}
