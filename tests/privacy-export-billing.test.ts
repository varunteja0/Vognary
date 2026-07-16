import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("privacy export projects assisted-audit orders, refunds, and offer identity", () => {
  const types = readFileSync("src/lib/privacy-lifecycle.ts", "utf8");
  const store = readFileSync("src/lib/server/privacy-lifecycle-store.ts", "utf8");
  for (const collection of ["assistedAuditOrders", "billingRefunds"]) {
    assert.match(types, new RegExp(`${collection}: Array`));
    assert.match(store, new RegExp(`${collection}:`));
    assert.match(store, new RegExp(`exportRowLimits\\.${collection}`));
  }
  assert.match(store, /offerId: row\.offer_id/);
  assert.match(store, /offerVersion: row\.offer_version/);
  assert.match(store, /termsVersion: row\.terms_version/);
  assert.match(store, /join billing_checkout_sessions checkout on checkout\.id = refund\.checkout_session_id[\s\S]*where checkout\.workspace_id = \$1/);
});