import "server-only";

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";

export async function prepareReceiptImage(buffer: Buffer): Promise<{
  ocr: Buffer;
  vision: Buffer;
  visionMediaType: "image/jpeg";
}> {
  const image = sharp(buffer, { failOn: "none" }).rotate();
  const stats = await image.clone().stats();
  const rgb = stats.channels.slice(0, 3);
  const mean = rgb.reduce((sum, channel) => sum + channel.mean, 0) / (rgb.length || 1);

  const vision = await image
    .clone()
    .resize({ width: 1600, withoutEnlargement: false })
    .jpeg({ quality: 80 })
    .toBuffer();

  let ocrPipeline = image.clone().resize({ width: 1600, withoutEnlargement: false }).grayscale();
  if (mean < 110) ocrPipeline = ocrPipeline.negate({ alpha: false });
  const ocr = await ocrPipeline.normalize().png().toBuffer();
  return { ocr, vision, visionMediaType: "image/jpeg" };
}

export async function ocrReceiptImage(png: Buffer): Promise<string | null> {
  const native = await ocrWithSystemTesseract(png);
  if (native && native.length >= 12) return repairOcrGlyphs(native);
  if (!wasmOcrAllowed(png)) return native ? repairOcrGlyphs(native) : null;
  const wasm = await ocrWithWasmTesseract(png);
  const chosen = denserText(native, wasm);
  return chosen ? repairOcrGlyphs(chosen) : null;
}

function wasmOcrAllowed(buffer: Buffer) {
  if (buffer.length < 8_000) return false;
  return process.env.npm_lifecycle_event !== "test";
}

function denserText(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  return right.length > left.length ? right : left;
}

function repairOcrGlyphs(text: string) {
  return text.replace(/(Paid|Total|Amount)\s+[\[\]I|]\s*0(?:\.0{1,2})?\b/gi, "$1 ₹0.00");
}

async function ocrWithSystemTesseract(png: Buffer): Promise<string | null> {
  const dir = await mkdtemp(join(tmpdir(), "vognary-ocr-"));
  const input = join(dir, "receipt.png");
  try {
    await writeFile(input, png);
    const first = await runTesseract(input, "6");
    const sparse = await runTesseract(input, "11");
    return denserText(first, sparse);
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runTesseract(input: string, psm: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn("tesseract", [input, "stdout", "-l", "eng", "--psm", psm], { stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(null);
    }, 12_000);
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
}

async function ocrWithWasmTesseract(png: Buffer): Promise<string | null> {
  try {
    const { createWorker, PSM } = await import("tesseract.js");
    const worker = await createWorker("eng", 1, { cachePath: join(tmpdir(), "vognary-tess") });
    try {
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
      const block = await worker.recognize(png);
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
      const sparse = await worker.recognize(png);
      return denserText(block.data.text?.trim() || null, sparse.data.text?.trim() || null);
    } finally {
      await worker.terminate();
    }
  } catch {
    return null;
  }
}
