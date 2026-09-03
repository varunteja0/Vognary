import assert from "node:assert/strict";
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