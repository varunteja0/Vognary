import assert from "node:assert/strict";
import test from "node:test";
import {
  gmailVerificationPendingCode,
  selectReceiptInboxHealthEvent,
} from "../src/lib/recovery/receipt-inbox-health";

test("a Gmail confirmation event is not the health event when a processed receipt already exists", () => {
  const health = selectReceiptInboxHealthEvent([
    { error_code: gmailVerificationPendingCode, status: "TERMINAL_FAILED" },
    { error_code: null, status: "PROCESSED" },
    { error_code: "PARSE_FAILED", status: "TERMINAL_FAILED" },
  ]);
  assert.deepEqual(health, { error_code: null, status: "PROCESSED" });
});

test("a mailbox that has only received Gmail confirmation is waiting, not parse-failed", () => {
  const health = selectReceiptInboxHealthEvent([
    { error_code: gmailVerificationPendingCode, status: "TERMINAL_FAILED" },
  ]);
  assert.equal(health, undefined);
});
