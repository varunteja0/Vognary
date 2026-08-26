import "server-only";

import { getAiClient } from "@/lib/server/ai/client";
import { AI_MODELS } from "@/lib/server/ai/models";
import { evaluateBudget } from "@/lib/server/ai/budget";
import { isAiBudgetOpen, readAiBudgetFromEnv } from "@/lib/server/ai/budget-env";
import { estimateCostPaise } from "@/lib/server/ai/pricing";
import {
  applyCitedWorkspaceMerchant,
  mergeReceiptLineProposals,
  proposalFromVisionExtraction,
  proposeReceiptLineFromReadableText,
  receiptLineProposalIsPartial,
  type ReceiptLineProposal,
  type ReceiptLineProposalOptions,
} from "@/lib/recovery/image-receipt-proposal";
import { ocrReceiptImage, prepareReceiptImage, PROPOSE_READ_TIMEOUT_MS, withTimeout } from "@/lib/server/receipt-image-ocr";

const maxImageBytes = 8 * 1024 * 1024;

const visionPrompt = [
  "Read this billing screenshot or receipt.",
  "Return JSON only with this shape:",
  '{"visible_text":"every visible character, line by line, exact","merchant":"printed merchant or plan name or empty","amount":"printed paid or total amount digits only or empty","currency":"INR or USD or EUR or GBP or empty","charge_date":"YYYY-MM-DD of the paid/charge date or empty","paid_amount_is_zero":false}',
  "Copy. Do not infer.",
  "Do not use a second plan price, list price, or renewal price when a different paid or total line is printed.",
  "If no paid line exists, copy the unique printed cost with currency. That is still not a settlement.",
  "A paid line of 0 stays 0: amount must be empty and paid_amount_is_zero true.",
  "merchant is the printed vendor name, never a plan word such as Premium, Active, Plus, or Pro by itself.",
  "charge_date is the transaction or paid date, never an access-until, expiry, or next billing cycle date.",
  "If the image is unreadable, visible_text must be empty and every other field empty.",
].join(" ");

export async function proposeReceiptLineFromImageFile(
  file: File,
  options?: ReceiptLineProposalOptions,
): Promise<{
  proposal: ReceiptLineProposal | null;
  reason: "cited" | "unreadable" | "not-image" | "too-large";
}> {
  if (file.size > maxImageBytes) return { proposal: null, reason: "too-large" };
  const mime = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  const looksLikeImage = mime.startsWith("image/") || /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(name);
  const buffer = Buffer.from(await file.arrayBuffer());
  const known = { knownMerchants: options?.knownMerchants };

  if (looksLikeText(buffer)) {
    const fromText = proposeReceiptLineFromReadableText(buffer.toString("utf8"), known);
    if (fromText) return { proposal: fromText, reason: "cited" };
  }

  if (!looksLikeImage) return { proposal: null, reason: "not-image" };

  try {
    const prepared = await prepareReceiptImage(buffer);
    const visionBuffer = Buffer.from(prepared.vision);
    const [ocrText, visionRaw] = await Promise.all([
      withTimeout(ocrReceiptImage(Buffer.from(prepared.ocr)), PROPOSE_READ_TIMEOUT_MS, null),
      withTimeout(transcribeReceiptImage(visionBuffer, prepared.visionMediaType), PROPOSE_READ_TIMEOUT_MS, null),
    ]);
    const fromOcr = proposeReceiptLineFromReadableText(ocrText ?? "", known);
    if (fromOcr && !receiptLineProposalIsPartial(fromOcr) && (ocrText?.length ?? 0) >= 40) {
      return { proposal: fromOcr, reason: "cited" };
    }
    const fromVision = proposalFromVisionExtraction(visionRaw, known);
    const proposal = applyCitedWorkspaceMerchant(
      mergeReceiptLineProposals(fromOcr, fromVision),
      [ocrText ?? "", visionTranscript(visionRaw)].filter(Boolean).join("\n"),
      options?.knownMerchants,
    );
    if (proposal) return { proposal, reason: "cited" };
    return { proposal: null, reason: "unreadable" };
  } catch {
    return { proposal: null, reason: "unreadable" };
  }
}

function visionTranscript(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
        if (parsed && typeof parsed === "object" && "visible_text" in parsed) {
          const text = (parsed as { visible_text?: unknown }).visible_text;
          if (typeof text === "string") return text;
        }
      } catch {
        return raw;
      }
    }
    return raw;
  }
  if (typeof raw === "object" && "visible_text" in raw) {
    const text = (raw as { visible_text?: unknown }).visible_text;
    return typeof text === "string" ? text : "";
  }
  return "";
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
