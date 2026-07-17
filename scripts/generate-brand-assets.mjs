import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const brand = path.join(root, "public", "brand");
const pwa = path.join(root, "public", "pwa");
const app = path.join(root, "src", "app");

await Promise.all([
  mkdir(brand, { recursive: true }),
  mkdir(pwa, { recursive: true }),
]);

const avatar = await render("vognary-x-avatar.svg");
const header = await render("vognary-x-header.svg");
const socialCard = await render("vognary-social-card.svg");
const mark = await sharp(path.join(brand, "vognary-mark.svg"))
  .resize(1024, 1024)
  .toColourspace("srgb")
  .png({ compressionLevel: 9, adaptiveFiltering: true })
  .toBuffer();
const [pwa192, pwa512, pwaMaskable512] = await Promise.all([
  renderPwaIcon(192, 132),
  renderPwaIcon(512, 352),
  renderPwaIcon(512, 300),
]);

await Promise.all([
  writeFile(path.join(brand, "vognary-x-avatar.png"), avatar),
  writeFile(path.join(brand, "vognary-x-header.png"), header),
  writeFile(path.join(brand, "vognary-social-card.png"), socialCard),
  writeFile(path.join(brand, "vognary-mark-1024.png"), mark),
  writeFile(path.join(pwa, "icon-192.png"), pwa192),
  writeFile(path.join(pwa, "icon-512.png"), pwa512),
  writeFile(path.join(pwa, "icon-maskable-512.png"), pwaMaskable512),
  writeFile(path.join(app, "opengraph-image.png"), socialCard),
  writeFile(path.join(app, "twitter-image.png"), socialCard),
]);

console.log("Generated Vognary social, metadata, transparent mark, and installable app icon assets.");

async function render(filename) {
  const source = await readFile(path.join(brand, filename));
  return sharp(source)
    .toColourspace("srgb")
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function renderPwaIcon(size, markSize) {
  const markBuffer = await sharp(path.join(brand, "vognary-mark.svg"))
    .resize(markSize, markSize, { fit: "contain" })
    .png()
    .toBuffer();
  const offset = Math.round((size - markSize) / 2);
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: "#08090c",
    },
  })
    .composite([{ input: markBuffer, left: offset, top: offset }])
    .toColourspace("srgb")
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}
