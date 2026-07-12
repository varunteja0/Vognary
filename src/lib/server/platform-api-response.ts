import "server-only";

import { randomUUID } from "node:crypto";

export function createPlatformRequestId(request: Request) {
  const supplied = request.headers.get("x-request-id")?.trim();
  return supplied && /^[A-Za-z0-9._:-]{8,100}$/.test(supplied) ? supplied : randomUUID();
}

export function platformJson(body: unknown, requestId: string, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  headers.set("cache-control", "private, no-store");
  headers.set("x-request-id", requestId);
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function platformError(input: {
  requestId: string;
  status: number;
  code: string;
  message: string;
  hint?: string;
}) {
  return platformJson({
    error: {
      code: input.code,
      message: input.message,
      hint: input.hint ?? null,
      requestId: input.requestId,
    },
  }, input.requestId, { status: input.status });
}
