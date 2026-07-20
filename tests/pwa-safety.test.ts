import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("installable workspace starts on the canonical production route", async () => {
  const manifest = await readFile(new URL("../src/app/manifest.ts", import.meta.url), "utf8");
  assert.match(manifest, /id: "\/app"/);
  assert.match(manifest, /start_url: "\/app"/);
  assert.match(manifest, /icon-maskable-512\.png/);
  assert.doesNotMatch(manifest, /demo/i);
  const layout = await readFile(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
  const startupRoute = await readFile(new URL("../src/app/pwa/startup/[size]/route.tsx", import.meta.url), "utf8");
  assert.match(layout, /appleWebApp/);
  assert.match(layout, /apple-touch|startup\/1170x2532/);
  assert.match(startupRoute, /allowedSizes/);
  assert.match(startupRoute, /cache-control/);
});

test("service worker never caches financial navigation or APIs", async () => {
  const worker = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.match(worker, /request\.mode === "navigate"/);
  assert.match(worker, /fetch\(request\)\.catch\(\(\) => caches\.match\(OFFLINE_URL\)\)/);
  assert.match(worker, /\/_next\/static\//);
  assert.match(worker, /\/(brand|pwa)\//);
  assert.doesNotMatch(worker, /startsWith\("\/api\/"\)/);
  assert.doesNotMatch(worker, /INSTALL_ASSETS[\s\S]*"\/app"/);
  assert.doesNotMatch(worker, /cache\.put\(request[\s\S]*request\.mode === "navigate"/);
});

test("the workspace offers installation only after a proven ledger and keeps financial pages network-only", async () => {
  const workspace = await readFile(new URL("../src/app/vognary-mvp-client.tsx", import.meta.url), "utf8");
  assert.match(workspace, /beforeinstallprompt/);
  assert.match(workspace, /hasRealData && installPromptAvailable/);
  assert.match(workspace, /Install Vognary/);
  const worker = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.match(worker, /request\.mode === "navigate"[\s\S]*fetch\(request\)\.catch/);
  assert.doesNotMatch(worker, /cache\.put\(request[\s\S]*request\.mode === "navigate"/);
});
