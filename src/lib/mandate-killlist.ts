// The UPI mandate kill-list — the India-first wedge.
//
// A recurring charge has two independent facts: WHAT you pay for (the merchant)
// and HOW the money leaves your account (the rail). India's auto-debit rails —
// UPI AutoPay, card e-mandates, NACH/ECS, bank standing instructions — keep
// pulling money even after you "cancel" at the merchant, because the mandate
// lives at your PSP or bank, not the merchant. This module reads the rail from
// the statement text and routes each mandate to where it is actually revoked.
//
// It is deterministic and honest: a charge only enters the kill-list when the
// evidence text literally shows a mandate token, and that exact token is carried
// through as `matchedText` so the claim can always be checked against the line.
// No model, no network, no database — provable from a statement upload alone.
import { primaryCurrency, type Frequency, type RecurringItem } from "./recurring-audit";
import { getRailGuide, findCancelAction, type CancelAction } from "./cancel-actions";

export type MandateRail = "upi-autopay" | "nach-ecs" | "card-mandate" | "standing-instruction" | "auto-debit";

export type MandateKill = {
  itemId: string;
  merchant: string;
  category: string;
  amount: number;
  currency: string;
  monthlyCost: number;
  frequency: Frequency;
  nextExpectedDate: string;
  rail: MandateRail;
  railLabel: string;
  /** The detected PSP/app or bank, when the text names one — else null. */
  pspHint: string | null;
  /** The exact token matched in the statement, so the classification is checkable. */
  matchedText: string;
  /** Where and how to revoke the mandate itself (bank/PSP side). */
  revoke: CancelAction;
  /** Cancelling at the merchant too, when we know that surface — else null. */
  merchantCancel: CancelAction | null;
  /** The one-line "cancelling at the merchant is not enough" warning. */
  warning: string;
  confidenceScore: number;
};

// Ordered, most-specific first. `token` is the string an Indian bank/UPI
// statement actually prints and is carried through as the proof; `require`, when
// present, is a co-token that must also appear for the classification to hold
// (so bare "AUTOPAY" is only UPI AutoPay when a UPI marker is nearby). This table
// is the domain-knowledge surface — extend it with the exact strings your real
// statements use (see corpus/).
const railSignatures: { rail: MandateRail; label: string; token: RegExp; require?: RegExp }[] = [
  { rail: "upi-autopay", label: "UPI AutoPay mandate", token: /\bUPI\s*[/-]?\s*AUTOPAY\b/i },
  { rail: "upi-autopay", label: "UPI AutoPay mandate", token: /\bUPIAP\b/i },
  { rail: "upi-autopay", label: "UPI AutoPay mandate", token: /\bAUTOPAY\b/i, require: /\bUPI\b|@[a-z]{2,}/i },
  { rail: "nach-ecs", label: "NACH / ECS auto-debit", token: /\bE?-?NACH\b/i },
  { rail: "nach-ecs", label: "NACH / ECS auto-debit", token: /\bECS\b/i },
  { rail: "card-mandate", label: "Card e-mandate", token: /\bE-?MANDATE\b/i },
  { rail: "card-mandate", label: "Card e-mandate", token: /\bSI\s*HUB\b/i },
  { rail: "card-mandate", label: "Card e-mandate", token: /\bMANDATE\b/i, require: /\bCARD\b/i },
  { rail: "standing-instruction", label: "Bank standing instruction", token: /\bSTANDING\s+INSTRUC?T?I?O?N?S?\b/i },
  // Generic auto-debit: a mandate/autopay token with no rail specifier. We do not
  // guess UPI vs card — the guidance sends the user to check both.
  { rail: "auto-debit", label: "Auto-debit mandate", token: /\bAUTOPAY\b/i },
  { rail: "auto-debit", label: "Auto-debit mandate", token: /\bMANDATE\b/i },
];

// PSP/app and bank hints, only surfaced when the text names one. Conservative on
// purpose: a wrong "revoke in PhonePe" is worse than no hint at all.
const pspSignatures: { hint: string; test: RegExp }[] = [
  { hint: "PhonePe", test: /\bPHONEPE\b|@ybl\b|@ibl\b/i },
  { hint: "Google Pay", test: /\bG(?:OOGLE)?\s*PAY\b|@ok[a-z]+\b/i },
  { hint: "Paytm", test: /\bPAYTM\b|@paytm\b|@pt[a-z]+\b/i },
  { hint: "Amazon Pay", test: /\bAMAZON\s*PAY\b|@apl\b|@yapl\b|@axl\b/i },
  { hint: "BHIM", test: /\bBHIM\b/i },
  { hint: "CRED", test: /\bCRED\b/i },
];

export function buildMandateKillList(items: RecurringItem[]): MandateKill[] {
  const kills: MandateKill[] = [];
  for (const item of items) {
    const detection = detectMandateRail(mandateHaystack(item));
    if (!detection) continue;

    kills.push({
      itemId: item.identityKey,
      merchant: item.merchant,
      category: item.category,
      amount: item.averageAmount,
      currency: item.currency,
      monthlyCost: item.monthlyCost,
      frequency: item.frequency,
      nextExpectedDate: item.nextExpectedDate,
      rail: detection.rail,
      railLabel: detection.label,
      pspHint: detection.pspHint,
      matchedText: detection.matchedText,
      revoke: resolveRevokeGuide(detection.rail, item.category),
      merchantCancel: findCancelAction(item.merchant, item.category),
      warning: buildWarning(item.merchant, detection),
      confidenceScore: item.confidenceScore,
    });
  }
  // Soonest debit first, then the biggest bleed.
  return kills.sort((left, right) => left.nextExpectedDate.localeCompare(right.nextExpectedDate) || byPrimaryFirst(left.currency, right.currency) || right.monthlyCost - left.monthlyCost);
}

// Classify the debit rail from statement text. Returns the matched token so the
// classification is always checkable; null when no mandate token is present.
export function detectMandateRail(text: string): { rail: MandateRail; label: string; matchedText: string; pspHint: string | null } | null {
  for (const signature of railSignatures) {
    if (signature.require && !signature.require.test(text)) continue;
    const match = signature.token.exec(text);
    if (match) {
      return {
        rail: signature.rail,
        label: signature.label,
        matchedText: extractMatchedToken(text, match),
        pspHint: detectPsp(text),
      };
    }
  }
  return null;
}

function detectPsp(text: string): string | null {
  for (const signature of pspSignatures) {
    if (signature.test.test(text)) return signature.hint;
  }
  return null;
}

// EMI, SIP, and insurance debits are consequential — stopping a loan hurts your
// credit, lapsing a policy can forfeit value. For those the revoke guide is the
// purpose-specific one (foreclose / pause / review), not a blunt "kill it". Only
// a genuine subscription-style mandate gets the mechanism revoke guide.
function resolveRevokeGuide(rail: MandateRail, category: string): CancelAction {
  const purpose = category.toLowerCase();
  if (/\b(?:debt|emi|loan)/.test(purpose)) return getRailGuide("emi");
  if (/\b(?:invest|sip|mutual)/.test(purpose)) return getRailGuide("sip");
  if (/insur/.test(purpose)) return getRailGuide("insurance");

  switch (rail) {
    case "upi-autopay":
      return getRailGuide("upiAutopay");
    case "nach-ecs":
      return getRailGuide("nach");
    case "card-mandate":
    case "standing-instruction":
      return getRailGuide("cardMandate");
    case "auto-debit":
      return autoDebitGuide;
  }
}

// The generic-mandate guide: we could not read the rail, so send the user to
// check both surfaces rather than guess one.
const autoDebitGuide: CancelAction = {
  merchantLabel: "Auto-debit mandate",
  kind: "rail-guide",
  steps: [
    "The statement shows an auto-debit mandate but not which rail — check both",
    "UPI app (Google Pay / PhonePe / Paytm → Autopay / Mandates) — pause or remove the mandate",
    "Bank net-banking → e-Mandates / registered mandates / SI Hub — cancel the one for this biller",
  ],
  caveat: "Also tell the biller you are stopping, so they do not register a fresh mandate.",
};

function buildWarning(merchant: string, detection: { rail: MandateRail; label: string; pspHint: string | null }): string {
  return `Cancelling at ${merchant} alone will not stop this — the ${detection.label.toLowerCase()} keeps pulling until you revoke it ${revokeWhere(detection.rail, detection.pspHint)}.`;
}

function revokeWhere(rail: MandateRail, pspHint: string | null): string {
  if (pspHint) return `in ${pspHint}`;
  switch (rail) {
    case "nach-ecs":
    case "standing-instruction":
      return "at your bank";
    case "card-mandate":
      return "at your bank or card app";
    default:
      return "in your UPI app or bank";
  }
}

// The text a mandate can hide in: the merchant name plus every raw statement
// description behind the commitment, plus any risk tags the engine attached.
function mandateHaystack(item: RecurringItem): string {
  return [
    item.merchant,
    item.normalizedMerchant,
    ...item.evidence.map((evidence) => evidence.description),
    ...item.riskTags,
  ].join(" • ");
}

// Widen the token hit to its surrounding whitespace-delimited word so the proof
// shown to the user is readable ("UPI AUTOPAY"), not a bare character span. The
// match is always a real token now, so this only trims to word boundaries.
function extractMatchedToken(text: string, match: RegExpExecArray): string {
  const start = Math.max(0, text.lastIndexOf(" ", match.index) + 1);
  const matchEnd = match.index + match[0].length;
  const nextSpace = text.indexOf(" ", matchEnd);
  const end = nextSpace === -1 ? text.length : nextSpace;
  return text.slice(start, end).replace(/•/g, "").trim().slice(0, 48) || match[0].trim();
}

function byPrimaryFirst(left: string, right: string): number {
  if (left === right) return 0;
  if (left === primaryCurrency) return -1;
  if (right === primaryCurrency) return 1;
  return left.localeCompare(right);
}
