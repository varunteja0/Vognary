import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

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
  "src/lib/recovery/source-catalog.ts",
  "src/lib/agent-content.ts",
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
  "src/app/terms/page.tsx",
  "src/app/manifest.ts",
  "public/brand/vognary-social-card.svg",
  "src/lib/server/trust-signals.ts",
  "docs/platform-api.md",
];

const prohibitedClaims = [
  { pattern: /see every rupee/i, reason: "universal spend coverage is not proven" },
  { pattern: /one live recurring-money ledger/i, reason: "background synchronization is source-specific" },
  { pattern: /bank-grade encryption/i, reason: "the control must be named instead of using an undefined superlative" },
  { pattern: /never paste an api key/i, reason: "some workspace-owned provider integrations use scoped API keys" },
  { pattern: /no api\. no pasting/i, reason: "fallback and administrator-credential paths still exist" },
  { pattern: /connect once, see everything/i, reason: "partner-gated rails make this claim false" },
  { pattern: /every subscription, emi, loan, mandate/i, reason: "no source provides universal commitment coverage" },
  { pattern: /you(?:'|’)re on the early-access list/i, reason: "success must only be shown after durable persistence" },
  { pattern: /guaranteed savings/i, reason: "savings require source-scoped outcome verification" },
  { pattern: /100% secure/i, reason: "no internet service can claim absolute security" },
  { pattern: /fully automated across all/i, reason: "automation and coverage remain source-specific" },
  { pattern: /\blink(?:ed|ing|s)?[^.\n]{0,30}\bmerchants?\b/i, reason: "merchants are watched, never linked" },
  { pattern: /\bmerchants?[^.\n]{0,30}\blink(?:ed|ing|s)?\b/i, reason: "merchants are watched, never linked" },
  { pattern: /subscription tracker/i, reason: "the product is Commitment Intelligence, not a subscription tracker" },
  { pattern: /expense tracker/i, reason: "the product is Commitment Intelligence, not an expense tracker" },
  { pattern: /saas manager/i, reason: "the product is Commitment Intelligence, not a generic SaaS manager" },
  { pattern: /mailbox sync/i, reason: "mailbox sync is not a live source" },
  { pattern: /autonomous finance/i, reason: "autonomous finance is not a live capability" },
  { pattern: /connect gmail/i, reason: "direct Gmail Connect is not offered" },
];

const violations = [];

for (const file of publicSurfaces) {
  const content = await readFile(resolve(root, file), "utf8");
  for (const rule of prohibitedClaims) {
    if (rule.pattern.test(content)) violations.push(`${file}: ${rule.reason} (${rule.pattern})`);
  }
}

if (violations.length) {
  console.error("Public claim check failed:\n" + violations.map((violation) => `- ${violation}`).join("\n"));
  process.exit(1);
}

console.log(`Public claim check passed for ${publicSurfaces.length} user-facing surfaces.`);
