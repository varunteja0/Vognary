import { parseLooseCalendarDate, resolveNumericDateOrder, type NumericDateOrder } from "./loose-date";

type PdfTransaction = {
  date: string;
  description: string;
  debit: string;
  credit: string;
};

type ParsedLine =
  | { transaction: PdfTransaction; failure: null }
  | { transaction: null; failure: "ambiguous-date" | "invalid-date" | "multiple-amounts" | null };

const datePattern = /\b(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\b/;
const amountPattern = /(?:(INR|Rs\.?|₹)\s*)?([+-]?\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?|[+-]?\d+(?:\.\d{1,2})?)\s*(CR|DR|Debit|Credit)?\b/gi;

export function convertPdfStatementTextToCsv(text: string): { csv: string; warnings: string[] } {
  const warnings: string[] = [];
  const rows = ["Date,Description,Debit,Credit"];
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const dateValues = lines
    .map((line) => line.match(datePattern)?.[1] ?? null)
    .filter((value): value is string => Boolean(value));
  const resolution = resolveNumericDateOrder(dateValues);
  let ambiguousDateRows = 0;
  let invalidDateRows = 0;
  let multipleAmountRows = 0;

  for (const line of lines) {
    const parsed = parsePdfTransactionLine(line, resolution.order);
    if (parsed.transaction) {
      rows.push(`${parsed.transaction.date},"${parsed.transaction.description.replace(/"/g, '""')}",${parsed.transaction.debit},${parsed.transaction.credit}`);
    } else if (parsed.failure === "ambiguous-date") {
      ambiguousDateRows += 1;
    } else if (parsed.failure === "invalid-date") {
      invalidDateRows += 1;
    } else if (parsed.failure === "multiple-amounts") {
      multipleAmountRows += 1;
    }
  }

  if (resolution.status === "conflicting") {
    warnings.push("The PDF contains conflicting day-first and month-first numeric date orders. Ambiguous rows were skipped.");
  }
  if (ambiguousDateRows) {
    warnings.push(`Skipped ${ambiguousDateRows} PDF row${ambiguousDateRows === 1 ? "" : "s"} with ambiguous numeric dates because the source did not establish one date order.`);
  }
  if (invalidDateRows) {
    warnings.push(`Skipped ${invalidDateRows} PDF row${invalidDateRows === 1 ? "" : "s"} with an invalid calendar date.`);
  }
  if (multipleAmountRows) {
    warnings.push(`Skipped ${multipleAmountRows} PDF row${multipleAmountRows === 1 ? "" : "s"} with multiple unmarked amounts because the transaction amount could not be distinguished from a balance.`);
  }

  if (rows.length === 1) {
    warnings.push("PDF text was extracted, but no transaction rows matched the parser. Export structured statement data from the provider if possible.");
  } else {
    warnings.push("PDF rows were converted using a conservative text heuristic. Verify evidence before acting on recommendations.");
  }

  return { csv: rows.join("\n"), warnings };
}

function parsePdfTransactionLine(line: string, numericOrder: NumericDateOrder | null): ParsedLine {
  const dateMatch = line.match(datePattern);
  if (!dateMatch) return { transaction: null, failure: null };

  const tailStart = (dateMatch.index ?? 0) + dateMatch[1].length;
  const tail = line.slice(tailStart);
  const amountMatches = [...tail.matchAll(amountPattern)];
  const markedAmounts = amountMatches.filter((match) => Boolean(match[3]));
  const amountMatch = markedAmounts.length === 1 && markedAmounts[0] === amountMatches[0]
    ? markedAmounts[0]
    : markedAmounts.length === 0 && amountMatches.length === 1
      ? amountMatches[0]
      : null;
  if (!amountMatch) {
    return { transaction: null, failure: amountMatches.length > 1 ? "multiple-amounts" : null };
  }

  const description = tail
    .slice(0, amountMatch.index ?? tail.length)
    .replace(/\b(INR|Rs\.?)\b|₹/gi, "")
    .trim();
  const amount = amountMatch[2].replace(/,/g, "");
  if (!description || Number.isNaN(Number.parseFloat(amount))) return { transaction: null, failure: null };

  const date = parseLooseCalendarDate(dateMatch[1], numericOrder);
  if (!date) {
    const rowResolution = resolveNumericDateOrder([dateMatch[1]]);
    return {
      transaction: null,
      failure: rowResolution.status === "ambiguous" ? "ambiguous-date" : "invalid-date",
    };
  }

  const directionMarker = amountMatch[3]?.toLowerCase();
  const creditLike = directionMarker
    ? directionMarker === "cr" || directionMarker === "credit"
    : /\b(salary|refund|cashback|interest|deposit)\b/i.test(description);
  return {
    transaction: {
      date,
      description,
      debit: creditLike ? "" : amount,
      credit: creditLike ? amount : "",
    },
    failure: null,
  };
}
