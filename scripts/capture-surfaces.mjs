// Capture harness. The shared VS Code browser panel cannot be resized by
// Playwright (window.innerWidth stays ~339px), so proof captures must come from
// a Playwright-owned browser with real viewports.
//
//   node scripts/capture-surfaces.mjs [--out docs/evidence/<slug>] [--base URL]
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const base = args.get("--base") ?? "http://127.0.0.1:3100";
const outDir = args.get("--out") ?? "/tmp/vognary-shots";

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "768", width: 768, height: 1024 },
  { name: "1440", width: 1440, height: 900 },
];

// Public routes only: signed-in surfaces need a session and are captured separately.
const ROUTES = [
  ["landing", "/"],
  ["start", "/start"],
  ["pay", "/pay"],
  ["login", "/login"],
  ["about", "/about"],
  ["contact", "/contact"],
  ["security", "/security"],
  ["privacy", "/privacy"],
  ["terms", "/terms"],
  ["offline", "/offline"],
];

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const findings = [];

for (const scheme of ["light", "dark"]) {
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
      hasTouch: vp.width <= 768,
      colorScheme: scheme,
      reducedMotion: "no-preference",
    });
    const page = await context.newPage();
    for (const [slug, route] of ROUTES) {
      const res = await page.goto(base + route, { waitUntil: "networkidle" }).catch(() => null);
      if (!res || res.status() >= 400) {
        findings.push({ route, viewport: vp.name, scheme, issue: `HTTP ${res?.status() ?? "no response"}` });
        continue;
      }
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${outDir}/${slug}-${vp.name}-${scheme}.png`, fullPage: true });

      // Layout and touch-target audit at the same moment the capture is taken.
      const audit = await page.evaluate(() => {
        const de = document.documentElement;
        const small = [];
        const coarsePointer = matchMedia("(pointer: coarse)").matches;
        for (const el of document.querySelectorAll('a,button,input,select,textarea,summary,[role="button"]')) {
          const r = el.getBoundingClientRect();
          const inlineTextLink = el instanceof HTMLAnchorElement
            && getComputedStyle(el).display === "inline"
            && el.closest("p") !== null;
          if (coarsePointer && !inlineTextLink && r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 44)) {
            small.push(`${(el.textContent || el.tagName).trim().slice(0, 24)} ${Math.round(r.width)}x${Math.round(r.height)}`);
          }
        }
        const wide = [];
        for (const el of document.querySelectorAll("*")) {
          const r = el.getBoundingClientRect();
          if (r.width > de.clientWidth + 1) wide.push(`${el.tagName}.${String(el.className).slice(0, 30)}`);
        }
        return { overflow: de.scrollWidth > de.clientWidth, scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, small, wide: wide.slice(0, 5) };
      });
      if (audit.overflow) findings.push({ route, viewport: vp.name, scheme, issue: `horizontal overflow ${audit.scrollWidth}>${audit.clientWidth}`, wide: audit.wide });
      if (audit.small.length) findings.push({ route, viewport: vp.name, scheme, issue: `${audit.small.length} targets under 44px`, targets: audit.small.slice(0, 8) });
    }
    await context.close();
  }
}

await browser.close();
console.log(`captured ${ROUTES.length * VIEWPORTS.length * 2} screenshots to ${outDir}`);
if (!findings.length) console.log("no layout or touch-target findings");
else {
  console.log(`\n${findings.length} findings:`);
  for (const f of findings) console.log(JSON.stringify(f));
  process.exitCode = 1;
}
