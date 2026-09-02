import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { agentHomepageMarkdown, llmsTxt } from "../src/lib/agent-content";

/**
 * Every public page must be reachable by an agent, a crawler and an RSC
 * prefetch — not only by a browser sending `Accept: text/html`.
 *
 * `src/proxy.ts` answers a negotiated Markdown 404 for any path outside
 * `publicPagePaths`. A page missing from that set still renders for a person,
 * so the defect is invisible until a `<Link>` prefetch logs a 404 in the
 * console. This test closes that gap by deriving the routes from the file
 * system instead of trusting the list.
 */

const APP_ROOT = path.resolve(import.meta.dirname, "../src/app");
const proxySource = readFileSync("src/proxy.ts", "utf8");

/** Route groups, private folders, dynamic segments and API handlers are out of scope. */
function collectPageRoutes(dir: string, prefix = ""): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (!statSync(full).isDirectory()) {
      if (entry === "page.tsx") routes.push(prefix === "" ? "/" : prefix);
      continue;
    }
    if (entry.startsWith("_") || entry.startsWith("(") || entry.startsWith("[") || entry === "api") continue;
    routes.push(...collectPageRoutes(full, `${prefix}/${entry}`));
  }
  return routes;
}

function declaredPublicPagePaths(): string[] {
  const block = proxySource.match(/const publicPagePaths = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(block, "publicPagePaths must stay a literal set so it can be verified statically");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

// Routes deliberately excluded: they are not public pages an agent should index.
const NON_PUBLIC_PAGES = new Set([
  "/app",
  "/login",
  "/profile",
  "/billing/return",
]);

test("every public page route is registered for agent content negotiation", () => {
  const declared = new Set(declaredPublicPagePaths());
  const missing = collectPageRoutes(APP_ROOT)
    .filter((route) => !NON_PUBLIC_PAGES.has(route))
    .filter((route) => !declared.has(route));

  assert.deepEqual(
    missing,
    [],
    `These pages render for a browser but answer a Markdown 404 to agents and RSC prefetches.\n`
    + `Add them to publicPagePaths in src/proxy.ts:\n${missing.map((route) => `  ${route}`).join("\n")}`,
  );
});

test("the registry never claims a route that has no page", () => {
  const routes = new Set(collectPageRoutes(APP_ROOT));
  // security.txt is served from public/, not from a page.
  const fileBacked = new Set([...routes, "/.well-known/security.txt"]);
  const orphans = declaredPublicPagePaths().filter((route) => !fileBacked.has(route));
  assert.deepEqual(orphans, [], `publicPagePaths lists paths with no page: ${orphans.join(", ")}`);
});

test("the synthetic demonstration is a public page, not a signed-in surface", () => {
  assert.ok(declaredPublicPagePaths().includes("/demo"));
  assert.ok(!NON_PUBLIC_PAGES.has("/demo"));
});

test("agent guides send readers to the explicit demonstration, never a retired homepage anchor", () => {
  for (const document of [agentHomepageMarkdown, llmsTxt]) {
    assert.doesNotMatch(document, /#example-decision|Guest authorization desk|working authorization desk/i);
    assert.match(document, /https:\/\/www\.vognary\.com\/demo/);
  }
});
