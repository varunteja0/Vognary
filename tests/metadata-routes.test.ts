import assert from "node:assert/strict";
import test from "node:test";

import robots from "../src/app/robots";
import sitemap from "../src/app/sitemap";

test("robots lets crawlers observe page-level noindex and advertises the canonical sitemap", () => {
  const metadata = robots();
  assert.equal(metadata.sitemap, "https://www.vognary.com/sitemap.xml");
  assert.equal(metadata.host, "https://www.vognary.com");
  assert.deepEqual(metadata.rules, {
    userAgent: "*",
    allow: "/",
    disallow: ["/api/"],
  });
});

test("sitemap contains only canonical public pages", () => {
  const entries = sitemap();
  const urls = entries.map((entry) => entry.url);
  assert.ok(urls.includes("https://www.vognary.com/"));
  for (const forbidden of ["/app", "/login", "/profile", "/billing/return", "/private-audit", "/connect", "/integrations", "/launch", "/start"]) {
    assert.equal(urls.some((url) => new URL(url).pathname === forbidden), false, forbidden);
  }
});
