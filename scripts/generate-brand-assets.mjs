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

const markSource = (await readFile(path.join(brand, "vognary-mark.svg"))).toString("base64");
const markImage = (x, y, size) => `<image x="${x}" y="${y}" width="${size}" height="${size}" href="data:image/svg+xml;base64,${markSource}"/>`;
const socialMaster = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-labelledby="title"><title id="title">Vognary Commitment Control</title><rect width="1200" height="630" fill="#f3f6f4"/><rect x="0" y="0" width="1200" height="18" fill="#173f35"/><rect x="880" y="18" width="320" height="612" fill="#d9ed8c"/><text x="68" y="190" font-family="Bricolage Grotesque, Manrope, sans-serif" font-size="110" font-weight="700" fill="#173f35">Vognary.</text><text x="72" y="275" font-family="Manrope, sans-serif" font-size="25" fill="#44564d">Commitment Control. India-first.</text><path d="M72 325H808" stroke="#a9b9ae"/><text x="72" y="399" font-family="Manrope, sans-serif" font-size="43" font-weight="600" fill="#202e29">Before the commitment.</text><text x="72" y="460" font-family="Manrope, sans-serif" font-size="43" font-weight="600" fill="#202e29">A clear human decision.</text><text x="72" y="563" font-family="Manrope, sans-serif" font-size="21" fill="#53665b">Proposed  /  Authorized  /  Observed</text><rect x="944" y="217" width="192" height="192" rx="6" fill="#173f35"/>${markImage(972,245,136)}</svg>\n`;
const headerMaster = `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="500" viewBox="0 0 1500 500" role="img" aria-labelledby="title"><title id="title">Vognary X profile header</title><rect width="1500" height="500" fill="#173f35"/><path d="M425 70V430" stroke="#719181"/><text x="500" y="170" font-family="Bricolage Grotesque, Manrope, sans-serif" font-size="88" font-weight="700" fill="#d9ed8c">Vognary.</text><text x="506" y="244" font-family="Manrope, sans-serif" font-size="24" fill="#e0eae4">Commitment Control for India-first AI companies</text><text x="506" y="322" font-family="Manrope, sans-serif" font-size="37" fill="#ffffff">Before the commitment. A clear human decision.</text><text x="506" y="400" font-family="Manrope, sans-serif" font-size="21" fill="#bfd1c5">Proposed  /  Authorized  /  Observed</text>${markImage(110,90,250)}</svg>\n`;
const avatarMaster = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800" role="img" aria-labelledby="title"><title id="title">Vognary X avatar</title><rect width="800" height="800" fill="#173f35"/>${markImage(144,144,512)}</svg>\n`;
await Promise.all([
  writeFile(path.join(brand, "vognary-social-card.svg"), socialMaster),
  writeFile(path.join(brand, "vognary-x-header.svg"), headerMaster),
  writeFile(path.join(brand, "vognary-x-avatar.svg"), avatarMaster),
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
      background: "#173f35",
    },
  })
    .composite([{ input: markBuffer, left: offset, top: offset }])
    .toColourspace("srgb")
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}
