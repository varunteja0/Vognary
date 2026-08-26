import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGuestProposalDraft,
  controlDraftFromGuestProposal,
  getGuestProposalDraftServerSnapshot,
  guestProposalDraftTtlMs,
  parseGuestProposalDraft,
  subscribeGuestProposalDraft,
} from "../src/lib/guest-proposal-draft";

test("a guest draft is an assumption, not a recorded decision", () => {
  const draft = buildGuestProposalDraft({
    merchant: "OpenAI API",
    amountInr: 1700,
    capInr: 1350,
    action: "APPROVE_WITH_CAP",
    usingExample: false,
    exportedAt: new Date("2026-08-26T12:00:00.000Z"),
  });
  assert.deepEqual(draft, {
    version: 1,
    exportedAt: "2026-08-26T12:00:00.000Z",
    merchant: "OpenAI API",
    amountInr: 1700,
    capInr: 1350,
    action: "APPROVE_WITH_CAP",
    usingExample: false,
  });
});

test("expired or invented drafts do not parse", () => {
  const now = new Date("2026-08-26T12:00:00.000Z");
  const fresh = JSON.stringify(buildGuestProposalDraft({
    merchant: "OpenAI API",
    amountInr: 1700,
    capInr: null,
    action: "APPROVE",
    usingExample: false,
    exportedAt: now,
  }));
  assert.ok(parseGuestProposalDraft(fresh, now));
  assert.equal(parseGuestProposalDraft(fresh, new Date(now.getTime() + guestProposalDraftTtlMs + 1)), null);
  assert.equal(buildGuestProposalDraft({
    merchant: "",
    amountInr: 1700,
    capInr: null,
    action: "APPROVE",
    usingExample: false,
  }), null);
  assert.equal(buildGuestProposalDraft({
    merchant: "OpenAI API",
    amountInr: -12,
    capInr: null,
    action: "APPROVE",
    usingExample: false,
  }), null);
});

test("the Control desk continues a typed guest assumption, never the Cursor example", () => {
  assert.equal(controlDraftFromGuestProposal(null), null);
  assert.equal(controlDraftFromGuestProposal(buildGuestProposalDraft({
    merchant: "Cursor Pro",
    amountInr: 1700,
    capInr: 1350,
    action: "APPROVE_WITH_CAP",
    usingExample: true,
  })), null);
  assert.deepEqual(controlDraftFromGuestProposal(buildGuestProposalDraft({
    merchant: "OpenAI API",
    amountInr: 1700,
    capInr: 1350,
    action: "APPROVE_WITH_CAP",
    usingExample: false,
  })), { merchant: "OpenAI API", amountText: "1700" });
});

test("the server snapshot is empty so /start does not hydrate a fake proposal", () => {
  assert.equal(getGuestProposalDraftServerSnapshot(), null);
});

test("guest draft subscribe returns an unsubscribe function", () => {
  let calls = 0;
  const stop = subscribeGuestProposalDraft(() => {
    calls += 1;
  });
  assert.equal(typeof stop, "function");
  stop();
  assert.equal(calls, 0);
});
