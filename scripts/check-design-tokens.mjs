import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const SRC = "src";

// Files that legitimately carry literal colours/dimensions, exempt in full:
// image specs (the value IS the pixel), brand-mark geometry, and the error
// boundary that renders when globals.css itself failed to load.
export const ALLOWED_FILES = new Set([
  "src/app/apple-icon.tsx",
  "src/app/icon.tsx",
  "src/app/opengraph-image.tsx",
  "src/app/twitter-image.tsx",
  "src/app/brand.tsx",
  "src/app/brand/page.tsx",
  "src/app/character.tsx", // Nakul mongoose brand-mark geometry
  "src/app/global-error.tsx", // renders WITHOUT globals.css — cannot use var(--x)
  "src/app/pwa/startup/[size]/route.tsx", // PWA splash image spec
]);

// No production component is deferred from token enforcement.
export const WP4_DEFERRED = new Set();

// Narrowly-scoped literal exceptions with a stated reason.
export const KNOWN_EXCEPTIONS = [
  {
    file: "src/app/login/login-client.tsx",
    pattern: /#4285F4|#34A853|#FBBC05|#EA4335/,
    reason: "Google brand 'G' logo — exact colours mandated by Google brand guidelines",
  },
  {
    file: "src/app/layout.tsx",
    pattern: /#0b0c0f/,
    reason: "PWA themeColor viewport config — must be a literal; mirrors --paper in globals.css",
  },
];

// A COMPLETE css hex colour: #RGB, #RGBA, #RRGGBB, or #RRGGBBAA. The trailing
// (?![\w-]) boundary stops href="#add-source" matching as #add.
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![\w-])/g;
// Raw colour functions. color-mix( is excluded — it composes tokens.
const COLOR_FN = /\b(?:rgba?|hsla?)\(/g;
// Inline style block + a dimension literal (quoted px/rem/em) inside it. var(--x),
// template strings, and unitless ratios (lineHeight: 1.2) are left alone.
const STYLE_BLOCK = /style=\{\{[^}]*\}\}/g;
const DIM_LITERAL = /([A-Za-z]+)\s*:\s*(['"])\s*-?\d*\.?\d+(?:px|rem|em)\s*\2/g;

const isExcepted = (relPath, text) =>
  KNOWN_EXCEPTIONS.some((ex) => ex.file === relPath && ex.pattern.test(text));
const lineOf = (content, index) => content.slice(0, index).split("\n").length;

// Pure scanner — exported so the unit test can assert against synthetic fixtures.
export function scanContent(relPath, content) {
  if (ALLOWED_FILES.has(relPath) || WP4_DEFERRED.has(relPath)) return [];
  const violations = [];
  content.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(HEX)) {
      if (isExcepted(relPath, m[0])) continue;
      violations.push({ file: relPath, line: i + 1, rule: "raw-hex-color", text: m[0] });
    }
    for (const m of line.matchAll(COLOR_FN)) {
      violations.push({ file: relPath, line: i + 1, rule: "raw-color-function", text: `${m[0]}…)` });
    }
  });
  for (const block of content.matchAll(STYLE_BLOCK)) {
    for (const dim of block[0].matchAll(DIM_LITERAL)) {
      violations.push({ file: relPath, line: lineOf(content, block.index), rule: "inline-dimension-literal", text: dim[0].trim() });
    }
  }
  return violations;
}

async function collectTsxFiles(dir) {
  const entries = await readdir(resolve(root, dir), { recursive: true });
  return entries.filter((n) => n.endsWith(".tsx")).map((n) => `${dir}/${n}`);
}

async function main() {
  const files = await collectTsxFiles(SRC);
  const violations = [];
  for (const file of files) violations.push(...scanContent(file, await readFile(resolve(root, file), "utf8")));
  if (violations.length) {
    console.error("Design-token check failed — replace literals with tokens from globals.css:\n" +
      violations.map((v) => `- ${v.file}:${v.line} [${v.rule}] ${v.text}`).join("\n"));
    process.exit(1);
  }
  console.log(`Design-token check passed for ${files.length} components (${WP4_DEFERRED.size} deferred, ${ALLOWED_FILES.size} image/brand exempt).`);
}
// pathToFileURL survives the space in "CVT Group" — naive string concat does not.
// No top-level await: the unit test imports this module through tsx's CJS transform.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
