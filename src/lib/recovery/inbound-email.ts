import { createHash } from "node:crypto";
import { htmlToText } from "html-to-text";
import PostalMime from "postal-mime";
import { recoveryLimits } from "@/lib/recovery/contracts";

export const forwardedEmailMaxMimeBytes = 8 * 1024 * 1024;
const maxNestedEmailDepth = 2;
const maxHeadersBytes = 128 * 1024;

type ForwardedReceiptText = {
  clientRef: string;
  text: string;
};

export async function extractForwardedReceiptTexts(raw: string | Uint8Array): Promise<ForwardedReceiptText[]> {
  if (byteLength(raw) > forwardedEmailMaxMimeBytes) throw new Error("Forwarded email is too large to process.");
  const texts: ForwardedReceiptText[] = [];
  const seen = new Set<string>();
  await extractMime(raw, 0, texts, seen);
  return texts;
}

async function extractMime(
  raw: string | Uint8Array,
  depth: number,
  texts: ForwardedReceiptText[],
  seen: Set<string>,
) {
  if (depth > maxNestedEmailDepth || texts.length >= recoveryLimits.maxReceiptSnippets) return;
  if (byteLength(raw) > forwardedEmailMaxMimeBytes) throw new Error("Forwarded email is too large to process.");

  const parsed = await PostalMime.parse(raw, {
    rfc822Attachments: true,
    attachmentEncoding: "utf8",
    maxHeadersSize: maxHeadersBytes,
    maxNestingDepth: 20,
    maxRfc822NestingDepth: maxNestedEmailDepth,
  });
  const plainText = parsed.text?.replace(/\r\n?/g, "\n").trim()
    || htmlReceiptText(parsed.html ?? "");
  if (plainText) addText(plainText, depth, texts, seen);

  if (depth >= maxNestedEmailDepth) return;
  for (const attachment of parsed.attachments) {
    if (texts.length >= recoveryLimits.maxReceiptSnippets) break;
    if (attachment.mimeType.toLowerCase() !== "message/rfc822" || typeof attachment.content !== "string") continue;
    await extractMime(attachment.content, depth + 1, texts, seen);
  }
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

function addText(text: string, depth: number, texts: ForwardedReceiptText[], seen: Set<string>) {
  const remaining = recoveryLimits.maxReceiptCharacters - texts.reduce((total, item) => total + item.text.length, 0);
  if (remaining <= 0) return;
  const bounded = text.slice(0, remaining);
  const digest = createHash("sha256").update(bounded).digest("hex");
  if (seen.has(digest)) return;
  seen.add(digest);
  texts.push({ clientRef: `forwarded-${depth}-${digest.slice(0, 20)}`, text: bounded });
}

function byteLength(value: string | Uint8Array) {
  return typeof value === "string" ? Buffer.byteLength(value, "utf8") : value.byteLength;
}