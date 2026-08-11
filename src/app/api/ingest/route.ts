import { NextRequest, NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";
import { allowsAiPdfAssist } from "@/lib/ingest-mode";
import { assertPdfTextWithinLimits, hasReadablePdfTextLayer, maxPdfPages } from "@/lib/pdf-ingest";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { redactText } from "@/lib/redaction";
import { describeStatementFormat, detectStatementFormat } from "@/lib/statement-formats";
import { convertPdfStatementTextToCsv } from "@/lib/pdf-statement-text";
import { assertContentType, readLimitedBytes, RequestBodyTooLargeError, UnsupportedContentTypeError } from "@/lib/server/request-body";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import { convertSpreadsheetToCsv } from "@/lib/server/spreadsheet-ingest";
import { getAiClient } from "@/lib/server/ai/client";
import { extractLineItems } from "@/lib/server/ai/extract";
import { readAiBudgetFromEnv, isAiBudgetOpen } from "@/lib/server/ai/budget-env";

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
    const body = await readLimitedBytes(request, maxMultipartBytes);
    formData = await new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: Buffer.from(body),
    }).formData();
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
  const ingestMode = formData.get("mode");

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
        parsed = await parser.getText({ first: maxPdfPages });
        assertPdfTextWithinLimits(parsed);
      } catch (error) {
        return NextResponse.json({
          error: `${file.name} exceeds the bounded PDF parser limits or could not be read safely.`,
          code: "pdf_resource_limit",
          message: error instanceof Error ? error.message : "Export this statement as CSV and retry.",
        }, { status: 422 });
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
      let csv = converted.csv;
      let rowCount = countRows(csv);
      const warnings = [...converted.warnings];

      // When the deterministic PDF table converter finds no debit rows but the
      // document has a readable text layer, optionally ask the AI extractor.
      // Results are confidence-capped via warnings; reconcile fails closed on
      // totals. Without a key or open budget this path is a no-op.
      if (rowCount === 0 && allowsAiPdfAssist(ingestMode)) {
        const aiAssist = await tryAiPdfAssist(parsed.text);
        if (aiAssist) {
          csv = aiAssist.csv;
          rowCount = aiAssist.rowCount;
          warnings.push(...aiAssist.warnings);
        }
      }
      if (rowCount === 0 && !allowsAiPdfAssist(ingestMode)) {
        return NextResponse.json({
          error: `${file.name} did not contain deterministic statement rows Recovery can persist.`,
          code: "recovery_deterministic_rows_required",
          message: "Export CSV/XLSX from the source, or paste a receipt. Recovery v1 never promotes AI-extracted rows into deterministic evidence.",
        }, { status: 422 });
      }

      sources.push({
        name: file.name.replace(/\.pdf$/i, ".converted.csv"),
        text: csv,
        kind: "pdf",
        rowCount,
        warnings,
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

/**
 * Optional AI assist for PDFs the table converter cannot row-split.
 * Never invents totals: extraction must reconcile against a document total
 * when one can be guessed from "Total" lines; otherwise lines enter as
 * needs-review warnings only and confidence stays capped by the UI.
 */
async function tryAiPdfAssist(documentText: string): Promise<{ csv: string; rowCount: number; warnings: string[] } | null> {
  const budget = readAiBudgetFromEnv();
  if (!isAiBudgetOpen(budget)) return null;
  const client = getAiClient();
  if (!client) return null;

  const expectedTotal = guessDocumentTotal(documentText);
  if (expectedTotal === null) {
    return {
      csv: "Date,Description,Debit,Credit\n",
      rowCount: 0,
      warnings: ["AI assist skipped: no document total found to reconcile against (cite-or-shut-up)."],
    };
  }

  const outcome = await extractLineItems(documentText.slice(0, 24_000), expectedTotal, { client, budget });
  if (outcome.status === "disabled" || outcome.status === "budget-exceeded" || outcome.status === "error") {
    return {
      csv: "Date,Description,Debit,Credit\n",
      rowCount: 0,
      warnings: [
        outcome.status === "budget-exceeded"
          ? "AI assist skipped: monthly AI budget exhausted; deterministic path only."
          : outcome.status === "error"
            ? `AI assist failed (${outcome.reason}); deterministic path only.`
            : "AI assist unavailable.",
      ],
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  const rows = ["Date,Description,Debit,Credit"];
  for (const line of outcome.lines) {
    if (!Number.isFinite(line.amount) || line.amount <= 0) continue;
    const desc = line.description.replace(/"/g, '""').slice(0, 240);
    rows.push(`${today},"${desc}",${line.amount.toFixed(2)},`);
  }
  const rowCount = Math.max(0, rows.length - 1);
  const warnings = [
    outcome.status === "accepted"
      ? "AI extraction assist accepted after total reconciliation; treat as evidence-only until corroborated."
      : "AI extraction assist needs human review (totals did not fully reconcile); confidence capped.",
  ];
  return { csv: `${rows.join("\n")}\n`, rowCount, warnings };
}

function guessDocumentTotal(text: string): number | null {
  const patterns = [
    /(?:grand\s+)?total\s*(?:amount)?\s*[:\-]?\s*(?:INR|Rs\.?|₹)?\s*([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?)/i,
    /amount\s+due\s*[:\-]?\s*(?:INR|Rs\.?|₹)?\s*([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const value = Number(match[1].replace(/,/g, ""));
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}
