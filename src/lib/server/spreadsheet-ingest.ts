import "server-only";

import { read, utils } from "xlsx";

const maxRows = 20_000;
const maxColumns = 100;
const maxCellCharacters = 10_000;

export type SpreadsheetConversion = {
  csv: string;
  sheetName: string;
  rowCount: number;
  warnings: string[];
};

export function convertSpreadsheetToCsv(data: Buffer): SpreadsheetConversion {
  const workbook = read(data, {
    type: "buffer",
    dense: true,
    cellDates: false,
    cellFormula: false,
    sheetRows: maxRows + 1,
  });
  if (!workbook.SheetNames.length) throw new Error("Spreadsheet has no worksheets.");

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
    });
    if (!rows.length) continue;
    if (rows.length > maxRows) throw new Error(`Spreadsheet exceeds the ${maxRows.toLocaleString("en")} row limit.`);

    const normalized = rows.map((row, rowIndex) => {
      if (row.length > maxColumns) throw new Error(`Spreadsheet row ${rowIndex + 1} exceeds the ${maxColumns} column limit.`);
      return row.map((cell) => normalizeCell(cell, rowIndex));
    });
    const csv = utils.sheet_to_csv(utils.aoa_to_sheet(normalized), { blankrows: false });
    return {
      csv,
      sheetName,
      rowCount: Math.max(0, normalized.length - 1),
      warnings: [
        `Imported worksheet “${sheetName}”. Verify date interpretation and debit/credit columns before acting.`,
        ...(workbook.SheetNames.length > 1 ? [`Only the first non-empty worksheet was imported (${workbook.SheetNames.length} found).`] : []),
      ],
    };
  }

  throw new Error("Spreadsheet contains no readable rows.");
}

function normalizeCell(value: unknown, rowIndex: number) {
  const normalized = String(value ?? "").replace(/\u0000/g, "").trim();
  if (normalized.length > maxCellCharacters) {
    throw new Error(`Spreadsheet row ${rowIndex + 1} contains a cell over ${maxCellCharacters.toLocaleString("en")} characters.`);
  }
  return normalized;
}