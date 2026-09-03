// Capture harness. The shared VS Code browser panel cannot be resized by
// Playwright (window.innerWidth stays ~339px), so proof captures must come from
// a Playwright-owned browser with real viewports.
//
//   node scripts/capture-surfaces.mjs [--out docs/evidence/<slug>] [--base URL]
//   node scripts/capture-surfaces.mjs --signed-in            # adds /app surfaces
//   node scripts/capture-surfaces.mjs --signed-in --fresh-auth
//
// --signed-in-only skips the public routes. The code-login disclosure on /login
// is compiled out of a production build, so signed-in surfaces must come from a
// dev server while public surfaces come from the standalone artifact.
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "playwright";

// Accepts both "--key value" and bare "--flag" without swallowing the next token.
const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const token = process.argv[i];
  if (!token.startsWith("--")) continue;
  const next = process.argv[i + 1];
  if (next && !next.startsWith("--")) { args.set(token, next); i += 1; } else args.set(token, true);
}
const base = args.get("--base") ?? "http://127.0.0.1:3100";
const outDir = args.get("--out") ?? "/tmp/vognary-shots";
const signedInOnly = args.get("--signed-in-only") === true;
const wantSignedIn = signedInOnly || args.get("--signed-in") === true;
const freshAuth = args.get("--fresh-auth") === true;
const navTimeout = Number(args.get("--timeout") ?? 90_000);
// One theme ships, so one theme is captured. `--schemes light,dark` restores the
// old duplicate pass if a second theme is ever actually built.
const SCHEMES = typeof args.get("--schemes") === "string"
  ? args.get("--schemes").split(",").map((s) => s.trim()).filter(Boolean)
  : ["light"];
// Session cache lives under node_modules (gitignored) so a cookie never reaches a commit.
const authFile = typeof args.get("--auth") === "string" ? args.get("--auth") : "node_modules/.cache/vognary-auth.json";

const VIEWPORTS = [
  { name: "360", width: 360, height: 800 },
  { name: "390", width: 390, height: 844 },
  { name: "768", width: 768, height: 1024 },
  { name: "1024", width: 1024, height: 768 },
  { name: "1440", width: 1440, height: 900 },
];

const ROUTES = [
  ["landing", "/"],
  ["demo", "/demo"],
  ["start", "/start"],
  ["pay", "/pay"],
  ["login", "/login"],
  ["about", "/about"],
  ["contact", "/contact"],
  ["security", "/security"],
  ["privacy", "/privacy"],
  ["terms", "/terms"],
  ["offline", "/offline"],
  ["verify", "/verify"],
  ["brand", "/brand"],
  ["billing-return", "/billing/return"],
];

// Signed-in surfaces. Reached with a cached session so the login is paid once,
// not once per run. Workspace views are real in-page destinations, not routes.
const SIGNED_IN_ROUTES = [
  { slug: "workspace-today", route: "/app", view: "Today" },
  { slug: "workspace-control", route: "/app", view: "Decisions" },
  { slug: "workspace-bills", route: "/app", view: "Bills" },
  { slug: "workspace-sources", route: "/app", view: "Evidence" },
  { slug: "profile", route: "/profile" },
];

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const findings = [];

// Returns a storage-state path with a live session, or null when one cannot be obtained.
// A cached state is trusted only after it survives a real request to /app.
async function resolveSession() {
  if (!freshAuth && existsSync(authFile)) {
    const probe = await browser.newContext({ storageState: authFile });
    const page = await probe.newPage();
    const landed = await page.goto(`${base}/app`, { waitUntil: "domcontentloaded" }).catch(() => null);
    const stillValid = Boolean(landed) && new URL(page.url()).pathname.startsWith("/app");
    await probe.close();
    if (stillValid) return authFile;
  }

  const email = process.env.VOGNARY_E2E_DEV_LOGIN_EMAIL ?? process.env.DEVELOPMENT_LOGIN_EMAIL;
  const accessCode = process.env.VOGNARY_E2E_DEV_LOGIN_CODE ?? process.env.DEVELOPMENT_LOGIN_ACCESS_CODE;
  if (!email || !accessCode) {
    findings.push({ issue: "signed-in capture skipped: set VOGNARY_E2E_DEV_LOGIN_EMAIL and VOGNARY_E2E_DEV_LOGIN_CODE" });
    return null;
  }

  const context = await browser.newContext();
  // Spread the source IP the way the e2e suite does so repeat runs do not trip the login rate limit.
  await context.setExtraHTTPHeaders({ "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 180) + 50}` });
  const page = await context.newPage();
  try {
    await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    await page.getByText("Other ways to sign in").click();
    await page.getByPlaceholder("developer@example.com").fill(email);
    await page.getByPlaceholder("Access code").fill(accessCode);
    await page.getByRole("button", { name: "Sign in as developer" }).click();
    await page.waitForURL(/\/app/, { timeout: 15_000 });
  } catch (error) {
    findings.push({ issue: `development login failed: ${error instanceof Error ? error.message : String(error)}` });
    await context.close();
    return null;
  }
  await mkdir(dirname(authFile), { recursive: true });
  await context.storageState({ path: authFile });
  await context.close();
  return authFile;
}

const sessionPath = wantSignedIn ? await resolveSession() : null;

async function captureRoute(page, slug, route, vp, scheme, view) {
  const runtimeProblems = [];
  const onPageError = (error) => runtimeProblems.push(`pageerror: ${error.message}`);
  const onConsole = (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) {
      runtimeProblems.push(`console: ${message.text()}`);
    }
  };
  page.on("pageerror", onPageError);
  page.on("console", onConsole);
  // A dev server compiles each route on first hit, which can outlast the 30s default.
  // The real error is reported rather than swallowed, so a timeout is never mistaken for a broken page.
  let navError = null;
  const res = await page
    .goto(base + route, { waitUntil: "domcontentloaded", timeout: navTimeout })
    .catch((error) => { navError = error instanceof Error ? error.message.split("\n")[0] : String(error); return null; });
  if (!res || res.status() >= 400) {
    findings.push({ route, viewport: vp.name, scheme, issue: navError ?? `HTTP ${res?.status()}` });
    page.off("pageerror", onPageError);
    page.off("console", onConsole);
    return;
  }
  // The signed-in workspace polls, so networkidle never fires there. Wait for quiet when it
  // comes and move on when it does not, rather than failing a page that rendered fine.
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  if (view) {
    // Destination labels carry a live count ("Decisions (2)"), so an exact-name
    // match finds nothing the moment the queue is non-empty.
    const button = page.getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: new RegExp(`^${view}\\b`) });
    if (await button.count() === 0) {
      findings.push({ route, viewport: vp.name, scheme, issue: `${view} workspace view is unavailable` });
      page.off("pageerror", onPageError);
      page.off("console", onConsole);
      return;
    }
    await button.click();
    await page.waitForFunction((label) => {
      return [...document.querySelectorAll('nav[aria-label="Primary"] button')]
        .some((candidate) => candidate.textContent?.trim().startsWith(label) && candidate.getAttribute("aria-current") === "page");
    }, view);
  }
  await page.evaluate(async () => {
    const animations = [...document.querySelectorAll(".enter, .enter-list > *, .rise")]
      .flatMap((element) => element.getAnimations())
      .filter((animation) => animation.playState !== "finished");
    await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)));
  });
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
  if (runtimeProblems.length) findings.push({ route, viewport: vp.name, scheme, issue: "runtime errors", errors: runtimeProblems });
  page.off("pageerror", onPageError);
  page.off("console", onConsole);
}

let captured = 0;
// Vognary is deliberately one theme. There is no prefers-color-scheme rule in
// the codebase, so a "dark" pass produced a byte-identical duplicate of every
// artifact under a label implying two themes had been tested. The canonical set
// is light; dark is verified below as an assertion instead of as 85 more files.
for (const scheme of SCHEMES) {
  for (const vp of VIEWPORTS) {
    const contextOptions = {
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
      hasTouch: vp.width <= 1024,
      colorScheme: scheme,
      reducedMotion: "no-preference",
    };

    if (!signedInOnly) {
      const context = await browser.newContext(contextOptions);
      const page = await context.newPage();
      for (const [slug, route] of ROUTES) {
        await captureRoute(page, slug, route, vp, scheme);
        captured += 1;
      }
      await context.close();
    }

    if (!sessionPath) continue;
    const signedIn = await browser.newContext({ ...contextOptions, storageState: sessionPath });
    const signedInPage = await signedIn.newPage();
    for (const { slug, route, view } of SIGNED_IN_ROUTES) {
      await captureRoute(signedInPage, slug, route, vp, scheme, view);
      captured += 1;
    }
    await signedIn.close();
  }
}

// Proves the single-theme claim instead of asserting it in prose: render a
// sample under a dark OS preference and require pixel-identical output. This is
// what guards `color-scheme: light` and the absence of prefers-color-scheme.
// Light is captured twice first — a route that differs from itself across two
// loads (client-generated draft ids, timestamps) cannot testify about theming,
// so it is skipped rather than reported as drift.
let singleThemeCheck = null;
if (SCHEMES.length === 1 && SCHEMES[0] === "light" && !signedInOnly) {
  const sample = ROUTES.slice(0, 3);
  const shots = {};
  for (const pass of ["light", "light-control", "dark"]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      colorScheme: pass === "dark" ? "dark" : "light",
      reducedMotion: "no-preference",
    });
    const page = await context.newPage();
    for (const [slug, route] of sample) {
      await page.goto(base + route, { waitUntil: "domcontentloaded", timeout: navTimeout });
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      await page.evaluate(() => document.fonts.ready);
      shots[`${pass}:${slug}`] = await page.screenshot({ fullPage: false });
    }
    await context.close();
  }
  const stable = sample.filter(([slug]) => shots[`light:${slug}`].equals(shots[`light-control:${slug}`]));
  const skipped = sample.filter(([slug]) => !stable.some(([s]) => s === slug)).map(([slug]) => slug);
  const drift = stable
    .filter(([slug]) => !shots[`light:${slug}`].equals(shots[`dark:${slug}`]))
    .map(([slug]) => slug);
  const skipNote = skipped.length ? ` (${skipped.length} nondeterministic route(s) skipped: ${skipped.join(", ")})` : "";
  singleThemeCheck = drift.length
    ? `single-theme check FAILED: ${drift.join(", ")} render differently under a dark OS preference${skipNote}`
    : `single-theme check passed: ${stable.length} route(s) render identically under light and dark OS preference${skipNote}`;
  if (drift.length) process.exitCode = 1;
}

await browser.close();
console.log(`captured ${captured} screenshots to ${outDir}`);
console.log(`theme: single (light). schemes captured: ${SCHEMES.join(", ")}`);
if (singleThemeCheck) console.log(singleThemeCheck);
if (sessionPath) console.log(`signed-in surfaces used cached session ${authFile}`);
if (!findings.length) console.log("no layout or touch-target findings");
else {
  console.log(`\n${findings.length} findings:`);
  for (const f of findings) console.log(JSON.stringify(f));
  process.exitCode = 1;
}
