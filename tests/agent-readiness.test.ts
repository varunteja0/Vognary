import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextRequest } from "next/server";

import { GET as getAgentHome } from "../src/app/api/agent-home/route";
import { GET as getLlmsTxt } from "../src/app/llms.txt/route";
import { preferredRepresentation } from "../src/lib/http-content-negotiation";
import { proxy } from "../src/proxy";

test("homepage negotiation honors q-values, specificity, wildcards, and explicit rejection", () => {
  assert.equal(preferredRepresentation(null), "text/html");
  assert.equal(preferredRepresentation("*/*"), "text/html");
  assert.equal(preferredRepresentation("text/markdown"), "text/markdown");
  assert.equal(preferredRepresentation("text/markdown, text/html"), "text/markdown");
  assert.equal(preferredRepresentation("text/html;q=1, text/markdown;q=0.5"), "text/html");
  assert.equal(preferredRepresentation("text/html;q=0, text/markdown;q=0.8"), "text/markdown");
  assert.equal(preferredRepresentation("text/markdown;q=0, text/*;q=1"), "text/html");
  assert.equal(preferredRepresentation("text/markdown;q=bogus"), null);
  assert.equal(preferredRepresentation("text/markdown;q=1.5, text/html;q=0.5"), "text/html");
  assert.equal(preferredRepresentation("text/markdown;q=0.1234, text/html;q=0.2"), "text/html");
  assert.equal(preferredRepresentation("application/pdf"), null);
  assert.equal(preferredRepresentation("text/html;q=0, text/markdown;q=0"), null);
});

test("homepage proxy advertises negotiation and rejects unsupported representations", async () => {
  const markdown = proxy(new NextRequest("https://www.vognary.com/", {
    headers: { accept: "text/markdown" },
  }));
  assert.match(markdown.headers.get("x-middleware-rewrite") ?? "", /\/api\/agent-home$/);
  assert.match(markdown.headers.get("vary") ?? "", /(?:^|,\s*)Accept(?:,|$)/i);

  const html = proxy(new NextRequest("https://www.vognary.com/", {
    headers: { accept: "text/html" },
  }));
  assert.match(html.headers.get("vary") ?? "", /(?:^|,\s*)Accept(?:,|$)/i);

  const rsc = proxy(new NextRequest("https://www.vognary.com/", {
    headers: { accept: "text/x-component", rsc: "1" },
  }));
  assert.equal(rsc.status, 200);
  assert.equal(rsc.headers.get("x-middleware-next"), "1");

  const unsupported = proxy(new NextRequest("https://www.vognary.com/", {
    headers: { accept: "application/pdf" },
  }));
  assert.equal(unsupported.status, 406);
  assert.equal(unsupported.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(unsupported.headers.get("vary"), "Accept");
  assert.match(await unsupported.text(), /Available: text\/html, text\/markdown/);

  const malformed = proxy(new NextRequest("https://www.vognary.com/", {
    headers: { accept: "text/markdown;q=bogus" },
  }));
  assert.equal(malformed.status, 406);
  assert.equal(malformed.headers.get("vary"), "Accept");

  const missing = proxy(new NextRequest("https://www.vognary.com/not-a-real-public-path", {
    headers: { accept: "text/markdown" },
  }));
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("content-type"), "text/markdown; charset=utf-8");
  assert.match(await missing.text(), /\[Agent guide\]\(https:\/\/www\.vognary\.com\/llms\.txt\)/);
});

test("homepage Markdown is useful, cache-safe, and linked to its agent guide", async () => {
  const response = await getAgentHome();
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/markdown; charset=utf-8");
  assert.equal(response.headers.get("vary"), "Accept");
  assert.match(response.headers.get("cache-control") ?? "", /s-maxage=3600/);
  assert.match(response.headers.get("link") ?? "", /<\/index\.md>; rel="alternate"; type="text\/markdown"/);
  assert.match(response.headers.get("link") ?? "", /<\/llms\.txt>; rel="describedby"/);
  assert.match(body, /^# Vognary/m);
  assert.match(body, /Commitment Intelligence/);
  assert.match(body, /## What Vognary does/);
  assert.match(body, /## Product boundaries/);
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
  const notFound = readFileSync("src/app/not-found.tsx", "utf8");
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    routes?: Array<{
      src?: string;
      continue?: boolean;
      transforms?: Array<{ type?: string; op?: string; target?: { key?: string }; args?: string }>;
    }>;
  };

  assert.match(page, /type="application\/ld\+json"/);
  assert.match(page, /"@type": "SoftwareApplication"/);
  assert.match(page, /applicationCategory: "BusinessApplication"/);
  assert.match(page, /operatingSystem: "Web"/);
  assert.match(notFound, /href="\/llms\.txt"/);
  assert.match(notFound, /href="\/sitemap\.xml"/);

  const rootRoute = vercel.routes?.find((route) => route.src === "^/$");
  assert.equal(rootRoute?.continue, true);
  assert.ok(rootRoute?.transforms?.some((transform) => (
    transform.type === "response.headers"
    && transform.op === "delete"
    && transform.target?.key?.toLowerCase() === "vary"
  )));
  const finalVary = rootRoute?.transforms?.find((transform) => (
    transform.type === "response.headers"
    && transform.op === "append"
    && transform.target?.key?.toLowerCase() === "vary"
  ))?.args ?? "";
  for (const token of ["Accept", "RSC", "Next-Router-State-Tree", "Next-Router-Prefetch", "Next-Router-Segment-Prefetch", "Accept-Encoding"]) {
    assert.ok(finalVary.split(",").map((value) => value.trim().toLowerCase()).includes(token.toLowerCase()), token);
  }
});