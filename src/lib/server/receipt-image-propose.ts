import "server-only";

import { getAiClient } from "@/lib/server/ai/client";
import { AI_MODELS } from "@/lib/server/ai/models";
import { evaluateBudget } from "@/lib/server/ai/budget";
import { isAiBudgetOpen, readAiBudgetFromEnv } from "@/lib/server/ai/budget-env";
import { estimateCostPaise } from "@/lib/server/ai/pricing";
import {
  mergeReceiptLineProposals,
  proposalFromVisionExtraction,
  proposeReceiptLineFromReadableText,
  receiptLineProposalIsPartial,
  type ReceiptLineProposal,
} from "@/lib/recovery/image-receipt-proposal";
import { ocrReceiptImage, prepareReceiptImage } from "@/lib/server/receipt-image-ocr";

const maxImageBytes = 8 * 1024 * 1024;

const visionPrompt = [
  "Read this billing screenshot or receipt.",
  "Return JSON only with this shape:",
  '{"visible_text":"every visible character, line by line, exact","merchant":"printed merchant or plan name or empty","amount":"printed paid or total amount digits only or empty","currency":"INR or USD or EUR or GBP or empty","charge_date":"YYYY-MM-DD of the paid/charge date or empty","paid_amount_is_zero":false}',
  "Copy. Do not infer.",
  "Do not use a plan price, list price, or renewal price unless that exact amount is the paid or total line.",
  "A paid line of 0 stays 0: amount must be empty and paid_amount_is_zero true.",
  "charge_date is the transaction or paid date, never an access-until or expiry date.",
  "If the image is unreadable, visible_text must be empty and every other field empty.",
].join(" ");

export async function proposeReceiptLineFromImageFile(file: File): Promise<{
  proposal: ReceiptLineProposal | null;
  reason: "cited" | "unreadable" | "not-image" | "too-large";
}> {
  if (file.size > maxImageBytes) return { proposal: null, reason: "too-large" };
  const mime = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  const looksLikeImage = mime.startsWith("image/") || /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(name);
  const buffer = Buffer.from(await file.arrayBuffer());

  if (looksLikeText(buffer)) {
    const fromText = proposeReceiptLineFromReadableText(buffer.toString("utf8"));
    if (fromText) return { proposal: fromText, reason: "cited" };
  }

  if (!looksLikeImage) return { proposal: null, reason: "not-image" };

  let ocrText: string | null = null;
  let visionBuffer = buffer;
  let visionMediaType = visionMediaTypeFrom(mime, name);
  try {
    const prepared = await prepareReceiptImage(buffer);
    visionBuffer = Buffer.from(prepared.vision);
    visionMediaType = prepared.visionMediaType;
    ocrText = await ocrReceiptImage(Buffer.from(prepared.ocr));
  } catch {
    ocrText = await ocrReceiptImage(buffer);
  }

  const fromOcr = proposeReceiptLineFromReadableText(ocrText ?? "");
  if (fromOcr && !receiptLineProposalIsPartial(fromOcr) && (ocrText?.length ?? 0) >= 40) {
    return { proposal: fromOcr, reason: "cited" };
  }

  const fromVision = visionMediaType
    ? proposalFromVisionExtraction(await transcribeReceiptImage(visionBuffer, visionMediaType))
    : null;
  const proposal = mergeReceiptLineProposals(fromOcr, fromVision);
  if (proposal) return { proposal, reason: "cited" };
  return { proposal: null, reason: "unreadable" };
}

function visionMediaTypeFrom(mime: string, name: string): "image/jpeg" | "image/png" | "image/gif" | "image/webp" | null {
  if (mime === "image/jpeg" || mime === "image/png" || mime === "image/gif" || mime === "image/webp") return mime;
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".gif")) return "image/gif";
  if (name.endsWith(".webp")) return "image/webp";
  return null;
}

function looksLikeText(buffer: Buffer) {
  if (buffer.length === 0) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4_096));
  let printable = 0;
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte < 127)) printable += 1;
  }
  return printable / sample.length > 0.9;
}

async function transcribeReceiptImage(
  buffer: Buffer,
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp",
): Promise<unknown> {
  const budget = readAiBudgetFromEnv();
  if (!isAiBudgetOpen(budget)) return null;
  const client = getAiClient();
  if (!client) return null;
  const estimate = estimateCostPaise(AI_MODELS.extraction, { inputTokens: 2_400, outputTokens: 800 });
  if (!evaluateBudget(budget, estimate).allowed) return null;

  try {
    const message = await client.messages.create({
      model: AI_MODELS.extraction,
      max_tokens: 800,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType,
              data: buffer.toString("base64"),
            },
          },
          {
            type: "text",
            text: visionPrompt,
          },
        ],
      }],
    });
    const text = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
    if (!text || text === "EMPTY") return null;
    return text;
  } catch {
    return null;
  }
}
