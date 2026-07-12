import assert from "node:assert/strict";
import { test } from "node:test";
import { assertContentLength, readLimitedJson, RequestBodyTooLargeError, UnsupportedContentTypeError } from "../src/lib/server/request-body";

test("readLimitedJson parses a bounded JSON request", async () => {
  const request = new Request("https://vognary.test/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "ok" }),
  });
  assert.deepEqual(await readLimitedJson(request, 1024), { status: "ok" });
});

test("readLimitedJson rejects unsupported content types", async () => {
  const request = new Request("https://vognary.test/api", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "{}",
  });
  await assert.rejects(() => readLimitedJson(request, 1024), UnsupportedContentTypeError);
});

test("body limits reject declared and streamed oversized requests", async () => {
  const declared = new Request("https://vognary.test/api", { headers: { "content-length": "100" } });
  assert.throws(() => assertContentLength(declared, 10), RequestBodyTooLargeError);

  const streamed = new Request("https://vognary.test/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value: "x".repeat(100) }),
  });
  await assert.rejects(() => readLimitedJson(streamed, 16), RequestBodyTooLargeError);
});
