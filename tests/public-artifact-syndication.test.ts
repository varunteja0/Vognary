import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildPublicArtifactMarkdown,
  buildPublicArtifactsAtom,
  buildPublicArtifactsJsonFeed,
  publicArtifactMetadata,
  publicArtifacts,
} from "../src/lib/public-artifacts";
import { agentHomepageMarkdown, agentLinkHeader, llmsTxt } from "../src/lib/agent-content";
import { GET as getAtomFeed } from "../src/app/feed.xml/route";
import { GET as getJsonFeed } from "../src/app/feed.json/route";
import { GET as getDemoMarkdown } from "../src/app/demo.md/route";
import sitemap from "../src/app/sitemap";

const sitemapSource = readFileSync("src/app/sitemap.ts", "utf8");
const proxySource = readFileSync("src/proxy.ts", "utf8");
const demoPageSource = readFileSync("src/app/demo/page.tsx", "utf8");
const publicClaimsSource = readFileSync("scripts/check-public-claims.mjs", "utf8");

test("one canonical synthetic artifact drives JSON Feed and Atom", () => {
  assert.equal(publicArtifacts.length, 1);
  const [artifact] = publicArtifacts;
  assert.equal(artifact.url, "https://www.vognary.com/demo");
  assert.equal(artifact.markdownUrl, "https://www.vognary.com/demo.md");
  assert.equal(artifact.synthetic, true);
  assert.equal(artifact.writable, false);
  assert.equal(artifact.customerData, false);
  assert.equal(artifact.branches.length, 3);

  const jsonFeed = JSON.parse(buildPublicArtifactsJsonFeed()) as {
    version: string;
    feed_url: string;
    items: Array<{
      id: string;
      url: string;
      title: string;
      tags: string[];
      attachments: Array<{ url: string; mime_type: string }>;
    }>;
  };
  assert.equal(jsonFeed.version, "https://jsonfeed.org/version/1.1");
  assert.equal(jsonFeed.feed_url, "https://www.vognary.com/feed.json");
  assert.equal(jsonFeed.items.length, 1);
  assert.equal(jsonFeed.items[0].id, artifact.id);
  assert.equal(jsonFeed.items[0].url, artifact.url);
  assert.equal(jsonFeed.items[0].title, artifact.title);
  assert.ok(jsonFeed.items[0].tags.includes("synthetic"));
  assert.deepEqual(jsonFeed.items[0].attachments, [{
    url: artifact.markdownUrl,
    mime_type: "text/markdown",
  }]);

  const atom = buildPublicArtifactsAtom();
  assert.match(atom, /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/);
  assert.match(atom, new RegExp(`<id>${escapeRegExp(artifact.id)}</id>`));
  assert.match(atom, new RegExp(`<link href="${escapeRegExp(artifact.url)}"\/>`));
  assert.match(atom, new RegExp(`<link href="${escapeRegExp(artifact.markdownUrl)}" rel="alternate" type="text/markdown"\/>`));
  assert.match(atom, new RegExp(`<title>${escapeRegExp(artifact.title)}</title>`));
  assert.match(atom, /Synthetic demonstration/);
  assert.match(atom, /no customer data/i);
  assert.doesNotMatch(atom, /<script|<form/i);
});

test("sitemap, agent discovery, metadata, and proxy advertise the same artifact feeds", () => {
  assert.ok(sitemap().some((entry) => entry.url === "https://www.vognary.com/demo"));
  assert.match(sitemapSource, /\/demo/);
  assert.match(agentLinkHeader, /<\/feed\.json>; rel="alternate"; type="application\/feed\+json"/);
  assert.match(agentLinkHeader, /<\/feed\.xml>; rel="alternate"; type="application\/atom\+xml"/);
  assert.match(agentLinkHeader, /<\/demo\.md>; rel="alternate"; type="text\/markdown"/);

  for (const document of [agentHomepageMarkdown, llmsTxt]) {
    assert.match(document, /https:\/\/www\.vognary\.com\/demo/);
    assert.match(document, /https:\/\/www\.vognary\.com\/demo\.md/);
    assert.match(document, /https:\/\/www\.vognary\.com\/feed\.json/);
    assert.match(document, /https:\/\/www\.vognary\.com\/feed\.xml/);
    assert.doesNotMatch(document, /5[–-]100/);
    assert.doesNotMatch(document, /receipts prove (?:the )?outcome/i);
  }

  assert.match(demoPageSource, /publicArtifactJsonLd/);
  assert.match(proxySource, /demo\.md\|feed\.json\|feed\.xml/);
  assert.match(publicClaimsSource, /src\/lib\/public-artifacts\.ts/);
  assert.match(publicClaimsSource, /src\/app\/demo\/page\.tsx/);
});

test("the Markdown representation and demo metadata preserve one canonical artifact", async () => {
  const artifact = publicArtifacts[0];
  const markdown = buildPublicArtifactMarkdown(artifact);
  assert.match(markdown, new RegExp(`^# ${escapeRegExp(artifact.title)}`));
  assert.match(markdown, new RegExp(escapeRegExp(artifact.id)));
  assert.match(markdown, new RegExp(escapeRegExp(artifact.sourceIdentity.sourceHash)));
  assert.match(markdown, /Synthetic demonstration/);
  assert.match(markdown, /No customer data/);
  assert.match(markdown, /Read-only/);

  const response = getDemoMarkdown();
  assert.match(response.headers.get("content-type") ?? "", /^text\/markdown/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await response.text(), markdown);

  assert.equal(publicArtifactMetadata.title, `${artifact.title} | Vognary`);
  assert.equal(publicArtifactMetadata.alternates.canonical, "/demo");
  assert.deepEqual(publicArtifactMetadata.alternates.types, {
    "text/markdown": "/demo.md",
    "application/feed+json": "/feed.json",
    "application/atom+xml": "/feed.xml",
  });
});

test("feed route handlers return static, cacheable, no-sniff machine formats", async () => {
  const jsonResponse = getJsonFeed();
  assert.equal(jsonResponse.status, 200);
  assert.match(jsonResponse.headers.get("content-type") ?? "", /^application\/feed\+json/);
  assert.equal(jsonResponse.headers.get("x-content-type-options"), "nosniff");
  assert.match(jsonResponse.headers.get("cache-control") ?? "", /s-maxage=3600/);
  const jsonBody = JSON.parse(await jsonResponse.text()) as { items: Array<{ id: string }> };
  assert.equal(jsonBody.items[0].id, publicArtifacts[0].id);

  const atomResponse = getAtomFeed();
  assert.equal(atomResponse.status, 200);
  assert.match(atomResponse.headers.get("content-type") ?? "", /^application\/atom\+xml/);
  assert.equal(atomResponse.headers.get("x-content-type-options"), "nosniff");
  assert.match(atomResponse.headers.get("cache-control") ?? "", /s-maxage=3600/);
  assert.match(await atomResponse.text(), new RegExp(escapeRegExp(publicArtifacts[0].id)));
});

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}