import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { RecoveryMaterializationError, RecoveryServiceError } from "../src/lib/server/recovery-api";
import { materializationFailureCode, retrieveResendRawEmail } from "../src/lib/server/recovery-inbound-processor";

const receiptInboxEnvironment = {
  ENABLE_RECEIPT_INBOX: "true",
  RESEND_RECEIVING_API_KEY: "re_receiving_test",
  RESEND_INBOUND_WEBHOOK_SECRET: "whsec_receiving_test",
  RESEND_RECEIVING_DOMAIN: "receipts.vognary.test",
  RECEIPT_INBOX_ALIAS_HMAC_SECRET: "22".repeat(32),
  RECEIPT_INBOX_ALIAS_HMAC_KEY_ID: "receipt-alias-v1",
  TOKEN_ENCRYPTION_KEY: "11".repeat(32),
} as const;

test("inbound completion and retry updates are fenced by the claimed attempt generation", () => {
  const processor = readFileSync("src/lib/server/recovery-inbound-processor.ts", "utf8");
  const store = readFileSync("src/lib/server/recovery-store.ts", "utf8");
  assert.match(processor, /returning id, workspace_id, attempt_count/);
  assert.match(processor, /status = 'PROCESSING' and attempt_count = \$3/);
  assert.match(store, /eventRow\.status !== "PROCESSING" \|\| eventRow\.attempt_count !== input\.expectedAttemptCount/);
  assert.match(store, /status = 'PROCESSING' and attempt_count = \$6/);
});

test("materialization retry diagnostics expose only a bounded stage and Recovery code", () => {
  const failure = new RecoveryMaterializationError(
    "SOURCE_PERSISTENCE",
    new RecoveryServiceError("SAVE_FAILED", "provider receipt secret"),
  );
  const code = materializationFailureCode(failure);
  assert.equal(code, "MATERIALIZATION_SOURCE_PERSISTENCE_SAVE_FAILED");
  assert.doesNotMatch(code, /provider|receipt|secret/i);
  assert.equal(materializationFailureCode(new Error("provider receipt secret")), "MATERIALIZATION_FAILED");
});

test("Resend retrieval follows the documented raw download contract without forwarding credentials", async () => {
  const restoreEnvironment = setEnvironment(receiptInboxEnvironment);
  const originalFetch = globalThis.fetch;
  const observed: Array<{ url: string; authorization: string | null; redirect: RequestRedirect | undefined }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const authorization = new Headers(init?.headers).get("authorization");
    observed.push({ url, authorization, redirect: init?.redirect });
    if (url.startsWith("https://api.resend.com/emails/receiving/")) {
      return Response.json({
        object: "email",
        id: "email-1",
        raw: {
          download_url: "https://cdn.resend.app/receiving/raw/email-1?Signature=signed",
          expires_at: "2026-08-10T13:00:00.000Z",
        },
      });
    }
    return new Response("From: billing@example.test\r\nContent-Type: text/plain\r\n\r\nOpenAI INR 1,999", {
      headers: { "content-type": "message/rfc822" },
    });
  };

  try {
    const raw = await retrieveResendRawEmail("email-1");
    assert.match(new TextDecoder().decode(raw), /OpenAI INR 1,999/);
    assert.deepEqual(observed, [
      {
        url: "https://api.resend.com/emails/receiving/email-1",
        authorization: "Bearer re_receiving_test",
        redirect: undefined,
      },
      {
        url: "https://cdn.resend.app/receiving/raw/email-1?Signature=signed",
        authorization: null,
        redirect: "error",
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment();
  }
});

test("raw email redirects fail retryably instead of following an unvalidated host", async () => {
  const restoreEnvironment = setEnvironment(receiptInboxEnvironment);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls += 1;
    if (calls === 1) {
      return Response.json({
        raw: { download_url: "https://d111111abcdef8.cloudfront.net/raw/email-2?Signature=signed" },
      });
    }
    assert.equal(init?.redirect, "error");
    return new Response(null, {
      status: 302,
      headers: { location: "https://attacker.example/raw.eml" },
    });
  };

  try {
    await assert.rejects(retrieveResendRawEmail("email-2"), /raw email request failed/i);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment();
  }
});

test("raw email retrieval rejects Resend hostname lookalikes", async () => {
  const restoreEnvironment = setEnvironment(receiptInboxEnvironment);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({
      raw: { download_url: "https://cdn.resend.app.attacker.example/raw/email-2?Signature=signed" },
    });
  };

  try {
    await assert.rejects(retrieveResendRawEmail("email-2"), /raw email is not available yet/i);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment();
  }
});

test("a documented nullable raw field stays retryable instead of becoming terminal", async () => {
  const restoreEnvironment = setEnvironment(receiptInboxEnvironment);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ object: "email", id: "email-3", raw: null });
  try {
    await assert.rejects(retrieveResendRawEmail("email-3"), /raw email is not available yet/i);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment();
  }
});

function setEnvironment(values: Record<string, string>) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}
