import assert from "node:assert/strict";
import test from "node:test";
import { utils, write } from "xlsx";

import { assertPdfTextWithinLimits, hasReadablePdfTextLayer } from "../src/lib/pdf-ingest";
import { assertSpreadsheetArchiveWithinLimits, convertSpreadsheetToCsv } from "../src/lib/server/spreadsheet-ingest";

const rows = [
  ["Date", "Description", "Debit", "Credit"],
  ["2026-01-01", "OPENAI CHATGPT", 1999, ""],
  ["2026-02-01", "OPENAI CHATGPT", 1999, ""],
];

for (const bookType of ["xlsx", "biff8"] as const) {
  test(`converts bounded ${bookType === "biff8" ? "XLS" : "XLSX"} statements to canonical CSV`, () => {
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, utils.aoa_to_sheet(rows), "Statement");
    const data = write(workbook, { type: "buffer", bookType });
    const converted = convertSpreadsheetToCsv(Buffer.from(data));

    assert.equal(converted.sheetName, "Statement");
    assert.equal(converted.rowCount, 2);
    assert.match(converted.csv, /Date,Description,Debit,Credit/);
    assert.match(converted.csv, /OPENAI CHATGPT,1999/);
  });
}

test("image-only PDF text is rejected while readable statement text is accepted", () => {
  assert.equal(hasReadablePdfTextLayer("Scanned with a phone"), false);
  assert.equal(hasReadablePdfTextLayer("Date Description Debit Credit 2026-01-01 OPENAI CHATGPT INR 1999 recurring payment"), true);
});

test("spreadsheet and PDF expansion ceilings reject resource-amplification inputs", () => {
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, utils.aoa_to_sheet(rows), "Statement");
  const archive = Buffer.from(write(workbook, { type: "buffer", bookType: "xlsx" }));
  assert.doesNotThrow(() => assertSpreadsheetArchiveWithinLimits(archive));

  const malicious = Buffer.from(archive);
  const centralHeader = malicious.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.ok(centralHeader >= 0);
  malicious.writeUInt32LE(64 * 1024 * 1024, centralHeader + 24);
  assert.throws(() => assertSpreadsheetArchiveWithinLimits(malicious), /decompressed|expansion/i);

  assert.doesNotThrow(() => assertPdfTextWithinLimits({ total: 50, text: "x".repeat(2_000_000) }));
  assert.throws(() => assertPdfTextWithinLimits({ total: 51, text: "statement" }), /page limit/i);
  assert.throws(() => assertPdfTextWithinLimits({ total: 1, text: "x".repeat(2_000_001) }), /text limit/i);
});