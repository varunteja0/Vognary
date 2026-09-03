import { existsSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import vm from "node:vm";

const nextRoot = new URL("../.next/", import.meta.url);
const rootManifestUrl = new URL("build-manifest.json", nextRoot);
// Every user-facing route, not a sample of three. A budget that only watches
// the routes someone remembered to add is a budget that has already been beaten
// by the next route.
const userFacingRoutes = [
  "/", "/demo", "/start", "/login", "/app", "/pay", "/security", "/billing/return",
  "/profile", "/verify", "/offline", "/about", "/contact", "/privacy", "/terms", "/brand",
];
const routes = userFacingRoutes.map((route) => {
  const segment = route === "/" ? "" : route;
  return {
    route,
    key: `${segment}/page`,
    manifest: `server/app${segment}/page_client-reference-manifest.js`,
    jsGzipLimit: 220_000,
  };
});
const cssGzipLimit = 15_000;
const chunkGzipLimit = 80_000;

if (!existsSync(rootManifestUrl)) {
  throw new Error("Production build output is missing. Run `npm run build` before `npm run perf:budget`.");
}

const rootManifest = JSON.parse(readFileSync(rootManifestUrl, "utf8"));
const sharedJs = [...rootManifest.polyfillFiles, ...rootManifest.rootMainFiles];
const failures = [];
const report = [];

for (const config of routes) {
  const manifestUrl = new URL(config.manifest, nextRoot);
  if (!existsSync(manifestUrl)) {
    failures.push(`${config.route}: missing ${config.manifest}`);
    continue;
  }

  const context = {};
  context.globalThis = context;
  vm.runInNewContext(readFileSync(manifestUrl, "utf8"), context, { filename: config.manifest });
  const manifest = context.__RSC_MANIFEST?.[config.key];
  if (!manifest) {
    failures.push(`${config.route}: route key ${config.key} was not found`);
    continue;
  }

  const routeJs = Object.values(manifest.clientModules)
    .flatMap((entry) => entry.chunks ?? [])
    .map(normalizeAssetPath);
  // Next 16 marks every CSS entry `inlined: true` and carries the bytes in
  // `content`. Inlined CSS still ships on the critical path, so it is measured
  // from `content` when the chunk is not emitted to disk. Filtering inlined
  // entries out silently zeroed this budget.
  const cssEntries = Object.values(manifest.entryCSSFiles)
    .flatMap((entries) => entries)
    .filter((entry) => normalizeAssetPath(entry.path).endsWith(".css"));
  const jsAssets = unique([...sharedJs, ...routeJs]).filter((asset) => asset.endsWith(".js"));
  const jsSizes = jsAssets.map(measureAsset);
  const cssSizes = measureCssEntries(cssEntries);
  const jsGzip = total(jsSizes, "gzip");
  const cssGzip = total(cssSizes, "gzip");

  if (jsGzip > config.jsGzipLimit) failures.push(`${config.route}: initial JS ${formatBytes(jsGzip)} exceeds ${formatBytes(config.jsGzipLimit)}`);
  if (cssGzip > cssGzipLimit) failures.push(`${config.route}: CSS ${formatBytes(cssGzip)} exceeds ${formatBytes(cssGzipLimit)}`);
  for (const asset of jsSizes) {
    if (asset.gzip > chunkGzipLimit) failures.push(`${config.route}: ${asset.path} is ${formatBytes(asset.gzip)} gzip; limit ${formatBytes(chunkGzipLimit)}`);
  }

  report.push({
    route: config.route,
    jsFiles: jsSizes.length,
    jsGzip,
    jsLimit: config.jsGzipLimit,
    cssFiles: cssSizes.length,
    cssGzip,
    cssLimit: cssGzipLimit,
  });
}

for (const row of report) {
  // Exact bytes, not only rounded KB: a route can sit 40 B under a ceiling and
  // look identical to one with 3 KB of headroom when both round to the same KB.
  console.log(
    `${row.route.padEnd(16)} JS ${String(row.jsGzip).padStart(7)} B / ${row.jsLimit} B (${row.jsFiles} files)`
    + ` \u00b7 CSS ${String(row.cssGzip).padStart(6)} B / ${row.cssLimit} B`
    + ` (${row.cssFiles} files, ${row.cssLimit - row.cssGzip} B headroom)`,
  );
}

if (failures.length) {
  console.error("\nPerformance budget failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`Performance budgets passed for all ${report.length} user-facing routes.`);
}

function normalizeAssetPath(value) {
  return value.replace(/^\/_next\//, "");
}

function unique(values) {
  return [...new Set(values)];
}

function measureAsset(path) {
  const assetUrl = new URL(path, nextRoot);
  if (!existsSync(assetUrl)) throw new Error(`Manifest references missing asset: ${path}`);
  const buffer = readFileSync(assetUrl);
  return { path, raw: buffer.length, gzip: gzipSync(buffer, { level: 9 }).length };
}

function measureCssEntries(entries) {
  const seen = new Set();
  const sizes = [];
  for (const entry of entries) {
    const path = normalizeAssetPath(entry.path);
    if (seen.has(path)) continue;
    seen.add(path);
    const assetUrl = new URL(path, nextRoot);
    const buffer = existsSync(assetUrl)
      ? readFileSync(assetUrl)
      : Buffer.from(entry.content ?? "", "utf8");
    if (!buffer.length) throw new Error(`CSS entry has no measurable bytes: ${path}`);
    sizes.push({ path, raw: buffer.length, gzip: gzipSync(buffer, { level: 9 }).length });
  }
  return sizes;
}

function total(values, key) {
  return values.reduce((sum, value) => sum + value[key], 0);
}

function formatBytes(value) {
  return `${(value / 1024).toFixed(1)} KB`;
}