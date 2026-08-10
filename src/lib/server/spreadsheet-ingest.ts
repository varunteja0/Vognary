import "server-only";

import { read, utils } from "xlsx";

const maxRows = 20_000;
const maxColumns = 100;
const maxCellCharacters = 10_000;
const maxArchiveBytes = 8 * 1024 * 1024;
const maxArchiveEntries = 256;
const maxDecompressedBytes = 32 * 1024 * 1024;
const maxEntryExpansionRatio = 100;

export type SpreadsheetConversion = {
  csv: string;
  sheetName: string;
  rowCount: number;
  warnings: string[];
};

export function convertSpreadsheetToCsv(data: Buffer): SpreadsheetConversion {
  assertSpreadsheetArchiveWithinLimits(data);
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

export function assertSpreadsheetArchiveWithinLimits(data: Buffer) {
  if (data.byteLength > maxArchiveBytes) throw new Error("Spreadsheet exceeds the compressed byte limit.");
  if (data.length < 4 || data.readUInt32LE(0) !== 0x04034b50) return;

  const minimumEocdBytes = 22;
  const searchStart = Math.max(0, data.length - 65_557);
  let eocd = -1;
  for (let offset = data.length - minimumEocdBytes; offset >= searchStart; offset -= 1) {
    if (data.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("Spreadsheet archive has no bounded central directory.");

  const entries = data.readUInt16LE(eocd + 10);
  const centralSize = data.readUInt32LE(eocd + 12);
  let offset = data.readUInt32LE(eocd + 16);
  if (entries > maxArchiveEntries) throw new Error("Spreadsheet archive exceeds the entry limit.");
  if (offset + centralSize > eocd) throw new Error("Spreadsheet archive central directory is invalid.");

  let totalCompressed = 0;
  let totalUncompressed = 0;
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > data.length || data.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Spreadsheet archive central directory is invalid.");
    }
    const flags = data.readUInt16LE(offset + 8);
    const compressed = data.readUInt32LE(offset + 20);
    const uncompressed = data.readUInt32LE(offset + 24);
    if (flags & 0x1) throw new Error("Encrypted spreadsheet archives are not supported.");
    if (compressed === 0xffffffff || uncompressed === 0xffffffff) throw new Error("ZIP64 spreadsheet archives are not supported.");
    if (uncompressed > maxDecompressedBytes || uncompressed / Math.max(1, compressed) > maxEntryExpansionRatio) {
      throw new Error("Spreadsheet archive exceeds the decompressed expansion limit.");
    }
    totalCompressed += compressed;
    totalUncompressed += uncompressed;
    if (totalUncompressed > maxDecompressedBytes || totalUncompressed / Math.max(1, totalCompressed) > maxEntryExpansionRatio) {
      throw new Error("Spreadsheet archive exceeds the decompressed expansion limit.");
    }
    offset += 46 + data.readUInt16LE(offset + 28) + data.readUInt16LE(offset + 30) + data.readUInt16LE(offset + 32);
  }
}

function normalizeCell(value: unknown, rowIndex: number) {
  const normalized = String(value ?? "").replace(/\u0000/g, "").trim();
  if (normalized.length > maxCellCharacters) {
    throw new Error(`Spreadsheet row ${rowIndex + 1} contains a cell over ${maxCellCharacters.toLocaleString("en")} characters.`);
  }
  return normalized;
}