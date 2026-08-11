import assert from "node:assert/strict";
import test from "node:test";
import { Webhook } from "svix";

import {
  createResendInboundHandler,
  resendInboundWebhookMaxBytes,
  ResendInboundRetryableError,
  type ResendReceivedEvent,
} from "../src/lib/server/recovery-inbound-webhook";

const signingSecret = `whsec_${Buffer.from("receipt-inbox-webhook-test-secret").toString("base64")}`;

const event = {
  type: "email.received",
  created_at: "2026-08-10T12:00:00.000Z",
  data: {
    email_id: "email-1",
    to: ["rcpt_0123456789abcdef0123456789abcdef01234567@receipts.vognary.test"],
    subject: "OpenAI receipt",
  },
};

test("a valid signed Resend event reaches the processor exactly once", async () => {
  const observed: ResendReceivedEvent[] = [];
  const handler = createResendInboundHandler({
    signingSecret,
    processReceived: async (received) => {
      observed.push(received);
      return { status: "processed" };
    },
  });
  const request = signedRequest(event);
  const response = await handler(request);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "processed" });
  assert.equal(observed.length, 1);
  assert.equal(observed[0].emailId, "email-1");
  assert.equal(observed[0].recipient, event.data.to[0]);
  assert.match(observed[0].payloadHash, /^[0-9a-f]{64}$/);
});

test("invalid, missing, and body-mismatched signatures never reach processing", async () => {
  let calls = 0;
  const handler = createResendInboundHandler({
    signingSecret,
    processReceived: async () => {
      calls += 1;
      return { status: "processed" };
    },
  });

  const missing = await handler(new Request("https://vognary.test/api/webhooks/resend/inbound", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  }));
  assert.equal(missing.status, 401);

  const signed = signedRequest(event);
  const mismatched = await handler(new Request(signed.url, {
    method: "POST",
    headers: signed.headers,
    body: `${JSON.stringify(event)} `,
  }));
  assert.equal(mismatched.status, 401);
  assert.equal(calls, 0);
});

test("oversized envelopes fail before signature verification or processing", async () => {
  let calls = 0;
  const handler = createResendInboundHandler({
    signingSecret,
    processReceived: async () => {
      calls += 1;
      return { status: "processed" };
    },
  });
  const response = await handler(new Request("https://vognary.test/api/webhooks/resend/inbound", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(resendInboundWebhookMaxBytes + 1),
    },
    body: "{}",
  }));
  assert.equal(response.status, 413);
  assert.equal(calls, 0);
});

test("signed unrelated events are acknowledged without provider processing", async () => {
  let calls = 0;
  const handler = createResendInboundHandler({
    signingSecret,
    processReceived: async () => {
      calls += 1;
      return { status: "processed" };
    },
  });
  const response = await handler(signedRequest({ ...event, type: "email.delivered" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ignored" });
  assert.equal(calls, 0);
});

test("retryable processing errors return a generic 503 without provider or receipt detail", async () => {
  const handler = createResendInboundHandler({
    signingSecret,
    processReceived: async () => {
      throw new ResendInboundRetryableError("provider API returned secret body");
    },
  });
  const response = await handler(signedRequest(event));
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.deepEqual(payload, { status: "retry" });
  assert.doesNotMatch(JSON.stringify(payload), /provider|secret|OpenAI/i);
});

function signedRequest(payload: object) {
  const raw = JSON.stringify(payload);
  const messageId = `msg_${crypto.randomUUID()}`;
  const timestamp = new Date();
  const signature = new Webhook(signingSecret).sign(messageId, timestamp, raw);
  return new Request("https://vognary.test/api/webhooks/resend/inbound", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": messageId,
      "svix-timestamp": String(Math.floor(timestamp.getTime() / 1_000)),
      "svix-signature": signature,
    },
    body: raw,
  });
}