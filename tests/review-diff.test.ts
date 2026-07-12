import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeStatements } from "../src/lib/recurring-audit";
import { buildReviewSnapshot, diffReviews, isReviewSnapshot } from "../src/lib/review-diff";

const today = new Date(2026, 6, 10); // 2026-07-10

function csv(rows: string[]): string {
  return ["Date,Description,Debit,Credit", ...rows].join("\n");
}

const juneCsv = csv([
  "2026-04-06,OPENAI CHATGPT PLUS,1999,",
  "2026-05-06,OPENAI CHATGPT PLUS,1999,",
  "2026-06-06,OPENAI CHATGPT PLUS,1999,",
  "2026-04-05,NETFLIX PREMIUM,649,",
  "2026-05-05,NETFLIX PREMIUM,649,",
]);

// July: Netflix gone, Spotify appeared, OpenAI price effectively higher.
const julyCsv = csv([
  "2026-05-06,OPENAI CHATGPT PLUS,1999,",
  "2026-06-06,OPENAI CHATGPT PLUS,2399,",
  "2026-07-06,OPENAI CHATGPT PLUS,2399,",
  "2026-06-02,SPOTIFY PREMIUM,119,",
  "2026-07-02,SPOTIFY PREMIUM,119,",
]);

test("diff detects added, removed, and price-changed commitments", () => {
  const juneAudit = analyzeStatements([{ name: "june.csv", text: juneCsv }], [], { today: new Date(2026, 5, 10) });
  const julyAudit = analyzeStatements([{ name: "july.csv", text: julyCsv }], [], { today });

  const previous = buildReviewSnapshot(juneAudit, {}, 55, "2026-06-10T00:00:00.000Z");
  const current = buildReviewSnapshot(julyAudit, {}, 70, "2026-07-10T00:00:00.000Z");
  const diff = diffReviews(previous, current);

  assert.equal(diff.daysSincePrevious, 30);
  assert.ok(diff.hasChanges);
  assert.ok(diff.added.some((item) => item.merchant === "Spotify"));
  assert.ok(diff.removed.some((item) => item.merchant === "Netflix"));

  const openaiChange = diff.priceChanges.find((change) => change.merchant === "OpenAI");
  assert.ok(openaiChange, "OpenAI average moved enough to register");
  assert.equal(openaiChange?.direction, "increase");
  assert.equal(openaiChange?.currency, "INR");
  assert.equal(diff.coverageDelta, 15);
});

test("identical snapshots report no changes", () => {
  const audit = analyzeStatements([{ name: "july.csv", text: julyCsv }], [], { today });
  const snapshot = buildReviewSnapshot(audit, {}, 70, "2026-07-10T00:00:00.000Z");
  const diff = diffReviews(snapshot, snapshot);

  assert.equal(diff.hasChanges, false);
  assert.equal(diff.added.length, 0);
  assert.equal(diff.removed.length, 0);
  assert.equal(diff.priceChanges.length, 0);
});

test("isReviewSnapshot guards malformed storage", () => {
  assert.equal(isReviewSnapshot(null), false);
  assert.equal(isReviewSnapshot({ version: 2 }), false);
  const audit = analyzeStatements([{ name: "july.csv", text: julyCsv }], [], { today });
  assert.equal(isReviewSnapshot(buildReviewSnapshot(audit, {}, 70)), true);
});
