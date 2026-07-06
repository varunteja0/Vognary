import { timingSafeEqual } from "node:crypto";

export function requireInternalSecret(request: Request) {
  const configured = process.env.INTERNAL_SYNC_SECRET?.trim();
  if (!configured) {
    return Response.json({
      status: "not-configured",
      requiredEnv: ["INTERNAL_SYNC_SECRET"],
      message: "Configure INTERNAL_SYNC_SECRET before enabling internal sync-job execution.",
    }, { status: 501 });
  }

  const supplied = readInternalSecret(request);
  if (!supplied || !safeEqual(configured, supplied)) {
    return Response.json({ error: "Unauthorized internal request." }, { status: 401 });
  }

  return null;
}

function readInternalSecret(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization.toLowerCase().startsWith("bearer ")) return authorization.slice("bearer ".length).trim();
  return request.headers.get("x-vognary-internal-secret")?.trim() ?? null;
}

function safeEqual(expected: string, supplied: string) {
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}