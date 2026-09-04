import assert from "node:assert/strict";
import test from "node:test";

import {
  buildControlAttentionEmail,
  checkControlAttentionEmailConfiguration,
  controlAttentionResendTag,
  hasControlAttentionTag,
} from "../src/lib/server/commitment-control-attention-mailer";
import { deliverClaimedControlAttentionNotification } from "../src/lib/server/commitment-control-attention-delivery";
import { refreshControlAttentionAfterMutation } from "../src/lib/server/commitment-control-attention-trigger";

const item = {
  id: "DECISION_REQUIRED:a1000000-0000-4000-8000-000000000001",
  kind: "DECISION_REQUIRED" as const,
  proposalId: "a1000000-0000-4000-8000-000000000001",
  merchant: "Synthetic <script>alert('x')</script> vendor",
  headline: "Decision needed",
  body: "Review the cited exposure and policy result before the first charge.",
  urgency: "NOW" as const,
  nextStep: "DECIDE_PROPOSAL" as const,
  dueOn: "2026-09-10",
};

test("Control attention email minimizes the subject and escapes user-entered text", () => {
  const message = buildControlAttentionEmail({
    item,
    appBaseUrl: "https://vognary.example/path?ignored=true",
  });

  assert.equal(message.subject, "Decision needed in Vognary");
  assert.doesNotMatch(message.subject, /Synthetic|amount|INR|₹/i);
  assert.match(message.text, /Synthetic <script>alert\('x'\)<\/script> vendor/);
  assert.match(message.text, /Vognary does not approve, purchase, provision, cancel, or move money/);
  assert.match(message.text, /https:\/\/vognary\.example\/app\?view=CONTROL&proposal=a1000000/);
  assert.doesNotMatch(message.html, /<script>/i);
  assert.match(message.html, /&lt;script&gt;alert\(&#39;x&#39;\)&lt;\/script&gt;/);

  const evidenceMessage = buildControlAttentionEmail({
    item: {
      ...item,
      id: `EVIDENCE_DUE:${item.proposalId}`,
      kind: "EVIDENCE_DUE",
      headline: "Evidence needs linking",
      body: "The first charge date has arrived, but no receipt is linked.",
      nextStep: "LINK_EVIDENCE",
    },
    appBaseUrl: "https://vognary.example",
  });
  assert.equal(evidenceMessage.subject, "Evidence review needed in Vognary");

  const outcomeMessage = buildControlAttentionEmail({
    item: {
      ...item,
      id: `OUTCOME_REVIEW_DUE:${item.proposalId}`,
      kind: "OUTCOME_REVIEW_DUE",
      headline: "Outcome review is due",
      body: "No outcome observation is recorded.",
      nextStep: "RECORD_OUTCOME",
    },
    appBaseUrl: "https://vognary.example",
  });
  assert.equal(outcomeMessage.subject, "Outcome review needed in Vognary");
});

test("Control attention provider events are identified only by a constant non-PII tag", () => {
  assert.deepEqual(controlAttentionResendTag, { name: "vognary", value: "control-attention" });
  assert.equal(hasControlAttentionTag([controlAttentionResendTag]), true);
  assert.equal(hasControlAttentionTag({ vognary: "control-attention" }), true);
  assert.equal(hasControlAttentionTag([{ name: "workspace", value: item.proposalId }]), false);
});

test("automated tests cannot activate the real provider without the explicit adapter", () => {
  const previous = {
    adapter: process.env.CONTROL_ATTENTION_TEST_ADAPTER,
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.RESEND_FROM_EMAIL,
    app: process.env.NEXT_PUBLIC_APP_URL,
    webhook: process.env.RESEND_NOTICE_WEBHOOK_SECRET,
  };
  try {
    delete process.env.CONTROL_ATTENTION_TEST_ADAPTER;
    process.env.RESEND_API_KEY = "synthetic-key";
    process.env.RESEND_FROM_EMAIL = "notices@example.test";
    process.env.NEXT_PUBLIC_APP_URL = "https://vognary.example";
    process.env.RESEND_NOTICE_WEBHOOK_SECRET = "synthetic-webhook";
    assert.deepEqual(checkControlAttentionEmailConfiguration(), {
      status: "not-configured",
      missing: ["CONTROL_ATTENTION_TEST_ADAPTER"],
    });

    process.env.CONTROL_ATTENTION_TEST_ADAPTER = "true";
    assert.deepEqual(checkControlAttentionEmailConfiguration(), { status: "ready", missing: [] });
  } finally {
    restore("CONTROL_ATTENTION_TEST_ADAPTER", previous.adapter);
    restore("RESEND_API_KEY", previous.apiKey);
    restore("RESEND_FROM_EMAIL", previous.from);
    restore("NEXT_PUBLIC_APP_URL", previous.app);
    restore("RESEND_NOTICE_WEBHOOK_SECRET", previous.webhook);
  }
});

test("an accepted email whose persistence fails does not consume the send retry budget", async () => {
  let failureTransitions = 0;
  const outcome = await deliverClaimedControlAttentionNotification({
    id: "n1000000-0000-4000-8000-000000000001",
    workspaceId: "w1000000-0000-4000-8000-000000000001",
    proposalId: item.proposalId,
    recipientUserId: "b1000000-0000-4000-8000-000000000001",
    recipientEmail: "synthetic@example.test",
    attentionKind: item.kind,
    dueOn: item.dueOn,
    targetKind: null,
    targetId: null,
    attempt: 1,
    item,
  }, new Date("2026-09-04T00:00:00.000Z"), {
    send: async () => ({ providerMessageId: "provider-message-1" }),
    accept: async () => { throw new Error("synthetic persistence outage"); },
    fail: async () => {
      failureTransitions += 1;
      return { id: "n1000000-0000-4000-8000-000000000001", state: "RETRY_SCHEDULED", nextAttemptAt: null };
    },
  });

  assert.equal(outcome, "persistenceFailed");
  assert.equal(failureTransitions, 0, "provider acceptance is not a send failure");
});

test("a committed write reports when immediate attention projection needs a worker retry", async () => {
  let reportedFailures = 0;
  const status = await refreshControlAttentionAfterMutation({
    workspaceId: "w1000000-0000-4000-8000-000000000001",
    requestId: "request-attention-retry",
    routePath: "/api/workspaces/current/control/proposals",
  }, {
    schedule: async () => { throw new Error("synthetic scheduler outage"); },
    reportFailure: async () => { reportedFailures += 1; },
  });

  assert.equal(status, "pending-worker-retry");
  assert.equal(reportedFailures, 1);
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}