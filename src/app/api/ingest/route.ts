import { NextRequest, NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const maxFiles = 6;
const maxFileBytes = 8 * 1024 * 1024;

type IngestedSource = {
  name: string;
  text: string;
  kind: "csv" | "pdf";
  rowCount: number;
  warnings: string[];
  extractedTextPreview?: string;
};

export async function POST(request: NextRequest) {
  const limit = rateLimit(request, { namespace: "ingest", limit: 10, windowMs: 5 * 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const formData = await request.formData();
  const files = formData.getAll("files").filter((value): value is File => value instanceof File);

  if (!files.length) {
    return NextResponse.json({ error: "Attach at least one statement export or PDF file as files." }, { status: 400 });
  }

  if (files.length > maxFiles) {
    return NextResponse.json({ error: `Maximum ${maxFiles} files are allowed per ingestion request.` }, { status: 413 });
  }

  const sources: IngestedSource[] = [];

  for (const file of files) {
    if (file.size > maxFileBytes) {
      return NextResponse.json({ error: `${file.name} is too large. Keep files below 8 MB for stateless ingestion.` }, { status: 413 });
    }

    const lowerName = file.name.toLowerCase();

    if (lowerName.endsWith(".csv") || file.type.includes("csv") || file.type.includes("text")) {
      const text = await file.text();
      sources.push({
        name: file.name,
        text,
        kind: "csv",
        rowCount: countRows(text),
        warnings: [],
      });
      continue;
    }

    if (lowerName.endsWith(".pdf") || file.type === "application/pdf") {
      const buffer = Buffer.from(await file.arrayBuffer());
      const parser = new PDFParse({ data: buffer });
      const parsed = await parser.getText();
      await parser.destroy();
      const converted = convertPdfTextToCsv(parsed.text);
      sources.push({
        name: file.name.replace(/\.pdf$/i, ".converted.csv"),
        text: converted.csv,
        kind: "pdf",
        rowCount: countRows(converted.csv),
        warnings: converted.warnings,
        extractedTextPreview: parsed.text.replace(/\s+/g, " ").trim().slice(0, 600),
      });
      continue;
    }

    return NextResponse.json({ error: `${file.name} is not supported. Upload a supported statement export or PDF file.` }, { status: 400 });
  }

  return NextResponse.json({
    mode: "stateless-ingestion-api",
    storage: "none",
    sources,
  });
}

function convertPdfTextToCsv(text: string): { csv: string; warnings: string[] } {
  const warnings: string[] = [];
  const rows = ["Date,Description,Debit,Credit"];
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  for (const line of lines) {
    const transaction = parseLooseTransactionLine(line);
    if (!transaction) continue;
    rows.push(`${transaction.date},"${transaction.description.replace(/"/g, '""')}",${transaction.debit},${transaction.credit}`);
  }

  if (rows.length === 1) {
    warnings.push("PDF text was extracted, but no transaction rows matched the parser. Export structured statement data from the provider if possible.");
  } else {
    warnings.push("PDF rows were converted using a conservative text heuristic. Verify evidence before acting on recommendations.");
  }

  return { csv: rows.join("\n"), warnings };
}

function parseLooseTransactionLine(line: string): { date: string; description: string; debit: string; credit: string } | null {
  const dateMatch = line.match(/\b(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\b/);
  if (!dateMatch) return null;

  const amountMatches = [...line.matchAll(/(?:INR|Rs\.?|₹)?\s*([+-]?\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?|[+-]?\d+(?:\.\d{1,2})?)\s*(CR|DR|Debit|Credit)?\b/gi)];
  const amountMatch = amountMatches.at(-1);
  if (!amountMatch) return null;

  const amount = amountMatch[1].replace(/,/g, "");
  const amountIndex = amountMatch.index ?? line.length;
  const date = normalizeDate(dateMatch[1]);
  const description = line
    .slice((dateMatch.index ?? 0) + dateMatch[1].length, amountIndex)
    .replace(/\b(INR|Rs\.?|₹)\b/gi, "")
    .trim();

  if (!date || !description || Number.isNaN(Number.parseFloat(amount))) return null;

  const marker = `${amountMatch[2] ?? ""} ${line}`;
  const creditLike = /\b(CR|Credit|salary|refund|cashback|interest|deposit)\b/i.test(marker);
  const debit = creditLike ? "" : amount;
  const credit = creditLike ? amount : "";

  return { date, description, debit, credit };
}

function normalizeDate(value: string): string | null {
  const nativeDate = new Date(value);
  if (!Number.isNaN(nativeDate.getTime())) return formatDate(nativeDate);

  const match = value.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (!match) return null;

  const first = Number.parseInt(match[1], 10);
  const second = Number.parseInt(match[2], 10);
  const year = Number.parseInt(match[3].length === 2 ? `20${match[3]}` : match[3], 10);
  const day = first > 12 ? first : second > 12 ? second : first;
  const month = first > 12 ? second : second > 12 ? first : second;
  return formatDate(new Date(year, month - 1, day));
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function countRows(text: string): number {
  return Math.max(0, text.split(/\r?\n/).filter((row) => row.trim()).length - 1);
}