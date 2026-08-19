/**
 * Conservative first-session identity: one commitment per real recurring
 * relationship. Auto-collapse only when identity evidence is strong. Ambiguous
 * pairs stay separate and must be reviewed — never silently merged by fuzzy name.
 */

export const KEEP_BASELINE_REASON = "No current evidence suggests this needs attention.";

export const IDENTITY_UNCERTAIN_REASON =
  "Identity is uncertain. These receipts may be the same relationship or separate accounts. Review before treating them as one commitment.";

export const DUPLICATE_AMBIGUITY_REASON =
  "Possible duplicate. The same vendor appears more than once and the receipts do not prove they are separate.";

export const OVERLAP_REVIEW_REASON = (familyLabel: string) =>
  `Possible overlap with other ${familyLabel} tools. Confirm what each is used for.`;

export type RelationshipMergeAction = "collapse" | "split" | "ambiguous";

export type RelationshipSnapshot = {
  merchant: string;
  normalizedMerchant: string;
  currency: string;
  frequency: string;
  lastChargeDate: string;
  averageAmount: number;
  evidenceDates: readonly string[];
  evidenceTexts: readonly string[];
};

export type RelationshipIdentity = {
  merchantKey: string;
  currency: string;
  cadenceFamily: string;
  productKey: string | null;
  accountKey: string | null;
};

export type RelationshipMergeDecision = {
  action: RelationshipMergeAction;
  reason: string;
};

const ONE_SIDED_AMOUNT_DELTA = 0.25;
const CONTEMPORANEOUS_DAYS: Record<string, number> = {
  weekly: 3,
  biweekly: 7,
  semimonthly: 7,
  monthly: 20,
  bimonthly: 35,
  quarterly: 50,
  yearly: 60,
  irregular: 20,
};

const PRODUCT_PATTERNS: readonly { key: string; pattern: RegExp }[] = [
  { key: "chatgpt-plus", pattern: /\bchatgpt\s+plus\b|\bchat\s*gpt\s+plus\b/i },
  { key: "chatgpt-team", pattern: /\bchatgpt\s+team\b|\bchat\s*gpt\s+team\b/i },
  { key: "chatgpt-enterprise", pattern: /\bchatgpt\s+enterprise\b/i },
  { key: "chatgpt-pro", pattern: /\bchatgpt\s+pro\b/i },
  { key: "openai-api", pattern: /\bopenai\s+api\b|\bapi\s+usage\b|\bapi\s+credits\b/i },
  { key: "notion-plus", pattern: /\bnotion\s+plus\b/i },
  { key: "notion-business", pattern: /\bnotion\s+business\b/i },
  { key: "notion-enterprise", pattern: /\bnotion\s+enterprise\b/i },
  { key: "slack-pro", pattern: /\bslack\s+pro\b/i },
  { key: "slack-business", pattern: /\bslack\s+business\b/i },
  { key: "github-copilot", pattern: /\bcopilot\b/i },
  { key: "github-team", pattern: /\bgithub\s+team\b/i },
  { key: "github-enterprise", pattern: /\bgithub\s+enterprise\b/i },
];

const ACCOUNT_PATTERNS: readonly RegExp[] = [
  /\bworkspace[:\s#]+([a-z0-9][a-z0-9._-]{1,63})/i,
  /\borg(?:anization)?[:\s#]+([a-z0-9][a-z0-9._-]{1,63})/i,
  /\baccount(?:\s*id)?[:\s#]+([a-z0-9][a-z0-9._-]{1,63})/i,
  /\bteam(?:\s*id)?[:\s#]+([a-z0-9][a-z0-9._-]{1,63})/i,
];

export function extractProductKey(...texts: readonly string[]): string | null {
  const haystack = texts.join(" ");
  for (const entry of PRODUCT_PATTERNS) {
    if (entry.pattern.test(haystack)) return entry.key;
  }
  return null;
}

export function extractAccountKey(...texts: readonly string[]): string | null {
  const haystack = texts.join(" ");
  for (const pattern of ACCOUNT_PATTERNS) {
    const match = pattern.exec(haystack);
    const value = match?.[1]?.trim().toLowerCase();
    if (value) return value;
  }
  return null;
}

export function cadenceFamily(frequency: string): string {
  return frequency.trim().toLowerCase() || "irregular";
}

export function extractRelationshipIdentity(snapshot: RelationshipSnapshot): RelationshipIdentity {
  const texts = [snapshot.merchant, snapshot.normalizedMerchant, ...snapshot.evidenceTexts];
  return {
    merchantKey: snapshot.normalizedMerchant.trim().toLowerCase(),
    currency: snapshot.currency.trim().toUpperCase(),
    cadenceFamily: cadenceFamily(snapshot.frequency),
    productKey: extractProductKey(...texts),
    accountKey: extractAccountKey(...texts),
  };
}

export function relationshipIdentityHint(snapshot: RelationshipSnapshot): string {
  const identity = extractRelationshipIdentity(snapshot);
  return [
    "rel",
    identity.merchantKey,
    identity.currency,
    identity.cadenceFamily,
    identity.productKey ?? "_",
    identity.accountKey ?? "_",
  ].join("|");
}

export function decideRelationshipMerge(left: RelationshipSnapshot, right: RelationshipSnapshot): RelationshipMergeDecision {
  const leftIdentity = extractRelationshipIdentity(left);
  const rightIdentity = extractRelationshipIdentity(right);

  if (leftIdentity.merchantKey !== rightIdentity.merchantKey) {
    return { action: "split", reason: "Different merchants." };
  }
  if (leftIdentity.currency !== rightIdentity.currency) {
    return { action: "split", reason: "Different currencies." };
  }
  if (!cadenceCompatible(leftIdentity.cadenceFamily, rightIdentity.cadenceFamily)) {
    return { action: "split", reason: "Different billing cadences." };
  }
  if (keysConflict(leftIdentity.productKey, rightIdentity.productKey)) {
    return { action: "split", reason: "Different products." };
  }
  if (keysConflict(leftIdentity.accountKey, rightIdentity.accountKey)) {
    return { action: "split", reason: "Different workspaces or accounts." };
  }

  const chronology = chronologyRelation(left, right, leftIdentity.cadenceFamily);
  const oneSidedProduct = xorPresent(leftIdentity.productKey, rightIdentity.productKey)
    || xorPresent(leftIdentity.accountKey, rightIdentity.accountKey);

  if (oneSidedProduct && !amountCompatible(left.averageAmount, right.averageAmount, ONE_SIDED_AMOUNT_DELTA)) {
    return { action: "split", reason: "Different products with unmatched amounts." };
  }

  if (chronology === "sequential" || chronology === "unknown") {
    return { action: "collapse", reason: "Same recurring relationship." };
  }

  if (chronology === "same-day") {
    if (amountCompatible(left.averageAmount, right.averageAmount, ONE_SIDED_AMOUNT_DELTA)) {
      return { action: "collapse", reason: "Same charge captured more than once." };
    }
    return { action: "split", reason: "Different amounts on the same day." };
  }

  if (amountCompatible(left.averageAmount, right.averageAmount, ONE_SIDED_AMOUNT_DELTA)) {
    return { action: "ambiguous", reason: IDENTITY_UNCERTAIN_REASON };
  }

  return { action: "split", reason: "Contemporaneous bills at different amounts." };
}

export function buildPriceIncreaseReason(changePercent: number): string {
  return `Price changed. The latest charge is about ${changePercent}% higher than the earlier amount.`;
}

function cadenceCompatible(left: string, right: string): boolean {
  if (left === right) return true;
  return left === "irregular" || right === "irregular";
}

function keysConflict(left: string | null, right: string | null): boolean {
  return Boolean(left && right && left !== right);
}

function xorPresent(left: string | null, right: string | null): boolean {
  return Boolean(left) !== Boolean(right);
}

function amountCompatible(left: number, right: number, maxDelta: number): boolean {
  const larger = Math.max(left, right);
  if (!larger) return false;
  return Math.abs(left - right) / larger <= maxDelta;
}

function chronologyRelation(
  left: RelationshipSnapshot,
  right: RelationshipSnapshot,
  family: string,
): "sequential" | "contemporaneous" | "same-day" | "unknown" {
  const leftDate = observationDate(left);
  const rightDate = observationDate(right);
  if (!leftDate || !rightDate) return "unknown";
  const gap = Math.abs(daysBetween(leftDate, rightDate));
  if (gap === 0) return "same-day";
  const window = CONTEMPORANEOUS_DAYS[family] ?? 20;
  return gap < window ? "contemporaneous" : "sequential";
}

function observationDate(snapshot: RelationshipSnapshot): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(snapshot.lastChargeDate)) return snapshot.lastChargeDate;
  const dates = snapshot.evidenceDates.filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)).sort();
  return dates.at(-1) ?? null;
}

function daysBetween(left: string, right: string): number {
  const start = Date.parse(`${left}T00:00:00Z`);
  const end = Date.parse(`${right}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}
