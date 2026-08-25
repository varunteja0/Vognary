import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextRequest } from "next/server";

import { GET as getAgentHome } from "../src/app/api/agent-home/route";
import { GET as getLlmsTxt } from "../src/app/llms.txt/route";
import { proxy } from "../src/proxy";

test("homepage has one representation and advertises explicit agent routes", () => {
  const markdownRequest = proxy(new NextRequest("https://www.vognary.com/", {
    headers: { accept: "text/markdown" },
  }));
  assert.equal(markdownRequest.headers.get("x-middleware-next"), "1");
  assert.equal(markdownRequest.headers.get("x-middleware-rewrite"), null);
  assert.match(markdownRequest.headers.get("link") ?? "", /<\/index\.md>; rel="alternate"; type="text\/markdown"/);

  const html = proxy(new NextRequest("https://www.vognary.com/", {
    headers: { accept: "text/html" },
  }));
  assert.equal(html.headers.get("x-middleware-next"), "1");

  const unsupported = proxy(new NextRequest("https://www.vognary.com/", {
    headers: { accept: "application/pdf" },
  }));
  assert.equal(unsupported.status, 200);
  assert.equal(unsupported.headers.get("x-middleware-next"), "1");

  const explicitMarkdown = proxy(new NextRequest("https://www.vognary.com/index.md", {
    headers: { accept: "text/markdown" },
  }));
  assert.match(explicitMarkdown.headers.get("x-middleware-rewrite") ?? "", /\/api\/agent-home$/);

  const missingForAgent = proxy(new NextRequest("https://www.vognary.com/not-a-real-public-path", {
    headers: { accept: "text/markdown" },
  }));
  assert.equal(missingForAgent.status, 404);
  assert.equal(missingForAgent.headers.get("content-type"), "text/markdown; charset=utf-8");
  assert.equal(missingForAgent.headers.get("cache-control"), "private, no-store");
  assert.equal(missingForAgent.headers.get("vary"), "Accept");

  const missingForCurl = proxy(new NextRequest("https://www.vognary.com/not-a-real-public-path", {
    headers: { accept: "*/*" },
  }));
  assert.equal(missingForCurl.status, 404);
  assert.equal(missingForCurl.headers.get("content-type"), "text/markdown; charset=utf-8");

  const missingForBrowser = proxy(new NextRequest("https://www.vognary.com/not-a-real-public-path", {
    headers: { accept: "text/html,application/xhtml+xml" },
  }));
  assert.equal(missingForBrowser.headers.get("x-middleware-next"), "1");
});

test("homepage Markdown is useful, cache-safe, and linked to its agent guide", async () => {
  const response = await getAgentHome();
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/markdown; charset=utf-8");
  assert.equal(response.headers.get("vary"), null);
  assert.match(response.headers.get("cache-control") ?? "", /s-maxage=3600/);
  assert.match(response.headers.get("link") ?? "", /<\/index\.md>; rel="alternate"; type="text\/markdown"/);
  assert.match(response.headers.get("link") ?? "", /<\/llms\.txt>; rel="describedby"/);
  assert.match(body, /^# Vognary/m);
  assert.match(body, /Commitment Intelligence/);
  assert.match(body, /## What Vognary does/);
  assert.match(body, /## Product boundaries/);
  assert.match(body, /\[About Vognary\]\(https:\/\/www\.vognary\.com\/about\)/);
  assert.ok(body.length >= 500, `expected at least 500 Markdown characters, received ${body.length}`);
  assert.doesNotMatch(body, /verified savings|Gmail (?:connect|sync)|automatically cancels/i);
});

test("llms.txt follows the v2 shape and tells agents when and how to use Vognary", async () => {
  const response = await getLlmsTxt();
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.match(response.headers.get("cache-control") ?? "", /s-maxage=3600/);
  assert.match(body, /^# Vognary\n\n> /);
  assert.match(body, /\*\*When to use Vognary\*\*/);
  assert.match(body, /\*\*How to use Vognary\*\*/);
  assert.match(body, /## Core/);
  assert.match(body, /- \[Homepage in Markdown\]\(https:\/\/www\.vognary\.com\/index\.md\):/);
  assert.match(body, /## Trust and policies/);
  assert.match(body, /## Optional/);
  assert.doesNotMatch(body, /^#{3,} /m);
  assert.doesNotMatch(body, /verified savings|Gmail (?:connect|sync)|automatically cancels/i);
});

test("homepage identity and 404 recovery are machine-readable without changing the visual product", () => {
  const page = readFileSync("src/app/page.tsx", "utf8");
  const about = readFileSync("src/app/about/page.tsx", "utf8");
  const notFound = readFileSync("src/app/not-found.tsx", "utf8");

  assert.match(page, /type="application\/ld\+json"/);
  assert.match(page, /"@type": "SoftwareApplication"/);
  assert.match(page, /applicationCategory: "BusinessApplication"/);
  assert.match(page, /operatingSystem: "Web"/);
  assert.match(page, /contactPoint:/);
  assert.match(page, /"@type": "PostalAddress"/);
  assert.match(page, /addressCountry: "IN"/);
  assert.match(about, /Commitment Intelligence, built around evidence/);
  assert.ok(about.length >= 2_000, `expected a substantive About source, received ${about.length} characters`);
  assert.match(notFound, /href="\/llms\.txt"/);
  assert.match(notFound, /href="\/sitemap\.xml"/);
});