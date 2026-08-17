import type { SenderTrustTier } from "@/lib/recovery/contracts";

/**
 * Merchant identity resolution.
 *
 * Two receipts describe the same merchant only when something durable says so.
 * Every signal below is scored, every merge is explainable in the words a
 * customer would use, every merge cites the evidence on both sides, and every
 * merge can be reversed. Nothing here rewrites commitment detection: it adds a
 * canonical merchant that commitments may point at.
 */

export const merchantIdentitySignalKinds = [
  "EXPLICIT_MERCHANT_ID",
  "GSTIN",
  "BILLING_DOMAIN",
  "SENDER_DOMAIN",
  "PROCESSOR_DESCRIPTOR",
  "ACCOUNT_IDENTIFIER",
  "INVOICE_IDENTIFIER",
  "FUZZY_ALIAS",
] as const;
export type MerchantIdentitySignalKind = (typeof merchantIdentitySignalKinds)[number];

export type MerchantIdentitySignal =
  | { kind: "EXPLICIT_MERCHANT_ID"; namespace: string; value: string }
  | { kind: "GSTIN"; value: string }
  | { kind: "BILLING_DOMAIN"; value: string }
  | { kind: "SENDER_DOMAIN"; value: string; tier: SenderTrustTier }
  | { kind: "PROCESSOR_DESCRIPTOR"; processor: string; value: string }
  | { kind: "ACCOUNT_IDENTIFIER"; value: string }
  | { kind: "INVOICE_IDENTIFIER"; value: string }
  | { kind: "FUZZY_ALIAS"; value: string };

export type ObservedMerchantSignal = {
  signal: MerchantIdentitySignal;
  /** The persisted evidence row this signal was read from. Never synthesised. */
  evidenceId: string;
};

export type MerchantIdentityClaim = {
  currency: string;
  displayName: string;
  signals: readonly ObservedMerchantSignal[];
};

export type CanonicalMerchantRecord = MerchantIdentityClaim & { id: string };

/**
 * Standalone strength of each signal, as a percentage belief that two records
 * carrying the same value describe the same merchant. Weak signals are weak on
 * purpose: they exist to justify a question, not a silent merge.
 */
export const merchantSignalWeights = {
  EXPLICIT_MERCHANT_ID: 100,
  GSTIN: 100,
  BILLING_DOMAIN: 90,
  SENDER_DOMAIN: 80,
  PROCESSOR_DESCRIPTOR: 65,
  ACCOUNT_IDENTIFIER: 55,
  INVOICE_IDENTIFIER: 30,
  FUZZY_ALIAS: 40,
} as const satisfies Record<MerchantIdentitySignalKind, number>;

/** Signals that may carry a merge on their own. Everything else needs company. */
const decisiveSignalKinds = new Set<MerchantIdentitySignalKind>([
  "EXPLICIT_MERCHANT_ID",
  "GSTIN",
  "BILLING_DOMAIN",
]);

export const merchantAutoMergeScore = 90;
export const merchantReviewScore = 35;

const senderTierWeightFactor: Record<SenderTrustTier, number> = {
  VERIFIED_SENDER: 1,
  KNOWN_SENDER: 0.75,
  UNVERIFIED_SENDER: 0.5,
  SUSPICIOUS_SENDER: 0,
};

export type MerchantBlockReason = "CURRENCY_MISMATCH" | "USER_REJECTED" | "CONFLICTING_LEGAL_IDENTITY";

export type MerchantSignalMatch = {
  kind: MerchantIdentitySignalKind;
  weight: number;
  claimEvidenceIds: readonly string[];
  candidateEvidenceIds: readonly string[];
  explanation: string;
};

export type MerchantIdentityMatch = {
  merchantId: string;
  score: number;
  strongestSignalKind: MerchantIdentitySignalKind;
  matchedSignals: readonly MerchantSignalMatch[];
  evidenceIds: readonly string[];
  reasons: readonly string[];
  autoMergeable: boolean;
};

export type MerchantIdentityBlock = {
  merchantId: string;
  reason: MerchantBlockReason;
  explanation: string;
};

export type MerchantIdentityResolution = {
  outcome: "AUTO_MERGE" | "REVIEW_SUGGESTED" | "NO_MATCH";
  match: MerchantIdentityMatch | null;
  alternatives: readonly MerchantIdentityMatch[];
  blocked: readonly MerchantIdentityBlock[];
  reasons: readonly string[];
};

const gstinAlphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
// Legal-form suffixes only. Words like "services" or a country name distinguish
// real sibling entities, so stripping them would merge businesses that differ.
const aliasNoiseWords = new Set([
  "pvt", "private", "ltd", "limited", "llp", "inc", "incorporated", "llc",
  "corp", "corporation", "gmbh", "plc",
]);

/**
 * Validates the statutory GSTIN check character. An identifier that fails this
 * is a transcription artefact, not a legal identity, so it is discarded rather
 * than used as a weak alias.
 */
export function canonicalGstin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(normalized)) return null;
  let sum = 0;
  for (let index = 0; index < 14; index += 1) {
    const digit = gstinAlphabet.indexOf(normalized[index]!);
    if (digit < 0) return null;
    const product = digit * (index % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  const expected = gstinAlphabet[(36 - (sum % 36)) % 36];
  return expected === normalized[14] ? normalized : null;
}

/**
 * Lowercases a hostname and drops a leading `www.`. No public-suffix guessing:
 * `netflix.com.evil.tld` stays a distinct host.
 */
export function canonicalDomain(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let normalized = value.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at >= 0) normalized = normalized.slice(at + 1);
  normalized = normalized.replace(/\.+$/, "").replace(/^www\./, "");
  return domainPattern.test(normalized) ? normalized : null;
}

export function normalizeMerchantAlias(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((token) => token && !aliasNoiseWords.has(token))
    .join(" ")
    .trim();
}

function canonicalIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");
  return normalized.length >= 4 ? normalized : null;
}

function canonicalDescriptor(processor: unknown, value: unknown): string | null {
  const merchantPart = typeof value === "string" ? (value.split("*").at(-1) ?? "") : "";
  const withoutProcessor = typeof processor === "string"
    ? merchantPart.replace(new RegExp(`^${escapeRegExp(processor)}`, "i"), "")
    : merchantPart;
  const normalized = normalizeMerchantAlias(withoutProcessor);
  return normalized.length >= 3 ? normalized : null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Sørensen–Dice on character bigrams. Deterministic, no locale dependence. */
function aliasSimilarity(left: string, right: string) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const bigrams = (value: string) => {
    const result = new Map<string, number>();
    for (let index = 0; index < value.length - 1; index += 1) {
      const pair = value.slice(index, index + 2);
      result.set(pair, (result.get(pair) ?? 0) + 1);
    }
    return result;
  };
  const a = bigrams(left);
  const b = bigrams(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const [pair, count] of a) shared += Math.min(count, b.get(pair) ?? 0);
  const total = [...a.values()].reduce((sum, value) => sum + value, 0)
    + [...b.values()].reduce((sum, value) => sum + value, 0);
  return (2 * shared) / total;
}

type SignalIndex = Map<MerchantIdentitySignalKind, Map<string, { evidenceIds: Set<string>; raw: string }>>;

function indexSignals(signals: readonly ObservedMerchantSignal[]): SignalIndex {
  const index: SignalIndex = new Map();
  for (const observed of signals) {
    const key = canonicalKeyFor(observed.signal);
    if (!key) continue;
    const byKind = index.get(observed.signal.kind) ?? new Map();
    const entry = byKind.get(key.key) ?? { evidenceIds: new Set<string>(), raw: key.raw };
    if (observed.evidenceId) entry.evidenceIds.add(observed.evidenceId);
    byKind.set(key.key, entry);
    index.set(observed.signal.kind, byKind);
  }
  return index;
}

function canonicalKeyFor(signal: MerchantIdentitySignal): { key: string; raw: string } | null {
  switch (signal.kind) {
    case "EXPLICIT_MERCHANT_ID": {
      const namespace = typeof signal.namespace === "string" ? signal.namespace.trim().toLowerCase() : "";
      const value = canonicalIdentifier(signal.value);
      return namespace && value ? { key: `${namespace}:${value}`, raw: `${namespace}:${value}` } : null;
    }
    case "GSTIN": {
      const value = canonicalGstin(signal.value);
      return value ? { key: value, raw: value } : null;
    }
    case "BILLING_DOMAIN":
    case "SENDER_DOMAIN": {
      const value = canonicalDomain(signal.value);
      return value ? { key: value, raw: value } : null;
    }
    case "PROCESSOR_DESCRIPTOR": {
      const value = canonicalDescriptor(signal.processor, signal.value);
      return value ? { key: value, raw: value } : null;
    }
    case "ACCOUNT_IDENTIFIER":
    case "INVOICE_IDENTIFIER": {
      const value = canonicalIdentifier(signal.value);
      return value ? { key: value, raw: value } : null;
    }
    case "FUZZY_ALIAS": {
      const value = normalizeMerchantAlias(signal.value);
      return value ? { key: value, raw: value } : null;
    }
  }
}

function weakestSenderTier(signals: readonly ObservedMerchantSignal[], domain: string): SenderTrustTier {
  let weakest: SenderTrustTier = "VERIFIED_SENDER";
  const order: SenderTrustTier[] = ["VERIFIED_SENDER", "KNOWN_SENDER", "UNVERIFIED_SENDER", "SUSPICIOUS_SENDER"];
  for (const observed of signals) {
    if (observed.signal.kind !== "SENDER_DOMAIN") continue;
    if (canonicalDomain(observed.signal.value) !== domain) continue;
    if (order.indexOf(observed.signal.tier) > order.indexOf(weakest)) weakest = observed.signal.tier;
  }
  return weakest;
}

const signalNoun: Record<MerchantIdentitySignalKind, string> = {
  EXPLICIT_MERCHANT_ID: "the merchant account id printed on both receipts",
  GSTIN: "the same GST registration on both receipts",
  BILLING_DOMAIN: "the same billing website on both receipts",
  SENDER_DOMAIN: "the same sending address on both receipts",
  PROCESSOR_DESCRIPTOR: "the same payment-processor description on both receipts",
  ACCOUNT_IDENTIFIER: "the same account number on both receipts",
  INVOICE_IDENTIFIER: "the same invoice number on both receipts",
  FUZZY_ALIAS: "a close name similarity only",
};

function compareMerchant(claim: MerchantIdentityClaim, candidateRecord: CanonicalMerchantRecord) {
  const claimIndex = indexSignals(claim.signals);
  const candidateIndex = indexSignals(candidateRecord.signals);
  const matches: MerchantSignalMatch[] = [];

  for (const kind of merchantIdentitySignalKinds) {
    const left = claimIndex.get(kind);
    const right = candidateIndex.get(kind);
    if (!left?.size || !right?.size) continue;

    if (kind === "FUZZY_ALIAS") {
      let best: { similarity: number; leftKey: string; rightKey: string } | null = null;
      for (const leftKey of left.keys()) {
        for (const rightKey of right.keys()) {
          const similarity = aliasSimilarity(leftKey, rightKey);
          if (!best || similarity > best.similarity) best = { similarity, leftKey, rightKey };
        }
      }
      if (!best || best.similarity < 0.82) continue;
      matches.push({
        kind,
        weight: Math.round(merchantSignalWeights.FUZZY_ALIAS * best.similarity),
        claimEvidenceIds: [...(left.get(best.leftKey)?.evidenceIds ?? [])].sort(),
        candidateEvidenceIds: [...(right.get(best.rightKey)?.evidenceIds ?? [])].sort(),
        explanation: signalNoun.FUZZY_ALIAS,
      });
      continue;
    }

    for (const [key, leftEntry] of [...left.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const rightEntry = right.get(key);
      if (!rightEntry) continue;
      let weight: number = merchantSignalWeights[kind];
      if (kind === "SENDER_DOMAIN") {
        const tier = order2(weakestSenderTier(claim.signals, key), weakestSenderTier(candidateRecord.signals, key));
        weight = Math.round(weight * senderTierWeightFactor[tier]);
      }
      if (weight <= 0) continue;
      matches.push({
        kind,
        weight,
        claimEvidenceIds: [...leftEntry.evidenceIds].sort(),
        candidateEvidenceIds: [...rightEntry.evidenceIds].sort(),
        explanation: signalNoun[kind],
      });
      break;
    }
  }

  return { matches, claimIndex, candidateIndex };
}

function order2(left: SenderTrustTier, right: SenderTrustTier): SenderTrustTier {
  const order: SenderTrustTier[] = ["VERIFIED_SENDER", "KNOWN_SENDER", "UNVERIFIED_SENDER", "SUSPICIOUS_SENDER"];
  return order.indexOf(left) >= order.indexOf(right) ? left : right;
}

/** Noisy-OR: independent signals reinforce each other but can never exceed certainty. */
function combineWeights(matches: readonly MerchantSignalMatch[]) {
  let doubt = 1;
  for (const match of matches) doubt *= 1 - Math.min(100, Math.max(0, match.weight)) / 100;
  return Math.round((1 - doubt) * 100);
}

function hasConflictingLegalIdentity(claimIndex: SignalIndex, candidateIndex: SignalIndex) {
  for (const kind of ["GSTIN", "EXPLICIT_MERCHANT_ID"] as const) {
    const left = claimIndex.get(kind);
    const right = candidateIndex.get(kind);
    if (!left?.size || !right?.size) continue;
    if (kind === "EXPLICIT_MERCHANT_ID") {
      // Only a shared namespace can conflict; two processors may number the same merchant differently.
      const namespaces = new Set([...left.keys()].map((key) => key.split(":")[0]));
      const shared = [...right.keys()].filter((key) => namespaces.has(key.split(":")[0]!));
      if (!shared.length) continue;
      if (shared.some((key) => left.has(key))) continue;
      return true;
    }
    if (![...left.keys()].some((key) => right.has(key))) return true;
  }
  return false;
}

export function resolveMerchantIdentity(input: {
  claim: MerchantIdentityClaim;
  candidates: readonly CanonicalMerchantRecord[];
  /** Merges the customer already reversed. Never proposed again without a new ask. */
  rejectedMerchantIds?: readonly string[];
}): MerchantIdentityResolution {
  const claimCurrency = input.claim.currency.trim().toUpperCase();
  const rejected = new Set(input.rejectedMerchantIds ?? []);
  const blocked: MerchantIdentityBlock[] = [];
  const scored: MerchantIdentityMatch[] = [];

  for (const candidateRecord of [...input.candidates].sort((left, right) => left.id.localeCompare(right.id))) {
    if (candidateRecord.currency.trim().toUpperCase() !== claimCurrency) {
      blocked.push({
        merchantId: candidateRecord.id,
        reason: "CURRENCY_MISMATCH",
        explanation: "Amounts in different currencies are kept as separate subscriptions.",
      });
      continue;
    }
    const { matches, claimIndex, candidateIndex } = compareMerchant(input.claim, candidateRecord);
    if (!matches.length) continue;
    if (hasConflictingLegalIdentity(claimIndex, candidateIndex)) {
      blocked.push({
        merchantId: candidateRecord.id,
        reason: "CONFLICTING_LEGAL_IDENTITY",
        explanation: "These receipts name two different registered businesses, so they stay separate.",
      });
      continue;
    }
    if (rejected.has(candidateRecord.id)) {
      blocked.push({
        merchantId: candidateRecord.id,
        reason: "USER_REJECTED",
        explanation: "You told us these are different subscriptions, so we keep them apart.",
      });
      continue;
    }
    const ordered = [...matches].sort((left, right) =>
      right.weight - left.weight
      || merchantIdentitySignalKinds.indexOf(left.kind) - merchantIdentitySignalKinds.indexOf(right.kind));
    const score = combineWeights(ordered);
    const strongestSignalKind = ordered[0]!.kind;
    const decisive = ordered.some((match) => decisiveSignalKinds.has(match.kind));
    const onlyFuzzy = ordered.every((match) => match.kind === "FUZZY_ALIAS");
    scored.push({
      merchantId: candidateRecord.id,
      score,
      strongestSignalKind,
      matchedSignals: ordered,
      evidenceIds: [...new Set(ordered.flatMap((match) => [...match.claimEvidenceIds, ...match.candidateEvidenceIds]))].sort(),
      reasons: ordered.map((match) => `We matched ${match.explanation}.`),
      autoMergeable: score >= merchantAutoMergeScore && !onlyFuzzy && (decisive || ordered.length >= 2),
    });
  }

  const ranked = scored
    .filter((entry) => entry.score >= merchantReviewScore)
    .sort((left, right) => right.score - left.score || left.merchantId.localeCompare(right.merchantId));
  const match = ranked[0] ?? null;
  const outcome = !match ? "NO_MATCH" : match.autoMergeable ? "AUTO_MERGE" : "REVIEW_SUGGESTED";

  const reasons = match
    ? outcome === "AUTO_MERGE"
      ? match.reasons
      : [...match.reasons, "We will not combine these without your say-so."]
    : blocked.length
      ? blocked.map((entry) => entry.explanation)
      : ["Nothing on this receipt links it to a subscription we already track."];

  return {
    outcome,
    match,
    alternatives: ranked.slice(1),
    blocked,
    reasons,
  };
}
