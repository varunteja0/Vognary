import assert from "node:assert/strict";
import test from "node:test";

import { encodeCsvCell } from "../src/lib/csv";

test("CSV export neutralizes spreadsheet formulas after optional whitespace", () => {
  for (const value of ["=HYPERLINK(\"https://evil.example\")", "+cmd", "-cmd", "@SUM(A1:A2)", "  =1+1", "\t@payload"]) {
    const encoded = encodeCsvCell(value);
    assert.ok(encoded.startsWith("\"'"), value);
  }
  assert.equal(encodeCsvCell("Netflix"), '"Netflix"');
  assert.equal(encodeCsvCell('A "quoted" note'), '"A ""quoted"" note"');
});