import assert from "node:assert/strict";
import test from "node:test";

import {
  formatSecurityInboxSummary,
  summarizeSecurityInbox,
} from "../scripts/lib/security-inbox-report.mjs";

test("security inbox summary filters the public mailbox and emits no message secrets", () => {
  const summary = summarizeSecurityInbox([
    {
      id: "private-provider-id",
      from: "Named Person <person@strobes.co>",
      to: ["security@vognary.com"],
      subject: "Vognary VAPT assessment details",
      created_at: "2026-09-03T10:00:00.000Z",
      text: "private body must never escape",
    },
    {
      id: "unrelated-id",
      from: "other@example.com",
      to: ["elsewhere@vognary.com"],
      subject: "Unrelated",
      created_at: "2026-09-03T11:00:00.000Z",
    },
  ]);

  const reviewRef = summary.messages[0]?.reviewRef;
  assert.match(reviewRef ?? "", /^[a-f0-9]{64}$/);
  assert.deepEqual(summary, {
    inbox: "security-inbox",
    count: 1,
    needsReview: 1,
    latestReceivedAt: "2026-09-03T10:00:00.000Z",
    categories: {
      "assessor-response": 1,
      "automated-confirmation": 0,
      "security-report": 0,
      "synthetic-self-test": 0,
      other: 0,
    },
    messages: [{
      receivedAt: "2026-09-03T10:00:00.000Z",
      senderDomain: "strobes.co",
      category: "assessor-response",
      reviewRef,
      needsReview: true,
    }],
  });

  const output = `${JSON.stringify(summary)}\n${formatSecurityInboxSummary(summary)}`;
  assert.doesNotMatch(output, /Named Person|person@|private-provider-id|private body|Vognary VAPT assessment details|unrelated-id/);
});

test("security inbox summary separates synthetic proof, disclosure mail, and other mail", () => {
  const summary = summarizeSecurityInbox([
    {
      from: "Vognary <no-reply@vognary.com>",
      to: ["security@vognary.com"],
      subject: "Vognary reply-route synthetic test 2026-09-03",
      created_at: "2026-09-03T10:10:46.608Z",
    },
    {
      from: "Researcher <researcher@example.org>",
      to: ["security@vognary.com"],
      subject: "Responsible disclosure: authorization issue",
      created_at: "2026-09-03T10:11:46.608Z",
    },
    {
      from: "Updates <updates@example.net>",
      to: ["security@vognary.com"],
      subject: "Newsletter",
      created_at: "invalid-date",
    },
  ]);

  assert.equal(summary.count, 3);
  assert.equal(summary.needsReview, 1);
  assert.deepEqual(summary.categories, {
    "assessor-response": 0,
    "automated-confirmation": 0,
    "security-report": 1,
    "synthetic-self-test": 1,
    other: 1,
  });
  assert.equal(summary.latestReceivedAt, "2026-09-03T10:11:46.608Z");
  assert.deepEqual(summary.messages.map((message: { senderDomain: string }) => message.senderDomain), [
    "example.org",
    "vognary.com",
    "example.net",
  ]);
});

test("automatic assessor acknowledgements do not inflate the review queue", () => {
  const summary = summarizeSecurityInbox([
    {
      from: "Vendor <automated@sisainfosec.com>",
      to: ["security@vognary.com"],
      subject: "Thank you for your inquiry",
      created_at: "2026-09-01T06:48:15.430Z",
    },
    {
      from: "Vendor <sales@sisainfosec.com>",
      to: ["security@vognary.com"],
      subject: "Vognary requirement",
      created_at: "2026-09-01T12:27:51.115Z",
    },
  ]);

  assert.equal(summary.needsReview, 1);
  assert.deepEqual(summary.categories, {
    "assessor-response": 1,
    "automated-confirmation": 1,
    "security-report": 0,
    "synthetic-self-test": 0,
    other: 0,
  });
  assert.deepEqual(summary.messages.map((message: { category: string }) => message.category), [
    "assessor-response",
    "automated-confirmation",
  ]);
});

test("explicit review refs close handled mail without hiding a later response", () => {
  const handledMessage = {
    id: "handled-provider-id",
    from: "Vendor <sales@strobes.co>",
    to: ["security@vognary.com"],
    subject: "Vognary scope request",
    created_at: "2026-09-03T10:00:00.000Z",
  };
  const initial = summarizeSecurityInbox([handledMessage]);
  const reviewRef = initial.messages[0]?.reviewRef;

  assert.match(reviewRef ?? "", /^[a-f0-9]{64}$/);

  const summary = summarizeSecurityInbox([
    handledMessage,
    {
      ...handledMessage,
      id: "new-provider-id",
      created_at: "2026-09-03T11:00:00.000Z",
    },
  ], { handledReviewRefs: [reviewRef] });

  assert.equal(summary.needsReview, 1);
  assert.deepEqual(summary.messages.map((message: { needsReview: boolean }) => message.needsReview), [
    true,
    false,
  ]);

  const output = `${JSON.stringify(summary)}\n${formatSecurityInboxSummary(summary)}`;
  assert.match(output, new RegExp(`OPEN ${summary.messages[0]?.reviewRef}`));
  assert.match(output, /HANDLED/);
  assert.doesNotMatch(output, /handled-provider-id|new-provider-id/);
});