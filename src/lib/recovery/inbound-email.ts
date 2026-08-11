import { createHash } from "node:crypto";
import { htmlToText } from "html-to-text";
import PostalMime from "postal-mime";
import "pdf-parse/worker";
import { PDFParse } from "pdf-parse";
import { assertPdfTextWithinLimits, hasReadablePdfTextLayer, maxPdfPages } from "@/lib/pdf-ingest";
import { recoveryLimits } from "@/lib/recovery/contracts";

export const forwardedEmailMaxMimeBytes = 8 * 1024 * 1024;
const maxNestedEmailDepth = 2;
const maxHeadersBytes = 128 * 1024;
const maxPdfAttachments = 3;
const maxPdfAttachmentBytes = 4 * 1024 * 1024;

type ForwardedReceiptText = {
  clientRef: string;
  text: string;
};

export type ForwardedEmailExtraction = {
  texts: ForwardedReceiptText[];
  skippedAttachments: string[];
};

export async function extractForwardedReceiptTexts(raw: string | Uint8Array): Promise<ForwardedEmailExtraction> {
  if (byteLength(raw) > forwardedEmailMaxMimeBytes) throw new Error("Forwarded email is too large to process.");
  const extraction: ForwardedEmailExtraction = { texts: [], skippedAttachments: [] };
  await extractMime(raw, 0, extraction, new Set(), { pdfs: 0 });
  return extraction;
}

async function extractMime(
  raw: string | Uint8Array,
  depth: number,
  extraction: ForwardedEmailExtraction,
  seen: Set<string>,
  budget: { pdfs: number },
) {
  if (depth > maxNestedEmailDepth || extraction.texts.length >= recoveryLimits.maxReceiptSnippets) return;
  if (byteLength(raw) > forwardedEmailMaxMimeBytes) throw new Error("Forwarded email is too large to process.");

  const parsed = await PostalMime.parse(raw, {
    rfc822Attachments: true,
    attachmentEncoding: "arraybuffer",
    maxHeadersSize: maxHeadersBytes,
    maxNestingDepth: 20,
    maxRfc822NestingDepth: maxNestedEmailDepth,
  });
  const plainText = parsed.text?.replace(/\r\n?/g, "\n").trim()
    || htmlReceiptText(parsed.html ?? "");
  if (plainText) addText(plainText, depth, extraction, seen);

  for (const attachment of parsed.attachments) {
    if (extraction.texts.length >= recoveryLimits.maxReceiptSnippets) break;
    const mimeType = attachment.mimeType.toLowerCase();

    if (mimeType === "message/rfc822") {
      if (depth >= maxNestedEmailDepth) recordSkipped(extraction, mimeType);
      else await extractMime(toBytes(attachment.content), depth + 1, extraction, seen, budget);
      continue;
    }

    if (mimeType === "application/pdf") {
      if (budget.pdfs >= maxPdfAttachments) {
        recordSkipped(extraction, mimeType);
        continue;
      }
      budget.pdfs += 1;
      const text = await pdfReceiptText(attachment.content);
      if (text) addText(text, depth, extraction, seen);
      else recordSkipped(extraction, mimeType);
      continue;
    }

    recordSkipped(extraction, mimeType);
  }
}

// Invoice PDFs reuse the bounded ingest limits; an unreadable one is reported, never guessed at.
async function pdfReceiptText(content: ArrayBuffer | Uint8Array | string) {
  const bytes = toBytes(content);
  if (!bytes.byteLength || bytes.byteLength > maxPdfAttachmentBytes) return "";
  const parser = new PDFParse({ data: Buffer.from(bytes) });
  try {
    const parsed = await parser.getText({ first: maxPdfPages });
    assertPdfTextWithinLimits(parsed);
    const text = parsed.text.replace(/\r\n?/g, "\n").trim();
    return hasReadablePdfTextLayer(text) ? text : "";
  } catch {
    return "";
  } finally {
    await parser.destroy();
  }
}

function recordSkipped(extraction: ForwardedEmailExtraction, mimeType: string) {
  if (!extraction.skippedAttachments.includes(mimeType)) extraction.skippedAttachments.push(mimeType);
}

function toBytes(content: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (typeof content === "string") return new TextEncoder().encode(content);
  return content instanceof Uint8Array ? content : new Uint8Array(content);
}

function htmlReceiptText(html: string) {
  if (!html.trim()) return "";
  return htmlToText(html, {
    wordwrap: false,
    preserveNewlines: false,
    limits: {
      maxInputLength: recoveryLimits.maxReceiptCharacters * 4,
      maxDepth: 20,
      maxChildNodes: 2_000,
      maxBaseElements: 20,
      ellipsis: "",
    },
    selectors: [
      { selector: "script", format: "skip" },
      { selector: "style", format: "skip" },
      { selector: "noscript", format: "skip" },
      { selector: "template", format: "skip" },
      { selector: "svg", format: "skip" },
      { selector: "img", format: "skip" },
      { selector: "a", options: { ignoreHref: true } },
    ],
  }).replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function addText(text: string, depth: number, extraction: ForwardedEmailExtraction, seen: Set<string>) {
  const remaining = recoveryLimits.maxReceiptCharacters - extraction.texts.reduce((total, item) => total + item.text.length, 0);
  if (remaining <= 0) return;
  const bounded = text.slice(0, remaining);
  const digest = createHash("sha256").update(bounded).digest("hex");
  if (seen.has(digest)) return;
  seen.add(digest);
  extraction.texts.push({ clientRef: `forwarded-${depth}-${digest.slice(0, 20)}`, text: bounded });
}

function byteLength(value: string | Uint8Array) {
  return typeof value === "string" ? Buffer.byteLength(value, "utf8") : value.byteLength;
}
