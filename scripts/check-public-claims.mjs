import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const publicSurfaces = [
  "README.md",
  "src/app/page.tsx",
  "src/app/vognary-mvp-client.tsx",
  "src/app/connect/connect-client.tsx",
  "src/app/connect/page.tsx",
  "src/app/integrations/page.tsx",
  "src/app/sources/page.tsx",
  "src/app/sources/source-health-client.tsx",
  "src/app/partners/page.tsx",
  "src/app/profile/profile-client.tsx",
  "src/app/login/login-client.tsx",
  "src/app/launch/launch-client.tsx",
  "src/app/private-audit/private-audit-client.tsx",
  "src/app/privacy/page.tsx",
  "src/app/security/page.tsx",
  "src/app/terms/page.tsx",
  "src/lib/connectors.ts",
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
