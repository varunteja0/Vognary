import { createHash } from "node:crypto";
import { htmlToText } from "html-to-text";
import PostalMime from "postal-mime";
import "pdf-parse/worker";
import { PDFParse } from "pdf-parse";
import { assertPdfTextWithinLimits, hasReadablePdfTextLayer, maxPdfPages } from "@/lib/pdf-ingest";
import { recoveryLimits } from "@/lib/recovery/contracts";
import { assessSenderProvenance, type SenderProvenance } from "@/lib/recovery/sender-provenance";
import { inferReceiptCurrencyHint, type ReceiptCurrencyHint } from "@/lib/receipt-parser";

export const forwardedEmailMaxMimeBytes = 8 * 1024 * 1024;
const maxNestedEmailDepth = 2;
const maxHeadersBytes = 128 * 1024;
const maxPdfAttachments = 3;
const maxPdfAttachmentBytes = 4 * 1024 * 1024;

type ForwardedReceiptText = {
  clientRef: string;
  text: string;
  /** Assessed from the headers of the message this text came out of, not the outer forward. */
  provenance: SenderProvenance;
};

/** Gmail will not forward anything until this challenge is answered by the user. */
export type GmailForwardingVerification = {
  code: string | null;
  verificationUrl: string | null;
};

export type ForwardedEmailExtraction = {
  texts: ForwardedReceiptText[];
  skippedAttachments: string[];
  currencyHint: ReceiptCurrencyHint | null;
  gmailVerification: GmailForwardingVerification | null;
};

export type ForwardedEmailExtractionOptions = {
  /** Authorities whose Authentication-Results this deployment accepts. */
  trustedAuthorities?: readonly string[];
  /** Sending domains that already produced accepted evidence in this workspace. */
  knownSenderDomains?: readonly string[];
};

export async function extractForwardedReceiptTexts(
  raw: string | Uint8Array,
  options: ForwardedEmailExtractionOptions = {},
): Promise<ForwardedEmailExtraction> {
  if (byteLength(raw) > forwardedEmailMaxMimeBytes) throw new Error("Forwarded email is too large to process.");
  const extraction: ForwardedEmailExtraction = {
    texts: [],
    skippedAttachments: [],
    currencyHint: null,
    gmailVerification: null,
  };
  await extractMime(raw, 0, extraction, new Set(), { pdfs: 0 }, options);
  if (extraction.gmailVerification) return extraction;
  extraction.currencyHint = inferReceiptCurrencyHint(extraction.texts.map((item) => item.text));
  return extraction;
}

// Only mail whose envelope sender is exactly google.com may raise this challenge,
// so a lookalike domain cannot trick a user into confirming someone else's forward.
function detectGmailForwardingVerification(
  senderAddress: string | undefined,
  subject: string | undefined,
  body: string,
): GmailForwardingVerification | null {
  const domain = senderAddress?.toLowerCase().trim().split("@")[1] ?? "";
  if (domain !== "google.com") return null;

  const subjectText = subject ?? "";
  const looksLikeChallenge = /forwarding confirmation/i.test(subjectText)
    || /mail-settings\.google\.com\/mail\//i.test(body);
  if (!looksLikeChallenge) return null;

  const verificationUrl = body.match(/https:\/\/mail-settings\.google\.com\/mail\/[^\s"'<>]+/i)?.[0] ?? null;
  const code = body.match(/confirmation code:?\s*(\d{6,12})/i)?.[1]
    ?? subjectText.match(/\(#(\d{6,12})\)/)?.[1]
    ?? null;
  if (!code && !verificationUrl) return null;

  return { code, verificationUrl };
}

async function extractMime(
  raw: string | Uint8Array,
  depth: number,
  extraction: ForwardedEmailExtraction,
  seen: Set<string>,
  budget: { pdfs: number },
  options: ForwardedEmailExtractionOptions,
) {  if (depth > maxNestedEmailDepth || extraction.texts.length >= recoveryLimits.maxReceiptSnippets) return;
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
  if (depth === 0) {
    const verification = detectGmailForwardingVerification(parsed.from?.address, parsed.subject, plainText);
    if (verification) {
      extraction.gmailVerification = verification;
      return;
    }
  }
  const provenance = assessSenderProvenance({
    headers: parsed.headers,
    from: parsed.from,
    trustedAuthorities: options.trustedAuthorities,
    knownSenderDomains: options.knownSenderDomains,
  });
  if (plainText) addText(plainText, depth, extraction, seen, provenance);

  for (const attachment of parsed.attachments) {
    if (extraction.texts.length >= recoveryLimits.maxReceiptSnippets) break;
    const mimeType = attachment.mimeType.toLowerCase();

    if (mimeType === "message/rfc822") {
      if (depth >= maxNestedEmailDepth) recordSkipped(extraction, mimeType);
      else await extractMime(toBytes(attachment.content), depth + 1, extraction, seen, budget, options);
      continue;
    }

    if (mimeType === "application/pdf") {
      if (budget.pdfs >= maxPdfAttachments) {
        recordSkipped(extraction, mimeType);
        continue;
      }
      budget.pdfs += 1;
      const text = await pdfReceiptText(attachment.content);
      if (text) addText(text, depth, extraction, seen, provenance);
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

function addText(
  text: string,
  depth: number,
  extraction: ForwardedEmailExtraction,
  seen: Set<string>,
  provenance: SenderProvenance,
) {
  const remaining = recoveryLimits.maxReceiptCharacters - extraction.texts.reduce((total, item) => total + item.text.length, 0);
  if (remaining <= 0) return;
  const bounded = text.slice(0, remaining);
  const digest = createHash("sha256").update(bounded).digest("hex");
  if (seen.has(digest)) return;
  seen.add(digest);
  extraction.texts.push({ clientRef: `forwarded-${depth}-${digest.slice(0, 20)}`, text: bounded, provenance });
}

function byteLength(value: string | Uint8Array) {
  return typeof value === "string" ? Buffer.byteLength(value, "utf8") : value.byteLength;
}
