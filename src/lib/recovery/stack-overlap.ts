import type { CommitmentImportance, CommitmentOwner, CommitmentPurpose, OverlapFamily } from "./contracts";

/**
 * Conservative stack-overlap families for the V1 decision layer.
 *
 * This is not a product-intelligence database and does not claim two tools are
 * interchangeable. It only groups named vendors (or a few already-assigned
 * receipt categories) so Home can ask what each is used for before KEEP/REVIEW.
 */
export const overlapFamilyLabels: Record<OverlapFamily, string> = {
  AI_RESEARCH: "AI / Research",
  PROJECT_MANAGEMENT: "Project management",
  DOCUMENTATION: "Documentation",
  COMMUNICATION: "Communication",
  DESIGN: "Design",
  ENGINEERING: "Engineering tools",
};

const merchantFamilies: readonly { family: OverlapFamily; tokens: readonly string[] }[] = [
  { family: "AI_RESEARCH", tokens: ["chatgpt", "openai", "claude", "anthropic", "perplexity", "gemini", "midjourney", "runway", "elevenlabs", "cursor", "windsurf"] },
  { family: "PROJECT_MANAGEMENT", tokens: ["linear", "asana", "clickup", "jira", "monday.com", "monday"] },
  { family: "DOCUMENTATION", tokens: ["notion", "confluence"] },
  { family: "COMMUNICATION", tokens: ["microsoft teams", "slack", "teams"] },
  { family: "DESIGN", tokens: ["figma", "canva", "adobe"] },
  { family: "ENGINEERING", tokens: ["github", "gitlab", "bitbucket"] },
];

const categoryFamilies: Readonly<Record<string, OverlapFamily>> = {
  "AI tools": "AI_RESEARCH",
  "Creative tools": "DESIGN",
  "Developer tools": "ENGINEERING",
};

export type StackOverlapMember = {
  id: string;
  merchant: string;
  category: string;
  status: "ACTIVE" | "NOT_RECURRING";
  purpose?: CommitmentPurpose | null;
  importance?: CommitmentImportance | null;
  owner?: CommitmentOwner | null;
};

export type StackOverlapGroup = {
  family: OverlapFamily;
  label: string;
  members: readonly StackOverlapMember[];
};

export function classifyStackOverlapFamily(merchant: string, category: string): OverlapFamily | null {
  return classifyStackOverlap(merchant, category)?.family ?? null;
}

export function classifyStackOverlap(merchant: string, category: string): { family: OverlapFamily; identity: string } | null {
  const haystack = merchant.trim().toLowerCase();
  for (const entry of merchantFamilies) {
    const token = entry.tokens.find((value) => merchantContainsToken(haystack, value));
    if (token) return { family: entry.family, identity: token };
  }
  const family = categoryFamilies[category.trim()];
  if (!family) return null;
  const identity = normalizeMerchantKey(merchant);
  return identity ? { family, identity } : null;
}

export function groupStackOverlaps<T extends StackOverlapMember>(commitments: readonly T[]): readonly (Omit<StackOverlapGroup, "members"> & { members: readonly T[] })[] {
  const buckets = new Map<OverlapFamily, T[]>();
  const identities = new Map<OverlapFamily, Set<string>>();
  for (const commitment of commitments) {
    if (commitment.status !== "ACTIVE") continue;
    const classified = classifyStackOverlap(commitment.merchant, commitment.category);
    if (!classified) continue;
    const bucket = buckets.get(classified.family) ?? [];
    bucket.push(commitment);
    buckets.set(classified.family, bucket);
    const seen = identities.get(classified.family) ?? new Set<string>();
    seen.add(classified.identity);
    identities.set(classified.family, seen);
  }

  return [...buckets.entries()]
    .map(([family, members]) => ({
      family,
      label: overlapFamilyLabels[family],
      members,
      uniqueMerchants: identities.get(family) ?? new Set<string>(),
    }))
    .filter((group) => group.uniqueMerchants.size >= 2)
    .sort((left, right) => left.label.localeCompare(right.label) || left.family.localeCompare(right.family))
    .map(({ family, label, members }) => ({
      family,
      label,
      members: [...members].sort((left, right) => left.merchant.localeCompare(right.merchant) || left.id.localeCompare(right.id)),
    }));
}

function merchantContainsToken(merchant: string, token: string) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`).test(merchant);
}

function normalizeMerchantKey(merchant: string) {
  return merchant.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
