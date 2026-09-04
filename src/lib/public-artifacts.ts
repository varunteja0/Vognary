import { COMMITMENT_CONTROL_STEPS } from "@/lib/commitment-control-loop";
import {
  SYNTHETIC_DEMO_LABEL,
  syntheticDemoBranchLabels,
  syntheticDemoBranchOrder,
  syntheticDemoBranchOutcomes,
  syntheticDemoIdentity,
} from "@/lib/synthetic-control-demo";

const origin = "https://www.vognary.com";
const feedUpdatedAt = "2026-09-04T00:00:00.000Z";

export type PublicArtifact = {
  readonly id: string;
  readonly url: string;
  readonly markdownUrl: string;
  readonly title: string;
  readonly summary: string;
  readonly synthetic: true;
  readonly writable: false;
  readonly customerData: false;
  readonly sourceIdentity: typeof syntheticDemoIdentity;
  readonly steps: typeof COMMITMENT_CONTROL_STEPS;
  readonly branches: ReadonlyArray<{
    readonly id: (typeof syntheticDemoBranchOrder)[number];
    readonly label: string;
    readonly outcome: string;
  }>;
};

const syntheticDecisionArtifact = {
  id: `urn:vognary:artifact:${syntheticDemoIdentity.fixtureId}:${syntheticDemoIdentity.version}:${syntheticDemoIdentity.sourceHash}`,
  url: `${origin}/demo`,
  markdownUrl: `${origin}/demo.md`,
  title: "AI Spend Approval Policy and Decision Record — Synthetic Example",
  summary:
    "A read-only synthetic record showing cited exposure, a user-entered proposal and outcome target, deterministic policy context, three human decision branches, an immutable cap and expiry, and later observed-cost reconciliation. It contains no customer data and performs no action.",
  synthetic: true,
  writable: false,
  customerData: false,
  sourceIdentity: syntheticDemoIdentity,
  steps: COMMITMENT_CONTROL_STEPS,
  branches: syntheticDemoBranchOrder.map((branch) => ({
    id: branch,
    label: syntheticDemoBranchLabels[branch],
    outcome: syntheticDemoBranchOutcomes[branch],
  })),
} as const satisfies PublicArtifact;

export const publicArtifacts: readonly PublicArtifact[] = [syntheticDecisionArtifact];

export const publicArtifactJsonLd = {
  "@context": "https://schema.org",
  "@type": "CreativeWork",
  "@id": `${syntheticDecisionArtifact.url}#artifact`,
  name: syntheticDecisionArtifact.title,
  url: syntheticDecisionArtifact.url,
  description: syntheticDecisionArtifact.summary,
  isPartOf: {
    "@type": "WebSite",
    "@id": `${origin}/#website`,
    name: "Vognary",
    url: `${origin}/`,
  },
  about: [
    "AI spend approval policy",
    "Human authorization",
    "Commitment Control",
    "Observed-cost reconciliation",
  ],
  learningResourceType: "Synthetic decision record",
  inLanguage: "en-IN",
  conditionsOfAccess: "Public read-only synthetic demonstration; no customer data.",
} as const;

export const publicArtifactMetadata = {
  title: `${syntheticDecisionArtifact.title} | Vognary`,
  description:
    "Walk one placeholder AI-spend request through cited exposure, policy context, a named human decision, a frozen cap and expiry, and later observed-cost reconciliation. No account, no customer data.",
  alternates: {
    canonical: "/demo",
    types: {
      "text/markdown": "/demo.md",
      "application/feed+json": "/feed.json",
      "application/atom+xml": "/feed.xml",
    },
  },
} as const;

export function buildPublicArtifactsJsonFeed(): string {
  return JSON.stringify({
    version: "https://jsonfeed.org/version/1.1",
    title: "Vognary public decision artifacts",
    home_page_url: `${origin}/demo`,
    feed_url: `${origin}/feed.json`,
    description:
      "Read-only Vognary artifacts for human-authorized AI, cloud, and software commitment decisions.",
    language: "en-IN",
    items: publicArtifacts.map((artifact) => ({
      id: artifact.id,
      url: artifact.url,
      title: artifact.title,
      summary: artifact.summary,
      content_text: formatArtifactText(artifact),
      date_published: feedUpdatedAt,
      date_modified: feedUpdatedAt,
      tags: ["commitment-control", "human-authorization", "synthetic"],
      attachments: [{
        url: artifact.markdownUrl,
        mime_type: "text/markdown",
      }],
    })),
  }, null, 2);
}

export function buildPublicArtifactsAtom(): string {
  const entries = publicArtifacts.map((artifact) => `  <entry>
    <id>${escapeXml(artifact.id)}</id>
    <title>${escapeXml(artifact.title)}</title>
    <updated>${feedUpdatedAt}</updated>
    <link href="${escapeXml(artifact.url)}"/>
    <link href="${escapeXml(artifact.markdownUrl)}" rel="alternate" type="text/markdown"/>
    <summary type="text">${escapeXml(`${SYNTHETIC_DEMO_LABEL}. ${artifact.summary}`)}</summary>
    <category term="commitment-control"/>
    <category term="human-authorization"/>
    <category term="synthetic"/>
  </entry>`).join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${origin}/feed.xml</id>
  <title>Vognary public decision artifacts</title>
  <updated>${feedUpdatedAt}</updated>
  <link href="${origin}/feed.xml" rel="self" type="application/atom+xml"/>
  <link href="${origin}/demo"/>
${entries}
</feed>\n`;
}

export function buildPublicArtifactMarkdown(artifact: PublicArtifact): string {
  const steps = artifact.steps.map((step, index) => `${index + 1}. ${step}`).join("\n");
  const branches = artifact.branches
    .map((branch) => `### ${branch.label}\n\n${branch.outcome}`)
    .join("\n\n");

  return `# ${artifact.title}

> ${SYNTHETIC_DEMO_LABEL}. No customer data. Read-only; Vognary does not execute a transaction or obligation.

${artifact.summary}

## Artifact identity

- Artifact ID: \`${artifact.id}\`
- Canonical URL: ${artifact.url}
- Fixture: \`${artifact.sourceIdentity.fixtureId}\`
- Fixture version: \`${artifact.sourceIdentity.version}\`
- Source hash: \`${artifact.sourceIdentity.sourceHash}\`

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