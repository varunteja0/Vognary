import { NextRequest, NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";
import { hasReadablePdfTextLayer } from "@/lib/pdf-ingest";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { redactText } from "@/lib/redaction";
import { describeStatementFormat, detectStatementFormat } from "@/lib/statement-formats";
import { convertPdfStatementTextToCsv } from "@/lib/pdf-statement-text";
import { assertContentLength, assertContentType, RequestBodyTooLargeError, UnsupportedContentTypeError } from "@/lib/server/request-body";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import { convertSpreadsheetToCsv } from "@/lib/server/spreadsheet-ingest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const maxFiles = 6;
const maxFileBytes = 8 * 1024 * 1024;
const maxMultipartBytes = maxFiles * maxFileBytes + 2 * 1024 * 1024;

type IngestedSource = {
  name: string;
  text: string;
  kind: "csv" | "pdf" | "spreadsheet";
  rowCount: number;
  warnings: string[];
  extractedTextPreview?: string;
};

export async function POST(request: NextRequest) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;

  const limit = await rateLimit(request, { namespace: "ingest", limit: 10, windowMs: 5 * 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  let formData: FormData;
  try {
    assertContentType(request, "multipart/form-data");
    assertContentLength(request, maxMultipartBytes);
    formData = await request.formData();
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "Ingestion request is too large." }, { status: 413 });
    }
    if (error instanceof UnsupportedContentTypeError) {
      return NextResponse.json({ error: "Content-Type must be multipart/form-data." }, { status: 415 });
    }
    return NextResponse.json({ error: "Could not read the multipart upload." }, { status: 400 });
  }
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
      const headerRow = text.split(/\r?\n/, 1)[0] ?? "";
      const formatNote = describeStatementFormat(detectStatementFormat(headerRow.split(",")));
      sources.push({
        name: file.name,
        text,
        kind: "csv",
        rowCount: countRows(text),
        warnings: formatNote ? [formatNote] : [],
      });
      continue;
    }

    if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls") || file.type.includes("spreadsheet") || file.type.includes("ms-excel")) {
      try {
        const converted = convertSpreadsheetToCsv(Buffer.from(await file.arrayBuffer()));
        const headerRow = converted.csv.split(/\r?\n/, 1)[0] ?? "";
        const formatNote = describeStatementFormat(detectStatementFormat(headerRow.split(",")));
        sources.push({
          name: file.name.replace(/\.xlsx?$/i, ".converted.csv"),
          text: converted.csv,
          kind: "spreadsheet",
          rowCount: converted.rowCount,
          warnings: [...converted.warnings, ...(formatNote ? [formatNote] : [])],
        });
      } catch (error) {
        return NextResponse.json({
          error: `${file.name} could not be read as a bounded spreadsheet.`,
          code: "spreadsheet_parse_failed",
          message: error instanceof Error ? error.message : "Export this statement as CSV and retry.",
        }, { status: 422 });
      }
      continue;
    }

    if (lowerName.endsWith(".pdf") || file.type === "application/pdf") {
      const buffer = Buffer.from(await file.arrayBuffer());
      const parser = new PDFParse({ data: buffer });
      let parsed;
      try {
        parsed = await parser.getText();
      } finally {
        await parser.destroy();
      }
      if (!hasReadablePdfTextLayer(parsed.text)) {
        return NextResponse.json({
          error: `${file.name} appears to be scanned or image-only and has no readable text layer.`,
          code: "scanned_pdf_no_text_layer",
          message: "Export CSV/XLSX from net banking, or use guided/manual capture. OCR is not performed or claimed by this deployment.",
        }, { status: 422 });
      }
      const converted = convertPdfStatementTextToCsv(parsed.text);
      sources.push({
        name: file.name.replace(/\.pdf$/i, ".converted.csv"),
        text: converted.csv,
        kind: "pdf",
        rowCount: countRows(converted.csv),
        warnings: converted.warnings,
        extractedTextPreview: redactText(parsed.text.replace(/\s+/g, " ").trim().slice(0, 600)).text,
      });
      continue;
    }

    return NextResponse.json({ error: `${file.name} is not supported. Upload CSV, TXT, XLS, XLSX, or a readable PDF.` }, { status: 400 });
  }

  return NextResponse.json({
    mode: "stateless-ingestion-api",
    storage: "none",
    sources,
  });
}

function countRows(text: string): number {
  return Math.max(0, text.split(/\r?\n/).filter((row) => row.trim()).length - 1);
}
