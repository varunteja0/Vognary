import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  buildPublicArtifactJsonLd,
  buildPublicArtifactMarkdown,
  buildPublicArtifactsAtom,
  buildPublicArtifactsJsonFeed,
  publicArtifacts,
} from "../src/lib/public-artifacts.ts";
import { agentHomepageMarkdown, llmsTxt } from "../src/lib/agent-content.ts";

const root = process.cwd();
const publicSurfaces = [
  "README.md",
  "src/app/page.tsx",
  "src/app/not-found.tsx",
  "src/app/app/layout.tsx",
  "src/app/launch-landing.tsx",
  "src/app/start/start-client.tsx",
  "src/app/workspace/recovery/recovery-home.tsx",
  "src/app/workspace/recovery/recovery-commitments.tsx",
  "src/app/workspace/recovery/recovery-sources.tsx",
  "src/app/workspace/recovery/recovery-billing-setup.tsx",
  "src/app/workspace/recovery/recovery-attention.tsx",
  "src/app/workspace/recovery/control/control-attention.tsx",
  "src/app/workspace/recovery/control/control-outcome-dialog.tsx",
  "src/app/workspace/recovery/control/control-exception-review-dialog.tsx",
  "src/app/workspace/recovery/control/control-view.tsx",
  "src/lib/recovery/source-catalog.ts",
  "src/lib/agent-content.ts",
  "src/lib/commitment-control-loop.ts",
  "src/lib/public-artifacts.ts",
  "src/lib/synthetic-control-demo.ts",
  "src/lib/synthetic-fixture-identity.ts",
  "src/app/demo/page.tsx",
  "src/app/demo.md/route.ts",
  "src/app/feed.json/route.ts",
  "src/app/feed.xml/route.ts",
  "src/app/workspace/recovery/recovery-mandate.tsx",
  "src/app/workspace/recovery/recovery-autopilot-home.tsx",
  "src/app/profile/profile-client.tsx",
  "src/app/profile/profile-sections.tsx",
  "src/app/login/login-client.tsx",
  "src/app/billing/return/page.tsx",
  "src/app/billing/return/billing-return-client.tsx",
  "src/app/about/page.tsx",
  "src/app/privacy/page.tsx",
  "src/app/security/page.tsx",
  "src/app/contact/page.tsx",
  "src/app/pay/page.tsx",
  "src/app/terms/page.tsx",
  "src/app/manifest.ts",
  "public/brand/vognary-social-card.svg",
  "src/lib/server/trust-signals.ts",
  "docs/templates/invoice-template.md",
  "docs/templates/invoice-template.html",
  "docs/platform-api.md",
];

const prohibitedClaims = [
  { pattern: /see every rupee/i, reason: "universal spend coverage is not proven" },
  { pattern: /one live recurring-money ledger/i, reason: "background synchronization is source-specific" },
  { pattern: /bank-grade encryption/i, reason: "the control must be named instead of using an undefined superlative" },
  { pattern: /highest security/i, reason: "security superlatives require impossible universal comparison" },
  { pattern: /Apple[- ]secure/i, reason: "competitor security comparisons are not substantiated" },
  { pattern: /certified secure/i, reason: "no current certification proves this claim" },
  { pattern: /passed penetration test/i, reason: "publish only dated assessment scope and retest evidence" },
  { pattern: /commitment firewall/i, reason: "V0 records authority but does not enforce or block obligations" },
  { pattern: /never paste an api key/i, reason: "some workspace-owned provider integrations use scoped API keys" },
  { pattern: /no api\. no pasting/i, reason: "fallback and administrator-credential paths still exist" },
  { pattern: /connect once, see everything/i, reason: "partner-gated rails make this claim false" },
  { pattern: /every subscription, emi, loan, mandate/i, reason: "no source provides universal commitment coverage" },
  { pattern: /you(?:'|’)re on the early-access list/i, reason: "success must only be shown after durable persistence" },
  { pattern: /guaranteed savings/i, reason: "savings require source-scoped outcome verification" },
  { pattern: /100% secure/i, reason: "no internet service can claim absolute security" },
  { pattern: /fully automated across all/i, reason: "automation and coverage remain source-specific" },
  { pattern: /\b(?:Vognary|we)\b[^.\n]{0,35}\b(?:takes?\s+care\s+of|handles?)\b[^.\n]{0,24}\b(?:everything|it\s+all|every\s+commitment)\b/i, reason: "universal handling is not a live capability" },
  { pattern: /\b(?:you|I)\s+(?:do\s+not|don(?:'|’)t|never|no\s+longer)\s+(?:need\s+to\s+)?worry(?:\s+(?:again|anymore|about\s+(?:anything|everything)))?\b/i, reason: "worry-free outcomes are not proven" },
  { pattern: /\b(?:you\s+have\s+)?nothing\s+to\s+worry\s+about\b/i, reason: "worry-free outcomes are not proven" },
  { pattern: /\blink(?:ed|ing|s)?[^.\n]{0,30}\bmerchants?\b/i, reason: "merchants are watched, never linked" },
  { pattern: /\bmerchants?[^.\n]{0,30}\blink(?:ed|ing|s)?\b/i, reason: "merchants are watched, never linked" },
  { pattern: /subscription tracker/i, reason: "the product is Commitment Control, not a subscription tracker" },
  { pattern: /expense tracker/i, reason: "the product is Commitment Control, not an expense tracker" },
  { pattern: /saas manager/i, reason: "the product is Commitment Control, not a generic SaaS manager" },
  { pattern: /Commitment Intelligence/i, reason: "the live product is Commitment Control; do not sell the retired identity" },
  { pattern: /mailbox sync/i, reason: "mailbox sync is not a live source" },
  { pattern: /autonomous finance/i, reason: "autonomous finance is not a live capability" },
  { pattern: /connect gmail/i, reason: "direct Gmail Connect is not offered" },
];

const violations = [];
const generatedPublicSurfaces = [
  { name: "generated:feed.json", content: buildPublicArtifactsJsonFeed() },
  { name: "generated:feed.xml", content: buildPublicArtifactsAtom() },
  { name: "generated:index.md", content: agentHomepageMarkdown },
  { name: "generated:llms.txt", content: llmsTxt },
  ...publicArtifacts.flatMap((artifact) => [
    { name: `generated:${artifact.slug}:markdown`, content: buildPublicArtifactMarkdown(artifact) },
    { name: `generated:${artifact.slug}:manifest`, content: artifact.revisionManifest },
    { name: `generated:${artifact.slug}:json-ld`, content: JSON.stringify(buildPublicArtifactJsonLd(artifact)) },
  ]),
];

for (const file of publicSurfaces) {
  const content = await readFile(resolve(root, file), "utf8");
  scanSurface(file, content);
}

for (const surface of generatedPublicSurfaces) {
  scanSurface(surface.name, surface.content);
}

if (violations.length) {
  console.error("Public claim check failed:\n" + violations.map((violation) => `- ${violation}`).join("\n"));
  process.exit(1);
}

console.log(`Public claim check passed for ${publicSurfaces.length + generatedPublicSurfaces.length} user-facing surfaces.`);

function scanSurface(name, content) {
  for (const rule of prohibitedClaims) {
    if (rule.pattern.test(content)) violations.push(`${name}: ${rule.reason} (${rule.pattern})`);
  }
}
