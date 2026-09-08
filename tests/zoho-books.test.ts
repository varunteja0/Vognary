import assert from "node:assert/strict";
import test from "node:test";
import { billChangeKind, isZohoBooksState, normalizeZohoBill, parseZohoJson } from "../src/lib/zoho-books/contracts";

const bill = {
  bill_id: "100000000001", vendor_id: "200000000001", vendor_name: "Synthetic provider vendor",
  bill_number: "SYNTHETIC-001", status: "open", date: "2026-09-01", currency_code: "INR",
  total: "123.45", balance: "123.45", last_modified_time: "2026-09-01T12:00:00+0530",
};

test("provider bill totals preserve decimal lexemes beyond binary floating point precision", () => {
  const parsed = parseZohoJson('{"total":9007199254740993.01,"balance":0,"code":0}');
  const normalized = normalizeZohoBill({ ...bill, ...parsed });
  assert.equal(normalized.totalMinor, "900719925474099301");
  assert.equal(normalized.balanceMinor, "0");
  assert.equal(normalized.basis, "PROVIDER_BILL_TOTAL");
  assert.equal(normalized.currency, "INR");
});

test("bill normalization rejects missing money, invalid dates, overflow and unknown states", () => {
  for (const patch of [
    { total: null }, { balance: undefined }, { date: "2026-02-30" },
    { total: "92233720368547758.08" }, { total: "-1" }, { total: "1.001" },
    { currency_code: "USDX" }, { vendor_id: "" }, { status: "provider-changed-schema" },
  ]) assert.throws(() => normalizeZohoBill({ ...bill, ...patch }));
});

test("bill changes distinguish new, unchanged, amended and void without claiming a payment", () => {
  const first = normalizeZohoBill(bill);
  assert.equal(billChangeKind(null, first), "NEW");
  assert.equal(billChangeKind(first, { ...first }), null);
  assert.equal(billChangeKind(first, normalizeZohoBill({ ...bill, total: "130.00" })), "AMENDED");
  assert.equal(billChangeKind(first, normalizeZohoBill({ ...bill, status: "void" })), "VOIDED");
  assert.equal(billChangeKind(first, normalizeZohoBill({ ...bill, status: "paid", balance: "0" })), "AMENDED");
});

test("the source response guard refuses malformed financial values before rendering", () => {
  const normalized = normalizeZohoBill(bill);
  const state = {
    configured: true, canManage: true, organizations: [], total: 1, nextCursor: null, throughSequence: "1",
    connection: { id: "11111111-1111-4111-8111-111111111111", revision: "1", status: "READY", organizationId: "100001", organizationName: "Synthetic organization", coverageStart: "2026-06-01", lastSuccessfulSyncAt: "2026-09-06T00:00:00.000Z", nextScheduledAt: "2026-09-07T00:00:00.000Z", failureCode: null, providerRevocation: null },
    items: [{ sequence: "1", bill: normalized, previous: null, changeKind: "BASELINE", observedAt: "2026-09-06T00:00:00.000Z" }],
  };
  assert.equal(isZohoBooksState(state), true);
  assert.equal(isZohoBooksState({ ...state, items: [{ ...state.items[0], bill: { ...normalized, totalMinor: "NaN" } }] }), false);
  assert.equal(isZohoBooksState({ ...state, items: [{ ...state.items[0], previous: { ...normalized, billId: "999999" } }] }), false);
  assert.equal(isZohoBooksState({ ...state, total: null }), false);
  assert.equal(isZohoBooksState({ ...state, connection: { ...state.connection, status: "CONNECTED_WITHOUT_IMPORT" } }), false);
});
