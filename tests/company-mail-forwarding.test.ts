import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  companyMailForwardDestinationHash,
  companyMailForwardSourceHash,
  forwardedSourceHashesForDestination,
  selectCompanyMailForForwarding,
} from "../scripts/lib/company-mail-forwarding.mjs";

test("company mail forwarding selects approved aliases and skips synthetic or unrelated mail", () => {
  const received = [
    {
      id: "security-message",
      to: ["security@vognary.com"],
      subject: "Assessment response",
      created_at: "2026-09-03T10:00:00.000Z",
    },
    {
      id: "synthetic-message",
      to: ["security@vognary.com"],
      subject: "Vognary reply-route synthetic test 2026-09-03",
      created_at: "2026-09-03T10:01:00.000Z",
    },
    {
      id: "unknown-alias-message",
      to: ["anything@vognary.com"],
      subject: "Catch all",
      created_at: "2026-09-03T10:02:00.000Z",
    },
    {
      id: "unrelated-message",
      to: ["security@example.com"],
      subject: "Unrelated",
      created_at: "2026-09-03T10:03:00.000Z",
    },
  ];

  assert.deepEqual(selectCompanyMailForForwarding(received, new Set()), [{
    emailId: "security-message",
    sourceHash: companyMailForwardSourceHash("security-message"),
    alias: "security",
    receivedAt: "2026-09-03T10:00:00.000Z",
  }]);
});

test("company mail forwarding excludes source hashes already delivered", () => {
  const sourceHash = companyMailForwardSourceHash("security-message");
  const selected = selectCompanyMailForForwarding([{
    id: "security-message",
    to: ["security@vognary.com"],
    subject: "Assessment response",
    created_at: "2026-09-03T10:00:00.000Z",
  }], new Set([sourceHash]));

  assert.deepEqual(selected, []);
  assert.match(sourceHash, /^[a-f0-9]{32}$/);
});

test("forwarded source hashes are scoped to the exact destination", () => {
  const sourceHash = companyMailForwardSourceHash("security-message");
  const sent = [{
    to: ["old@example.com"],
    tags: [
      { name: "purpose", value: "company_mail_forward" },
      { name: "source_hash", value: sourceHash },
    ],
  }, {
    to: ["new@example.com"],
    tags: [
      { name: "purpose", value: "company_mail_forward" },
      { name: "source_hash", value: "b".repeat(32) },
    ],
  }];

  assert.deepEqual(
    [...forwardedSourceHashesForDestination(sent, "new@example.com")],
    ["b".repeat(32)],
  );
  assert.match(companyMailForwardDestinationHash("new@example.com"), /^[a-f0-9]{16}$/);
  assert.notEqual(
    companyMailForwardDestinationHash("new@example.com"),
    companyMailForwardDestinationHash("old@example.com"),
  );
});

type ProviderFixture = { body: unknown; status?: number };

const receivedMessage = {
  id: "security-message",
  to: ["security@vognary.com"],
  subject: "Synthetic assessment response",
  created_at: "2026-09-03T10:00:00.000Z",
};

function runForwardingWithHistory(responses: Record<string, ProviderFixture>) {
  return spawnSync(process.execPath, ["--input-type=module"], {
    input: `
      const responses = ${JSON.stringify(responses)};
      globalThis.fetch = async (input, options = {}) => {
        const url = new URL(String(input));
        if (url.origin !== "https://api.resend.com" || (options.method && options.method !== "GET")) {
          throw new Error("Unexpected provider mutation");
        }
        const fixture = responses[url.pathname + url.search];
        if (!fixture) throw new Error("Unexpected provider request");
        return new Response(JSON.stringify(fixture.body), { status: fixture.status ?? 200 });
      };
      await import(${JSON.stringify(new URL("../scripts/forward-company-mail.mjs", import.meta.url).href)});
    `,
    env: {
      ...process.env,
      RESEND_API_KEY: "synthetic-provider-key",
      RESEND_FROM_EMAIL: "sender@example.test",
      COMPANY_MAIL_FORWARD_TO: "founder@example.test",
    },
    encoding: "utf8",
    timeout: 5_000,
  });
}

test("forwarding finds previous copies beyond the first sent-history page", () => {
  const result = runForwardingWithHistory({
    "/emails/receiving?limit=100": { body: { data: [receivedMessage], has_more: false } },
    "/emails?limit=100": { body: { data: [{ id: "recent-unrelated" }], has_more: true } },
    "/emails?limit=100&after=recent-unrelated": {
      body: {
        data: [{ id: "earlier-forward", subject: "Fwd: [security@vognary.com] Synthetic response", to: ["founder@example.test"] }],
        has_more: false,
      },
    },
    "/emails/earlier-forward": {
      body: {
        to: ["founder@example.test"],
        tags: [
          { name: "purpose", value: "company_mail_forward" },
          { name: "source_hash", value: companyMailForwardSourceHash(receivedMessage.id) },
        ],
      },
    },
  });

  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { mode: "dry-run", eligible: 0, previouslyForwarded: 1 });
});

test("forwarding reads received history completely and deduplicates page boundaries", () => {
  const result = runForwardingWithHistory({
    "/emails/receiving?limit=100": { body: { data: [receivedMessage], has_more: true } },
    "/emails/receiving?limit=100&after=security-message": {
      body: { data: [receivedMessage, { ...receivedMessage, id: "older-security-message" }], has_more: false },
    },
    "/emails?limit=100": { body: { data: [], has_more: false } },
  });

  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { mode: "dry-run", eligible: 2, previouslyForwarded: 0 });
});

for (const scenario of [
  { name: "missing pagination metadata", body: { data: [] }, expectedError: /provider-history-invalid/ },
  { name: "missing continuation cursor", body: { data: [], has_more: true }, expectedError: /provider-history-invalid/ },
  { name: "repeated continuation cursor", body: { data: [{ id: "recent-unrelated" }], has_more: true }, expectedError: /provider-history-cursor-repeated/ },
  { name: "failed history request", body: {}, status: 503, expectedError: /provider-503/ },
]) {
  test(`forwarding stops on ${scenario.name} before suggesting a send`, () => {
    const result = runForwardingWithHistory({
      "/emails/receiving?limit=100": { body: { data: [receivedMessage], has_more: false } },
      "/emails?limit=100": { body: { data: [{ id: "recent-unrelated" }], has_more: true } },
      "/emails?limit=100&after=recent-unrelated": scenario,
    });

    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, scenario.expectedError);
    assert.equal(result.stdout, "");
  });
}

test("forwarding stops when complete history exceeds the bounded page budget", () => {
  const responses: Record<string, ProviderFixture> = {
    "/emails/receiving?limit=100": { body: { data: [receivedMessage], has_more: false } },
  };
  for (let page = 0; page < 10; page += 1) {
    const query = page === 0 ? "" : `&after=page-${page - 1}`;
    responses[`/emails?limit=100${query}`] = { body: { data: [{ id: `page-${page}` }], has_more: true } };
  }
  const result = runForwardingWithHistory(responses);

  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /provider-history-limit/);
  assert.equal(result.stdout, "");
});