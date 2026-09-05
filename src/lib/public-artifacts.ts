import { createHash } from "node:crypto";

import { COMMITMENT_CONTROL_STEPS } from "@/lib/commitment-control-loop";
import {
  SYNTHETIC_DEMO_LABEL,
  syntheticDemoBranchLabels,
  syntheticDemoBranchOrder,
  syntheticDemoBranchOutcomes,
  syntheticDemoDecision,
  syntheticDemoEvaluation,
  syntheticDemoProjection,
  syntheticDemoReconciliation,
  syntheticDemoSourceManifest,
} from "@/lib/synthetic-control-demo";

const origin = "https://www.vognary.com";
const artifactAuthor = { name: "Vognary", url: `${origin}/` } as const;
const canonicalTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const artifactSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type PublicArtifactBranch = {
  readonly id: (typeof syntheticDemoBranchOrder)[number];
  readonly label: string;
  readonly outcome: string;
};

export type PublicArtifactDefinition = {
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly publishedAt: string;
  readonly modifiedAt: string;
  readonly author: { readonly name: string; readonly url: string };
  readonly tags: readonly string[];
  readonly synthetic: true;
  readonly writable: false;
  readonly customerData: false;
  readonly source: typeof syntheticDemoSourceManifest;
  readonly steps: readonly string[];
  readonly branches: readonly PublicArtifactBranch[];
  readonly derivedFacts: unknown;
  readonly canonicalPaths?: {
    readonly html: string;
    readonly markdown: string;
  } | undefined;
};

export type PublicArtifact = PublicArtifactDefinition & {
  readonly id: string;
  readonly url: string;
  readonly markdownUrl: string;
  readonly revisionUrl: string;
  readonly revisionDigest: string;
  readonly revisionManifest: string;
};

export type PublicArtifactRegistry = {
  readonly artifacts: readonly PublicArtifact[];
  readonly getBySlug: (slug: string) => PublicArtifact | undefined;
  readonly getByUrl: (url: string) => PublicArtifact | undefined;
};

const syntheticDecisionBranches = syntheticDemoBranchOrder.map((branch) => ({
  id: branch,
  label: syntheticDemoBranchLabels[branch],
  outcome: syntheticDemoBranchOutcomes[branch],
}));

export const publicArtifactDefinitions: readonly PublicArtifactDefinition[] = [{
  slug: "synthetic-commitment-control-decision",
  title: "AI Spend Approval Policy and Decision Record — Synthetic Example",
  summary:
    "A read-only synthetic record showing cited exposure, a user-entered proposal and outcome target, deterministic policy context, three human decision branches, an immutable cap and expiry, and later observed-cost reconciliation. It contains no customer data and performs no action.",
  publishedAt: "2026-09-04T00:00:00.000Z",
  modifiedAt: "2026-09-04T00:00:00.000Z",
  author: artifactAuthor,
  tags: ["commitment-control", "human-authorization", "synthetic"],
  synthetic: true,
  writable: false,
  customerData: false,
  source: syntheticDemoSourceManifest,
  steps: COMMITMENT_CONTROL_STEPS,
  branches: syntheticDecisionBranches,
  derivedFacts: {
    projection: syntheticDemoProjection,
    evaluation: syntheticDemoEvaluation,
    branchRecords: syntheticDemoBranchOrder.map((branch) => ({
      branch,
      decision: syntheticDemoDecision(branch),
      reconciliation: syntheticDemoReconciliation(branch),
    })),
  },
  canonicalPaths: {
    html: "/demo",
    markdown: "/demo.md",
  },
}];

export function createPublicArtifactRegistry(
  definitions: readonly PublicArtifactDefinition[],
): PublicArtifactRegistry {
  const bySlug = new Map<string, PublicArtifact>();
  const byUrl = new Map<string, PublicArtifact>();
  const artifacts = definitions.map((definition) => {
    validateDefinition(definition);
    if (bySlug.has(definition.slug)) {
      throw new Error(`Duplicate artifact slug: ${definition.slug}`);
    }

    const artifact = buildPublicArtifact(definition);
    if (byUrl.has(artifact.url)) {
      throw new Error(`Duplicate artifact URL: ${artifact.url}`);
    }
    bySlug.set(artifact.slug, artifact);
    byUrl.set(artifact.url, artifact);
    return artifact;
  });

  return {
    artifacts,
    getBySlug: (slug) => bySlug.get(slug),
    getByUrl: (url) => byUrl.get(url),
  };
}

export const publicArtifactRegistry = createPublicArtifactRegistry(publicArtifactDefinitions);
export const publicArtifacts = publicArtifactRegistry.artifacts;
export const syntheticDecisionArtifact = requiredArtifact(
  publicArtifactRegistry.getBySlug("synthetic-commitment-control-decision"),
);

export function buildPublicArtifactJsonLd(artifact: PublicArtifact) {
  return {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    "@id": `${artifact.url}#artifact`,
    name: artifact.title,
    url: artifact.url,
    description: artifact.summary,
    datePublished: artifact.publishedAt,
    dateModified: artifact.modifiedAt,
    author: {
      "@type": "Organization",
      name: artifact.author.name,
      url: artifact.author.url,
    },
    isPartOf: {
      "@type": "WebSite",
      "@id": `${origin}/#website`,
      name: "Vognary",
      url: `${origin}/`,
    },
    about: artifact.tags,
    learningResourceType: "Synthetic decision record",
    inLanguage: "en-IN",
    conditionsOfAccess: "Public read-only synthetic demonstration; no customer data.",
  } as const;
}

export function buildPublicArtifactMetadata(artifact: PublicArtifact) {
  return {
    title: artifact.title,
    description: artifact.summary,
    alternates: {
      canonical: new URL(artifact.url).pathname,
      types: {
        "text/markdown": new URL(artifact.markdownUrl).pathname,
        "application/feed+json": "/feed.json",
        "application/atom+xml": "/feed.xml",
      },
    },
  } as const;
}

export const publicArtifactJsonLd = buildPublicArtifactJsonLd(syntheticDecisionArtifact);
export const publicArtifactMetadata = buildPublicArtifactMetadata(syntheticDecisionArtifact);

export function buildPublicArtifactsJsonFeed(
  artifacts: readonly PublicArtifact[] = publicArtifacts,
): string {
  return JSON.stringify({
    version: "https://jsonfeed.org/version/1.1",
    title: "Vognary public decision artifacts",
    home_page_url: artifacts[0]?.url ?? `${origin}/`,
    feed_url: `${origin}/feed.json`,
    description:
      "Read-only Vognary artifacts for human-authorized AI, cloud, and software commitment decisions.",
    language: "en-IN",
    items: artifacts.map((artifact) => ({
      id: artifact.id,
      url: artifact.url,
      title: artifact.title,
      summary: artifact.summary,
      content_text: formatArtifactText(artifact),
      date_published: artifact.publishedAt,
      date_modified: artifact.modifiedAt,
      authors: [artifact.author],
      tags: artifact.tags,
      attachments: [{
        url: artifact.markdownUrl,
        mime_type: "text/markdown",
      }, {
        url: artifact.revisionUrl,
        mime_type: "application/json",
      }],
    })),
  }, null, 2);
}

export function buildPublicArtifactsAtom(
  artifacts: readonly PublicArtifact[] = publicArtifacts,
): string {
  const feedUpdatedAt = latestArtifactUpdate(artifacts);
  const entries = artifacts.map((artifact) => `  <entry>
    <id>${escapeXml(artifact.id)}</id>
    <title>${escapeXml(artifact.title)}</title>
    <published>${escapeXml(artifact.publishedAt)}</published>
    <updated>${escapeXml(artifact.modifiedAt)}</updated>
    <link href="${escapeXml(artifact.url)}"/>
    <link href="${escapeXml(artifact.markdownUrl)}" rel="alternate" type="text/markdown"/>
    <link href="${escapeXml(artifact.revisionUrl)}" rel="related" type="application/json"/>
    <summary type="text">${escapeXml(`${SYNTHETIC_DEMO_LABEL}. ${artifact.summary}`)}</summary>
${artifact.tags.map((tag) => `    <category term="${escapeXml(tag)}"/>`).join("\n")}
  </entry>`).join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${escapeXml(`${origin}/feed.xml`)}</id>
  <title>Vognary public decision artifacts</title>
  <updated>${escapeXml(feedUpdatedAt)}</updated>
  <author>
    <name>${escapeXml(artifactAuthor.name)}</name>
    <uri>${escapeXml(artifactAuthor.url)}</uri>
  </author>
  <link href="${escapeXml(`${origin}/feed.xml`)}" rel="self" type="application/atom+xml"/>
  <link href="${escapeXml(artifacts[0]?.url ?? `${origin}/`)}"/>
${entries}
</feed>\n`;
}

export function buildPublicArtifactMarkdown(artifact: PublicArtifact): string {
  const steps = artifact.steps
    .map((step, index) => `${index + 1}. ${escapeMarkdownText(step)}`)
    .join("\n");
  const branches = artifact.branches
    .map((branch) => `### ${escapeMarkdownText(branch.label)}\n\n${escapeMarkdownText(branch.outcome)}`)
    .join("\n\n");

  return `# ${escapeMarkdownText(artifact.title)}

> ${SYNTHETIC_DEMO_LABEL}. No customer data. Read-only; Vognary does not execute a transaction or obligation.

${escapeMarkdownText(artifact.summary)}

## Artifact identity

- Artifact ID: \`${artifact.id}\`
- Revision SHA-256: \`${artifact.revisionDigest}\`
- Revision manifest: ${artifact.revisionUrl}
- Canonical URL: ${artifact.url}
- Published: \`${artifact.publishedAt}\`
- Modified: \`${artifact.modifiedAt}\`
- Source schema: \`${artifact.source.schemaVersion}\`
- Fixture: \`${artifact.source.fixtureId}\`
- Fixture version: \`${artifact.source.fixtureVersion}\`

## Decision sequence

${steps}

## Human decision branches

${branches}

## Product boundaries

- Proposal values and the intended outcome target are user-entered assumptions.
- Billing evidence can prove observed cost; it does not independently verify a business outcome.
- An outcome observation is separately labelled as user-entered and unverified.
- Deterministic policy supplies context. A named owner or administrator makes the decision.
- Vognary never auto-approves, auto-denies, purchases, provisions, cancels, or moves money.
`;
}

export function buildPublicArtifactSitemapEntries(
  artifacts: readonly PublicArtifact[] = publicArtifacts,
) {
  return artifacts.map((artifact) => ({
    url: artifact.url,
    lastModified: artifact.modifiedAt,
    changeFrequency: "monthly" as const,
    priority: 0.8,
  }));
}

function buildPublicArtifact(definition: PublicArtifactDefinition): PublicArtifact {
  const id = `urn:vognary:artifact:${definition.slug}`;
  const htmlPath = definition.canonicalPaths?.html ?? `/artifacts/${definition.slug}`;
  const markdownPath = definition.canonicalPaths?.markdown ?? `/artifacts/${definition.slug}/markdown`;
  const url = `${origin}${htmlPath}`;
  const markdownUrl = `${origin}${markdownPath}`;
  const revisionManifest = canonicalJson({
    schemaVersion: "vognary.public-artifact-revision.v1",
    artifact: {
      id,
      slug: definition.slug,
      title: definition.title,
      summary: definition.summary,
      publishedAt: definition.publishedAt,
      modifiedAt: definition.modifiedAt,
      author: definition.author,
      tags: definition.tags,
      synthetic: definition.synthetic,
      writable: definition.writable,
      customerData: definition.customerData,
      representations: { html: url, markdown: markdownUrl },
    },
    source: definition.source,
    derived: {
      steps: definition.steps,
      branches: definition.branches,
      facts: definition.derivedFacts,
    },
  });
  const revisionDigest = createHash("sha256").update(revisionManifest).digest("hex");

  return {
    ...definition,
    id,
    url,
    markdownUrl,
    revisionUrl: `${origin}/artifacts/${definition.slug}/revisions/${revisionDigest}/manifest.json`,
    revisionDigest,
    revisionManifest,
  };
}

function validateDefinition(definition: PublicArtifactDefinition): void {
  if (!artifactSlugPattern.test(definition.slug) || definition.slug.length > 80) {
    throw new Error(`Artifact slug must contain only lowercase letters, numbers, and single hyphens: ${definition.slug}`);
  }
  assertCanonicalTimestamp(definition.publishedAt, "publishedAt");
  assertCanonicalTimestamp(definition.modifiedAt, "modifiedAt");
  if (Date.parse(definition.modifiedAt) < Date.parse(definition.publishedAt)) {
    throw new Error("Artifact modifiedAt cannot be before publishedAt");
  }
  for (const [name, path] of Object.entries(definition.canonicalPaths ?? {})) {
    if (!path.startsWith("/") || path.includes("?") || path.includes("#")) {
      throw new Error(`Artifact canonical ${name} path must be an absolute path without a query or fragment`);
    }
  }
  canonicalJson(definition.source);
  canonicalJson(definition.derivedFacts);
}

function assertCanonicalTimestamp(value: string, field: string): void {
  if (!canonicalTimestampPattern.test(value)
    || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    throw new Error(`Artifact ${field} must be a canonical RFC 3339 UTC timestamp`);
  }
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Artifact manifests cannot contain non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => entry === undefined ? "null" : canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  throw new Error(`Artifact manifests cannot contain ${typeof value} values`);
}

function latestArtifactUpdate(artifacts: readonly PublicArtifact[]): string {
  return artifacts.map((artifact) => artifact.modifiedAt).sort().at(-1)
    ?? "1970-01-01T00:00:00.000Z";
}

function formatArtifactText(artifact: PublicArtifact): string {
  const steps = artifact.steps.map((step, index) => `${index + 1}. ${step}`).join("\n");
  const branches = artifact.branches
    .map((branch) => `- ${branch.label}: ${branch.outcome}`)
    .join("\n");
  return `${SYNTHETIC_DEMO_LABEL}. No customer data. Read-only; no transaction or obligation is executed.

${artifact.summary}

Decision sequence:
${steps}

Human decision branches:
${branches}`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function escapeMarkdownText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function requiredArtifact(artifact: PublicArtifact | undefined): PublicArtifact {
  if (!artifact) throw new Error("Canonical synthetic public artifact is missing");
  return artifact;
}