import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { readReceiptInboxRotationHeaders } from "../src/app/api/workspaces/current/sources/receipt-inbox/rotate/route";
import { RecoveryServiceError } from "../src/lib/server/recovery-api";

const rotateUrl = "https://vognary.test/api/workspaces/current/sources/receipt-inbox/rotate";
const aliasId = "2f626050-70f8-4cae-902d-caa9223cbebe";

test("receipt inbox rotation headers parse a quoted alias id and idempotency key", () => {
  const request = new Request(rotateUrl, {
    method: "POST",
    headers: {
      "idempotency-key": "receipt-rotate-0001",
      "if-match": `"${aliasId}"`,
    },
  });

  assert.deepEqual(readReceiptInboxRotationHeaders(request), {
    expectedAliasId: aliasId,
    idempotencyKey: "receipt-rotate-0001",
  });
});

test("receipt inbox rotation requires a valid idempotency key", () => {
  for (const idempotencyKey of [undefined, "short"]) {
    const headers = new Headers({ "if-match": `"${aliasId}"` });
    if (idempotencyKey !== undefined) headers.set("idempotency-key", idempotencyKey);
    assertInvalidEvidence(new Request(rotateUrl, { method: "POST", headers }));
  }
});

test("receipt inbox rotation rejects a malformed If-Match alias id", () => {
  assertInvalidEvidence(new Request(rotateUrl, {
    method: "POST",
    headers: {
      "idempotency-key": "receipt-rotate-0001",
      "if-match": aliasId,
    },
  }));
});

test("receipt inbox readiness failures use the canonical Recovery error path", async () => {
  const source = await readFile(new URL("../src/lib/server/recovery-inbound-route.ts", import.meta.url), "utf8");
  assert.equal(source.includes("FEATURE_UNAVAILABLE"), true);
  assert.equal(source.includes("Response.json"), false);
  assert.equal(source.includes('status: "not-available"'), false);
});

test("the public Resend route mounts the signed handler with a shared provider limit", async () => {
  const source = await readFile(new URL("../src/app/api/webhooks/resend/inbound/route.ts", import.meta.url), "utf8");
  assert.match(source, /createResendInboundHandler/);
  assert.match(source, /processResendReceivedEvent/);
  assert.match(source, /requireShared: true/);
  assert.match(source, /identity: "provider:resend"/);
  assert.doesNotMatch(source, /rejectCrossSiteMutation/);
});

function assertInvalidEvidence(request: Request) {
  assert.throws(
    () => readReceiptInboxRotationHeaders(request),
    (error: unknown) => error instanceof RecoveryServiceError && error.code === "INVALID_EVIDENCE",
  );
}