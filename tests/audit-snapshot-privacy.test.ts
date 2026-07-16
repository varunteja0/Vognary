import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("snapshot audit metadata excludes financial summaries and user-supplied titles", () => {
  const source = readFileSync(new URL("../src/lib/server/audit-snapshot-store.ts", import.meta.url), "utf8");
  const auditInsert = source.slice(source.indexOf("'workspace_state.saved'"), source.indexOf("await client.query(\"commit\")"));
  assert.match(auditInsert, /revision: nextRevision, materialized/);
  assert.doesNotMatch(auditInsert, /input\.title|input\.summary|monthlyRecurringSpend|annualRecurringSpend/);
});