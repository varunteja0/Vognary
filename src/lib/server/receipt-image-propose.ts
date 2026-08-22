import "server-only";

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getAiClient } from "@/lib/server/ai/client";
import { AI_MODELS } from "@/lib/server/ai/models";
import { evaluateBudget } from "@/lib/server/ai/budget";
import { isAiBudgetOpen, readAiBudgetFromEnv } from "@/lib/server/ai/budget-env";
import { estimateCostPaise } from "@/lib/server/ai/pricing";
import {
  proposeReceiptLineFromReadableText,
  type ReceiptLineProposal,
} from "@/lib/recovery/image-receipt-proposal";

const maxImageBytes = 8 * 1024 * 1024;
const visionMediaTypes = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

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

  const fromOcr = proposeReceiptLineFromReadableText(await ocrWithSystemTesseract(buffer) ?? "");
  if (fromOcr) return { proposal: fromOcr, reason: "cited" };

  const mediaType = visionMediaType(mime, name);
  if (mediaType) {
    const transcribed = await transcribeReceiptImage(buffer, mediaType);
    const fromVision = transcribed ? proposeReceiptLineFromReadableText(transcribed) : null;
    if (fromVision) return { proposal: fromVision, reason: "cited" };
  }

  return { proposal: null, reason: "unreadable" };
}

function visionMediaType(mime: string, name: string): "image/jpeg" | "image/png" | "image/gif" | "image/webp" | null {
  if (mime === "image/jpeg" || mime === "image/png" || mime === "image/gif" || mime === "image/webp") return mime;
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".gif")) return "image/gif";
  if (name.endsWith(".webp")) return "image/webp";
  if (visionMediaTypes.has(mime)) return mime as "image/jpeg" | "image/png" | "image/gif" | "image/webp";
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

async function ocrWithSystemTesseract(buffer: Buffer): Promise<string | null> {
  const dir = await mkdtemp(join(tmpdir(), "vognary-ocr-"));
  const input = join(dir, "receipt.bin");
  try {
    await writeFile(input, buffer);
    return await new Promise((resolve) => {
      const child = spawn("tesseract", [input, "stdout", "-l", "eng"], { stdio: ["ignore", "pipe", "ignore"] });
      const chunks: Buffer[] = [];
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve(null);
      }, 8_000);
      child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
      child.on("error", () => {
        clearTimeout(timer);
        resolve(null);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          resolve(null);
          return;
        }
        const text = Buffer.concat(chunks).toString("utf8").trim();
        resolve(text || null);
      });
    });
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function transcribeReceiptImage(
  buffer: Buffer,
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp",
): Promise<string | null> {
  const budget = readAiBudgetFromEnv();
  if (!isAiBudgetOpen(budget)) return null;
  const client = getAiClient();
  if (!client) return null;
  const estimate = estimateCostPaise(AI_MODELS.extraction, { inputTokens: 1_200, outputTokens: 400 });
  if (!evaluateBudget(budget, estimate).allowed) return null;

  try {
    const message = await client.messages.create({
      model: AI_MODELS.extraction,
      max_tokens: 400,
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
            text: "Transcribe every visible character from this receipt. Do not infer missing merchants, amounts, currencies, or dates. If the image is unreadable, reply EMPTY.",
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
