import "server-only";

import { timingSafeEqual } from "node:crypto";
import type { RetentionInvocation } from "@/lib/server/retention-executor";

const noStoreHeaders = { "cache-control": "no-store", pragma: "no-cache" };

export function requireRetentionExecutorSecret(request: Request): { invocation: RetentionInvocation } | Response {
  const internalSecret = process.env.INTERNAL_SYNC_SECRET?.trim() || null;
  const cronSecret = process.env.CRON_SECRET?.trim() || null;
  if (!internalSecret && !cronSecret) {
    return Response.json({
      status: "not-configured",
      requiredEnv: ["INTERNAL_SYNC_SECRET or CRON_SECRET"],
      message: "Configure an internal or cron secret before retention execution.",
    }, { status: 501, headers: noStoreHeaders });
  }

  const supplied = readSecret(request);
  if (!supplied) return Response.json({ error: "Unauthorized retention invocation." }, { status: 401, headers: noStoreHeaders });
  if (cronSecret && safeEqual(cronSecret, supplied)) return { invocation: "cron" };
  if (internalSecret && safeEqual(internalSecret, supplied)) return { invocation: "internal-api" };
  return Response.json({ error: "Unauthorized retention invocation." }, { status: 401, headers: noStoreHeaders });
}

function readSecret(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization.toLowerCase().startsWith("bearer ")) return authorization.slice("bearer ".length).trim();
  return request.headers.get("x-vognary-internal-secret")?.trim() ?? null;
}

function safeEqual(expected: string, supplied: string) {
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}
