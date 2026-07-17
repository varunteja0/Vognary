import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const brand = path.join(root, "public", "brand");
const pwa = path.join(root, "public", "pwa");
const app = path.join(root, "src", "app");

const pngs = [
  [path.join(brand, "vognary-x-avatar.png"), 800, 800, 2_000_000],
  [path.join(brand, "vognary-x-header.png"), 1500, 500, 5_000_000],
  [path.join(brand, "vognary-social-card.png"), 1200, 630, 5_000_000],
  [path.join(brand, "vognary-mark-1024.png"), 1024, 1024, 2_000_000],
  [path.join(app, "opengraph-image.png"), 1200, 630, 8_000_000],
  [path.join(app, "twitter-image.png"), 1200, 630, 5_000_000],
  [path.join(pwa, "icon-192.png"), 192, 192, 500_000],
  [path.join(pwa, "icon-512.png"), 512, 512, 1_000_000],
  [path.join(pwa, "icon-maskable-512.png"), 512, 512, 1_000_000],
];

for (const [filename, width, height, maxBytes] of pngs) {
  const buffer = await readFile(filename);
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${filename} must be PNG`);
  assert.equal(buffer.readUInt32BE(16), width, `${filename} width`);
  assert.equal(buffer.readUInt32BE(20), height, `${filename} height`);
  assert.ok(buffer.byteLength <= maxBytes, `${filename} exceeds its platform size budget`);
}

const socialCard = await readFile(path.join(brand, "vognary-social-card.png"));
assert.deepEqual(await readFile(path.join(app, "opengraph-image.png")), socialCard, "Open Graph image must match the approved link-card export");
assert.deepEqual(await readFile(path.join(app, "twitter-image.png")), socialCard, "X link image must match the approved link-card export");

const svgSpecs = [
  ["vognary-mark.svg", 'viewBox="0 0 64 64"'],
  ["vognary-mark-ink.svg", 'viewBox="0 0 64 64"'],
  ["vognary-mark-mono.svg", 'viewBox="0 0 64 64"'],
  ["vognary-x-avatar.svg", 'width="800" height="800"'],
  ["vognary-x-header.svg", 'width="1500" height="500"'],
  ["vognary-social-card.svg", 'width="1200" height="630"'],
];

for (const [filename, signature] of svgSpecs) {
  const source = await readFile(path.join(brand, filename), "utf8");
  assert.ok(source.includes(signature), `${filename} has the wrong export geometry`);
  assert.ok(source.includes("Vognary"), `${filename} needs accessible brand labeling`);
}

for (const altFile of ["opengraph-image.alt.txt", "twitter-image.alt.txt"]) {
  const alt = (await readFile(path.join(app, altFile), "utf8")).trim();
  assert.ok(alt.startsWith("Vognary"), `${altFile} must name the brand`);
}

await access(path.join(brand, "vognary-lockup.svg"));
await access(path.join(brand, "vognary-lockup-ink.svg"));
const manifest = JSON.parse(await readFile(path.join(brand, "manifest.json"), "utf8"));
assert.equal(manifest.identity, "Ledger to Verdict", "Brand manifest identity");
const expectedExports = [
  "vognary-mark.svg",
  "vognary-mark-ink.svg",
  "vognary-mark-mono.svg",
  "vognary-lockup.svg",
  "vognary-lockup-ink.svg",
  "vognary-mark-1024.png",
  "vognary-x-avatar.svg",
  "vognary-x-avatar.png",
  "vognary-x-header.svg",
  "vognary-x-header.png",
  "vognary-social-card.svg",
  "vognary-social-card.png",
];
assert.deepEqual(
  manifest.exports.map(({ file }) => file),
  expectedExports,
  "Brand manifest must inventory every public export",
);

console.log(`Brand assets verified: ${pngs.length} platform PNGs and ${svgSpecs.length} vector masters.`);
