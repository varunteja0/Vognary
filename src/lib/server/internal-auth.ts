import { timingSafeEqual } from "node:crypto";

export const operationalSecretMinimumBytes = 32;

export function isOperationalSecretValid(value: string | null | undefined) {
  return Boolean(value && Buffer.byteLength(value.trim(), "utf8") >= operationalSecretMinimumBytes);
}

export function requireInternalSecret(request: Request) {
  const configured = process.env.INTERNAL_SYNC_SECRET?.trim();
  if (!configured || !isOperationalSecretValid(configured)) {
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

export function requireCronSecret(request: Request) {
  const configured = process.env.CRON_SECRET?.trim();
  if (!configured || !isOperationalSecretValid(configured)) {
    return Response.json({
      status: "not-configured",
      requiredEnv: ["CRON_SECRET"],
      message: "Configure CRON_SECRET before enabling scheduled worker execution.",
    }, { status: 501 });
  }

  const supplied = readBearerToken(request);
  if (!supplied || !safeEqual(configured, supplied)) {
    return Response.json({ error: "Unauthorized cron invocation." }, { status: 401 });
  }

  return null;
}

function readInternalSecret(request: Request) {
  const bearer = readBearerToken(request);
  if (bearer) return bearer;
  return request.headers.get("x-vognary-internal-secret")?.trim() ?? null;
}

function readBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.toLowerCase().startsWith("bearer ") ? authorization.slice("bearer ".length).trim() : null;
}

function safeEqual(expected: string, supplied: string) {
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}
