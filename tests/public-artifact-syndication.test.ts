import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildPublicArtifactJsonLd,
  buildPublicArtifactMarkdown,
  buildPublicArtifactMetadata,
  buildPublicArtifactSitemapEntries,
  buildPublicArtifactsAtom,
  buildPublicArtifactsJsonFeed,
  createPublicArtifactRegistry,
  publicArtifactDefinitions,
  publicArtifacts,
  syntheticDecisionArtifact,
} from "../src/lib/public-artifacts";
import {
  agentHomepageMarkdown,
  agentLinkHeader,
  buildPublicArtifactAgentIndexMarkdown,
  llmsTxt,
} from "../src/lib/agent-content";
import { syntheticDemoSourceManifest } from "../src/lib/synthetic-control-demo";
import { GET as getAtomFeed } from "../src/app/feed.xml/route";
import { GET as getJsonFeed } from "../src/app/feed.json/route";
import { GET as getDemoMarkdown } from "../src/app/demo.md/route";
import sitemap from "../src/app/sitemap";

const sitemapSource = readFileSync("src/app/sitemap.ts", "utf8");
const proxySource = readFileSync("src/proxy.ts", "utf8");
const demoPageSource = readFileSync("src/app/demo/page.tsx", "utf8");
const publicClaimsSource = readFileSync("scripts/check-public-claims.mjs", "utf8");

test("the canonical artifact publishes complete, independently verifiable revision bytes", () => {
  assert.equal(publicArtifacts.length, 1);
  const [artifact] = publicArtifacts;
  assert.equal(artifact, syntheticDecisionArtifact);
  assert.equal(artifact.slug, "synthetic-commitment-control-decision");
  assert.equal(artifact.url, "https://www.vognary.com/demo");
  assert.equal(artifact.markdownUrl, "https://www.vognary.com/demo.md");
  assert.equal(artifact.synthetic, true);
  assert.equal(artifact.writable, false);
  assert.equal(artifact.customerData, false);
  assert.equal(artifact.branches.length, 3);
  assert.equal(artifact.id, `urn:vognary:artifact:${artifact.slug}`);
  assert.match(artifact.revisionDigest, /^[a-f0-9]{64}$/);
  assert.equal(
    createHash("sha256").update(artifact.revisionManifest).digest("hex"),
    artifact.revisionDigest,
  );
  assert.equal(
    artifact.revisionUrl,
    `https://www.vognary.com/artifacts/${artifact.slug}/revisions/${artifact.revisionDigest}/manifest.json`,
  );

  const manifest = JSON.parse(artifact.revisionManifest) as {
    schemaVersion: string;
    artifact: { id: string; slug: string; representations: { html: string; markdown: string } };
    source: unknown;
    derived: { branches: unknown[] };
  };
  assert.equal(manifest.schemaVersion, "vognary.public-artifact-revision.v1");
  assert.equal(manifest.artifact.id, artifact.id);
  assert.equal(manifest.artifact.slug, artifact.slug);
  assert.equal(manifest.artifact.representations.html, artifact.url);
  assert.equal(manifest.artifact.representations.markdown, artifact.markdownUrl);
  assert.deepEqual(manifest.source, syntheticDemoSourceManifest);
  assert.equal(manifest.derived.branches.length, 3);

  const jsonFeed = JSON.parse(buildPublicArtifactsJsonFeed()) as {
    version: string;
    feed_url: string;
    items: Array<{
      id: string;
      url: string;
      title: string;
      tags: string[];
      date_published: string;
      date_modified: string;
      attachments: Array<{ url: string; mime_type: string }>;
    }>;
  };
  assert.equal(jsonFeed.version, "https://jsonfeed.org/version/1.1");
  assert.equal(jsonFeed.feed_url, "https://www.vognary.com/feed.json");
  assert.equal(jsonFeed.items.length, 1);
  assert.equal(jsonFeed.items[0].id, artifact.id);
  assert.equal(jsonFeed.items[0].url, artifact.url);
  assert.equal(jsonFeed.items[0].title, artifact.title);
  assert.equal(jsonFeed.items[0].date_published, artifact.publishedAt);
  assert.equal(jsonFeed.items[0].date_modified, artifact.modifiedAt);
  assert.ok(jsonFeed.items[0].tags.includes("synthetic"));
  assert.deepEqual(jsonFeed.items[0].attachments, [
    { url: artifact.markdownUrl, mime_type: "text/markdown" },
    { url: artifact.revisionUrl, mime_type: "application/json" },
  ]);

  const atom = buildPublicArtifactsAtom();
  assert.match(atom, /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/);
  assert.match(atom, /<author>\s*<name>Vognary<\/name>\s*<uri>https:\/\/www\.vognary\.com\/<\/uri>\s*<\/author>/);
  assert.match(atom, new RegExp(`<id>${escapeRegExp(artifact.id)}</id>`));
  assert.match(atom, new RegExp(`<link href="${escapeRegExp(artifact.url)}"\/>`));
  assert.match(atom, new RegExp(`<link href="${escapeRegExp(artifact.markdownUrl)}" rel="alternate" type="text/markdown"\/>`));
  assert.match(atom, new RegExp(`<link href="${escapeRegExp(artifact.revisionUrl)}" rel="related" type="application/json"\/>`));
  assert.match(atom, new RegExp(`<title>${escapeRegExp(artifact.title)}</title>`));
  assert.match(atom, /Synthetic demonstration/);
  assert.match(atom, /no customer data/i);
  assert.doesNotMatch(atom, /<script|<form/i);
});

test("logical identity stays stable while semantic revisions receive a new digest", () => {
  const definition = publicArtifactDefinitions[0];
  const original = createPublicArtifactRegistry([definition]).artifacts[0];
  const revised = createPublicArtifactRegistry([{
    ...definition,
    summary: `${definition.summary} Revised wording.`,
    modifiedAt: "2026-09-04T00:00:00.001Z",
  }]).artifacts[0];

  assert.equal(revised.id, original.id);
  assert.equal(revised.publishedAt, original.publishedAt);
  assert.notEqual(revised.modifiedAt, original.modifiedAt);
  assert.notEqual(revised.revisionDigest, original.revisionDigest);
  assert.notEqual(revised.revisionUrl, original.revisionUrl);
});

test("a two-item registry drives feeds, sitemap, metadata, Markdown, manifests, and agent discovery", () => {
  const definition = publicArtifactDefinitions[0];
  const registry = createPublicArtifactRegistry([
    definition,
    {
      ...definition,
      slug: "synthetic-commitment-control-decision-copy",
      title: "Second Synthetic Decision Record",
      summary: "An in-memory synthetic registry fixture used only to prove plural publication paths.",
      publishedAt: "2026-09-04T00:00:00.000Z",
      modifiedAt: "2026-09-04T00:00:00.000Z",
      canonicalPaths: undefined,
    },
  ]);
  const jsonFeed = JSON.parse(buildPublicArtifactsJsonFeed(registry.artifacts)) as {
    items: Array<{ id: string; url: string; attachments: Array<{ url: string }> }>;
  };
  const atom = buildPublicArtifactsAtom(registry.artifacts);
  const artifactSitemap = buildPublicArtifactSitemapEntries(registry.artifacts);
  const agentIndex = buildPublicArtifactAgentIndexMarkdown(registry.artifacts);

  assert.equal(registry.artifacts.length, 2);
  assert.equal(jsonFeed.items.length, 2);

  for (const item of jsonFeed.items) {
    const artifact = registry.getByUrl(item.url);
    assert.ok(artifact);
    assert.equal(item.id, artifact.id);
    assert.deepEqual(item.attachments.map((entry) => entry.url), [artifact.markdownUrl, artifact.revisionUrl]);
    assert.ok(artifactSitemap.some((entry) => entry.url === artifact.url));
    assert.match(agentIndex, new RegExp(escapeRegExp(artifact.url)));
    assert.match(agentIndex, new RegExp(escapeRegExp(artifact.markdownUrl)));
    assert.match(agentIndex, new RegExp(escapeRegExp(artifact.revisionUrl)));
    assert.match(atom, new RegExp(escapeRegExp(artifact.id)));

    const metadata = buildPublicArtifactMetadata(artifact);
    assert.equal(metadata.alternates.canonical, new URL(artifact.url).pathname);
    assert.equal(metadata.alternates.types["text/markdown"], new URL(artifact.markdownUrl).pathname);
    assert.equal(buildPublicArtifactJsonLd(artifact)["@id"], `${artifact.url}#artifact`);

    const markdown = buildPublicArtifactMarkdown(artifact);
    assert.match(markdown, new RegExp(escapeRegExp(artifact.id)));
    assert.match(markdown, new RegExp(escapeRegExp(artifact.revisionDigest)));
    assert.match(markdown, new RegExp(escapeRegExp(artifact.revisionUrl)));

    const manifest = JSON.parse(artifact.revisionManifest) as { artifact: { id: string } };
    assert.equal(manifest.artifact.id, artifact.id);
    assert.equal(registry.getBySlug(artifact.slug)?.revisionDigest, artifact.revisionDigest);
  }
});

test("registry validation rejects ambiguous identity and unsafe timestamps", () => {
  const definition = publicArtifactDefinitions[0];

  assert.throws(
    () => createPublicArtifactRegistry([definition, { ...definition }]),
    /duplicate artifact slug/i,
  );
  assert.throws(
    () => createPublicArtifactRegistry([{ ...definition, modifiedAt: "2026-09-04T00:00:00Z\"><script>" }]),
    /modifiedAt.*RFC 3339 UTC/i,
  );
  assert.throws(
    () => createPublicArtifactRegistry([{
      ...definition,
      publishedAt: "2026-09-04T00:00:00.001Z",
      modifiedAt: "2026-09-04T00:00:00.000Z",
    }]),
    /modifiedAt.*before publishedAt/i,
  );
});

test("Atom and Markdown escape HTML-significant artifact text", () => {
  const definition = publicArtifactDefinitions[0];
  const [artifact] = createPublicArtifactRegistry([{
    ...definition,
    title: "<script>alert(1)</script>",
    summary: "<b>synthetic only</b>",
  }]).artifacts;
  const atom = buildPublicArtifactsAtom([artifact]);
  const markdown = buildPublicArtifactMarkdown(artifact);

  assert.doesNotMatch(atom, /<script>|<b>/);
  assert.match(atom, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(markdown, /<script>|<b>/);
  assert.match(markdown, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(markdown, /&lt;b&gt;synthetic only&lt;\/b&gt;/);
});

test("sitemap, agent discovery, metadata, and proxy advertise the canonical registry", () => {
  const artifact = syntheticDecisionArtifact;
  assert.ok(sitemap().some((entry) => entry.url === artifact.url));
  assert.match(sitemapSource, /buildPublicArtifactSitemapEntries/);
  assert.match(agentLinkHeader, /<\/feed\.json>; rel="alternate"; type="application\/feed\+json"/);
  assert.match(agentLinkHeader, /<\/feed\.xml>; rel="alternate"; type="application\/atom\+xml"/);
  assert.match(agentLinkHeader, /<\/demo\.md>; rel="related"; type="text\/markdown"/);

  for (const document of [agentHomepageMarkdown, llmsTxt]) {
    assert.match(document, new RegExp(escapeRegExp(artifact.url)));
    assert.match(document, new RegExp(escapeRegExp(artifact.markdownUrl)));
    assert.match(document, new RegExp(escapeRegExp(artifact.revisionUrl)));
    assert.match(document, /https:\/\/www\.vognary\.com\/feed\.json/);
    assert.match(document, /https:\/\/www\.vognary\.com\/feed\.xml/);
    assert.doesNotMatch(document, /5[–-]100/);
    assert.doesNotMatch(document, /receipts prove (?:the )?outcome/i);
  }

  assert.match(demoPageSource, /publicArtifactJsonLd/);
  assert.match(proxySource, /\/artifacts\//);
  assert.match(publicClaimsSource, /src\/lib\/public-artifacts\.ts/);
  assert.match(publicClaimsSource, /src\/lib\/synthetic-control-demo\.ts/);
  assert.match(publicClaimsSource, /src\/lib\/synthetic-fixture-identity\.ts/);
  assert.match(publicClaimsSource, /src\/lib\/commitment-control-loop\.ts/);
  assert.match(publicClaimsSource, /src\/app\/demo\/page\.tsx/);
  assert.match(publicClaimsSource, /generatedPublicSurfaces/);
  assert.match(publicClaimsSource, /buildPublicArtifactsJsonFeed/);
  assert.match(publicClaimsSource, /buildPublicArtifactsAtom/);
  assert.match(publicClaimsSource, /buildPublicArtifactMarkdown/);
});

test("the Markdown representation and demo metadata preserve one canonical artifact", async () => {
  const artifact = syntheticDecisionArtifact;
  const markdown = buildPublicArtifactMarkdown(artifact);
  assert.match(markdown, new RegExp(`^# ${escapeRegExp(artifact.title)}`));
  assert.match(markdown, new RegExp(escapeRegExp(artifact.id)));
  assert.match(markdown, new RegExp(escapeRegExp(artifact.revisionDigest)));
  assert.match(markdown, /Synthetic demonstration/);
  assert.match(markdown, /No customer data/);
  assert.match(markdown, /Read-only/);

  const response = getDemoMarkdown();
  assert.match(response.headers.get("content-type") ?? "", /^text\/markdown/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await response.text(), markdown);

  const metadata = buildPublicArtifactMetadata(artifact);
  assert.equal(metadata.title, artifact.title);
  assert.doesNotMatch(metadata.title, /Vognary/);
  assert.equal(metadata.alternates.canonical, "/demo");
  assert.deepEqual(metadata.alternates.types, {
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
  assert.equal(jsonBody.items[0].id, syntheticDecisionArtifact.id);

  const atomResponse = getAtomFeed();
  assert.equal(atomResponse.status, 200);
  assert.match(atomResponse.headers.get("content-type") ?? "", /^application\/atom\+xml/);
  assert.equal(atomResponse.headers.get("x-content-type-options"), "nosniff");
  assert.match(atomResponse.headers.get("cache-control") ?? "", /s-maxage=3600/);
  assert.match(await atomResponse.text(), new RegExp(escapeRegExp(syntheticDecisionArtifact.id)));
});

test("generic artifact routes resolve registry slugs and exact revision bytes", async () => {
  const markdownRoute = await import("../src/app/artifacts/[slug]/markdown/route");
  const manifestRoute = await import("../src/app/artifacts/[slug]/revisions/[digest]/manifest.json/route");
  const artifact = syntheticDecisionArtifact;

  assert.deepEqual(markdownRoute.generateStaticParams(), [{ slug: artifact.slug }]);
  const markdownResponse = await markdownRoute.GET(
    new Request(`https://www.vognary.com/artifacts/${artifact.slug}/markdown?ignored=1`),
    { params: Promise.resolve({ slug: artifact.slug }) },
  );
  assert.equal(markdownResponse.status, 200);
  assert.match(markdownResponse.headers.get("content-type") ?? "", /^text\/markdown/);
  assert.equal(markdownResponse.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await markdownResponse.text(), buildPublicArtifactMarkdown(artifact));

  const missingMarkdownResponse = await markdownRoute.GET(
    new Request("https://www.vognary.com/artifacts/missing/markdown"),
    { params: Promise.resolve({ slug: "missing" }) },
  );
  assert.equal(missingMarkdownResponse.status, 404);
  assert.equal(missingMarkdownResponse.headers.get("cache-control"), "private, no-store");

  assert.deepEqual(manifestRoute.generateStaticParams(), [{
    slug: artifact.slug,
    digest: artifact.revisionDigest,
  }]);
  const manifestResponse = await manifestRoute.GET(
    new Request(`${artifact.revisionUrl}?ignored=1`),
    { params: Promise.resolve({ slug: artifact.slug, digest: artifact.revisionDigest }) },
  );
  assert.equal(manifestResponse.status, 200);
  assert.match(manifestResponse.headers.get("content-type") ?? "", /^application\/json/);
  assert.equal(manifestResponse.headers.get("x-content-type-options"), "nosniff");
  assert.match(manifestResponse.headers.get("cache-control") ?? "", /immutable/);
  assert.equal(manifestResponse.headers.get("etag"), `"sha256-${artifact.revisionDigest}"`);
  assert.equal(await manifestResponse.text(), artifact.revisionManifest);

  const staleManifestResponse = await manifestRoute.GET(
    new Request(`${artifact.revisionUrl.replace(artifact.revisionDigest, "0".repeat(64))}`),
    { params: Promise.resolve({ slug: artifact.slug, digest: "0".repeat(64) }) },
  );
  assert.equal(staleManifestResponse.status, 404);

  const pageSource = readFileSync("src/app/artifacts/[slug]/page.tsx", "utf8");
  assert.match(pageSource, /generateStaticParams/);
  assert.match(pageSource, /generateMetadata/);
  assert.match(pageSource, /await params/);
  assert.match(pageSource, /buildPublicArtifactJsonLd/);
  assert.match(pageSource, /publicArtifactRegistry\.getBySlug/);

  const demoMarkdownSource = readFileSync("src/app/demo.md/route.ts", "utf8");
  assert.match(demoMarkdownSource, /syntheticDecisionArtifact/);
  assert.doesNotMatch(demoMarkdownSource, /publicArtifacts\[0\]/);
});

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}