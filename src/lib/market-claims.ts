import { commitmentControlPilotOffer } from "@/lib/pilot-offer";

export type MarketClaimViolationCode =
  | "AUTONOMOUS_ACTION"
  | "AUTOMATIC_RENEWAL"
  | "FREE_OFFER"
  | "INVENTED_CUSTOMER_PROOF"
  | "INVENTED_OUTCOME_PROOF"
  | "OFFER_CONTRACT_MISSING"
  | "RETIRED_PRICE"
  | "SECURITY_OVERCLAIM"
  | "UNAUTHORIZED_PRICE"
  | "UNAUTHORIZED_SCOPE"
  | "UNBOUNDED_CARE_PROMISE";

export type MarketClaimViolation = {
  code: MarketClaimViolationCode;
  line: number;
  remediation: string;
};

type MarketCopyOptions = {
  requireOfferContract: boolean;
};

type TextSegment = {
  line: number;
  text: string;
};

const canonicalAmountMajor = commitmentControlPilotOffer.amountMinor / 100;
const canonicalAmountDisplay = canonicalAmountMajor.toLocaleString("en-IN");
const canonicalOfferContract = normalizeWhitespace(`
  The pilot is a one-time ₹${canonicalAmountDisplay} payment for one month.
  It includes one policy setup, up to ${numberWord(commitmentControlPilotOffer.proposalLimit)} proposals, up to ${numberWord(commitmentControlPilotOffer.reconciliationReviewLimit)} weekly 30-minute reconciliation reviews, and up to ${numberWord(commitmentControlPilotOffer.additionalFounderSupportMinutes / 60)} additional founder-support hours. There is no automatic renewal. A second month requires a separate purchase.
  Vognary records decisions and evidence. It never auto-approves, purchases, provisions, cancels, or moves money.
  Payment reserves the pilot. Real customer data and activation remain blocked until the independent assessment/retest and legal/security gates clear. If Vognary cannot activate within ${numberWord(commitmentControlPilotOffer.activationDeadlineBusinessDays)} business days after payment, you may request a full refund.
`);

const remediations: Record<MarketClaimViolationCode, string> = {
  AUTONOMOUS_ACTION: "State that Vognary records a human decision and never blocks, approves, purchases, provisions, cancels, or moves money.",
  AUTOMATIC_RENEWAL: "State that there is no automatic renewal and a second month requires a separate purchase.",
  FREE_OFFER: "Use the authorized one-time pilot price; do not promise a free pilot, trial, audit, or implementation.",
  INVENTED_CUSTOMER_PROOF: "Remove customer or traction claims unless repository evidence supports them.",
  INVENTED_OUTCOME_PROOF: "Remove savings, ROI, or outcome claims unless cited customer evidence supports them.",
  OFFER_CONTRACT_MISSING: "Use the complete canonical one-time pilot contract from docs/templates/outreach-scripts.md.",
  RETIRED_PRICE: "Remove retired or unapproved pricing and use only the canonical pilot contract.",
  SECURITY_OVERCLAIM: "Describe the independent assessment as open until assessment and retest evidence close it.",
  UNAUTHORIZED_PRICE: "Use only the canonical one-time pilot price in commercial price, cost, payment, and invoice statements.",
  UNAUTHORIZED_SCOPE: "Remove the unapproved SLA or scope promise and use the canonical pilot scope.",
  UNBOUNDED_CARE_PROMISE: "Name the covered workflow and the human action still required; do not promise universal handling or freedom from all worry.",
};

export function validateMarketCopy(
  text: string,
  options: MarketCopyOptions,
): MarketClaimViolation[] {
  const normalized = text.normalize("NFKC");
  const violations: MarketClaimViolation[] = [];

  for (const segment of splitSegments(normalized)) {
    const value = segment.text;
    if (isEditorialInstruction(value)) continue;
    if (isPositiveRetiredPrice(value)) addViolation(violations, "RETIRED_PRICE", segment.line);
    if (isPositiveFreeOffer(value)) addViolation(violations, "FREE_OFFER", segment.line);
    if (isPositiveAutonomousAction(value)) addViolation(violations, "AUTONOMOUS_ACTION", segment.line);
    if (isPositiveAutomaticRenewal(value)) addViolation(violations, "AUTOMATIC_RENEWAL", segment.line);
    if (isPositiveCustomerProof(value)) addViolation(violations, "INVENTED_CUSTOMER_PROOF", segment.line);
    if (isPositiveOutcomeProof(value)) addViolation(violations, "INVENTED_OUTCOME_PROOF", segment.line);
    if (isPositiveSecurityClaim(value)) addViolation(violations, "SECURITY_OVERCLAIM", segment.line);
    if (isPositiveUnauthorizedScope(value)) addViolation(violations, "UNAUTHORIZED_SCOPE", segment.line);
    if (isUnboundedCarePromise(value)) addViolation(violations, "UNBOUNDED_CARE_PROMISE", segment.line);
    if (hasUnauthorizedCommercialPrice(value)) addViolation(violations, "UNAUTHORIZED_PRICE", segment.line);
  }

  if (options.requireOfferContract && !normalizeWhitespace(normalized).includes(canonicalOfferContract)) {
    addViolation(violations, "OFFER_CONTRACT_MISSING", 1);
  }

  return violations.sort((left, right) => left.line - right.line || left.code.localeCompare(right.code));
}

function splitSegments(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  for (const [lineIndex, line] of text.split(/\r?\n/).entries()) {
    for (const sentence of line.split(/(?<=[.!?])\s+/)) {
      for (const clause of sentence.split(/\s*(?:,|;)?\s*\b(?:and|but|however|yet|although|though|while|whereas)\b\s*/i)) {
        const value = clause.trim();
        if (value) segments.push({ line: lineIndex + 1, text: value });
      }
    }
  }
  return segments;
}

function isPositiveRetiredPrice(text: string) {
  return /(?:₹\s*|INR\s*)(?:999(?:\s*\/\s*month)?|4,?999|40,?000|75,?000)\b/i.test(text)
    && !isNegated(text);
}

function isPositiveFreeOffer(text: string) {
  const freeWords = /\bfree\s+(?:audit|implementation|pilot|trial)\b/i.test(text);
  const zeroPrice = /\b(?:pilot|trial|audit|implementation)\b[\s\S]{0,50}\b(?:costs?|price|payment)?\s*(?:is\s*)?(?:₹\s*|INR\s*)0\b/i.test(text);
  return (freeWords || zeroPrice) && !isNegated(text);
}

function isPositiveAutonomousAction(text: string) {
  const autonomousDecision = /\b(?:Vognary|we)\b[\s\S]{0,60}\b(?:autonomously|automatically|auto-)\s*(?:approv\w*|den\w*)\b/i.test(text);
  const enforcedTransaction = /\b(?:Vognary|we)\b[\s\S]{0,60}\b(?:blocks?|prevents?|stops?|cancels?|purchases?|provisions?|moves?\s+money)\b/i.test(text);
  const passiveDecision = /\b(?:AI\s+)?spend\b[\s\S]{0,45}\b(?:approved|denied)\s+(?:automatically|autonomously)\s+by\s+Vognary\b/i.test(text);
  return (autonomousDecision || enforcedTransaction || passiveDecision) && !isNegated(text);
}

function isPositiveAutomaticRenewal(text: string) {
  const statement = /\bauto-renews?\b|\bautomatically\s+renews?\b|\brenews?\s+automatically\b|\bautomatic\s+renewal\b|\b(?:pilot|subscription|plan)\b[\s\S]{0,30}\brenews?\s+(?:monthly|annually|each\s+month|every\s+month|each\s+year|every\s+year)\b/i.test(text);
  return statement && !isNegated(text);
}

function isPositiveCustomerProof(text: string) {
  const numberedCustomers = /\b(?:[1-9]\d*|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:[- ]\w+)?)\s+(?:paid\s+)?(?:customers?|companies)\b/i.test(text);
  const payingCompanies = /\b(?:customers?|companies)\s+(?:already\s+)?(?:pay|use|trust)\b/i.test(text);
  const trustedBy = /\btrusted\s+by\s+(?:leading|top|global|innovative|AI|finance|technology|\d+)\b/i.test(text);
  return (numberedCustomers || payingCompanies || trustedBy) && !isNegated(text);
}

function isPositiveOutcomeProof(text: string) {
  const savedAmount = /\b(?:saved|saves?|cut|reduced?)\b[\s\S]{0,35}(?:₹\s*|INR\s*|\d+(?:\.\d+)?\s*%)/i.test(text);
  const provenOutcome = /\bproven\s+(?:ROI|outcomes?|savings)\b|\bROI\s+(?:of|=)/i.test(text);
  const achievedOutcome = /\b(?:customers?|companies|teams)\b[\s\S]{0,25}\b(?:achieved|reported|saw)\b[\s\S]{0,25}\b\d+(?:\.\d+)?\s*%[\s\S]{0,25}\b(?:lower|less|reduction|savings?)\b/i.test(text);
  return (savedAmount || provenOutcome || achievedOutcome) && !isNegated(text);
}

function isPositiveSecurityClaim(text: string) {
  const passed = /\b(?:we|Vognary)\b[\s\S]{0,35}\b(?:passed|completed|cleared)\b[\s\S]{0,45}\b(?:independent\s+)?security\s+(?:assessment|audit|review)\b/i.test(text);
  const assessmentPassed = /\b(?:independent\s+)?security\s+(?:assessment|audit|review)\b[\s\S]{0,25}\b(?:passed|completed|cleared)\b/i.test(text);
  const assessmentComplete = /\b(?:independent\s+)?security\s+(?:assessment|audit|review)\b[\s\S]{0,20}\b(?:is|was)\s+(?:complete|passed|cleared)\b/i.test(text);
  const certified = /\b(?:ISO\s*27001|SOC\s*2)\s+certified\b|\bindependently\s+audited\b/i.test(text);
  return (passed || assessmentPassed || assessmentComplete || certified) && !isNegated(text);
}

function isPositiveUnauthorizedScope(text: string) {
  const responseSla = /\b(?:one[- ]business[- ]day|24[- ]hour)\s+response\s+SLA\b|\bincludes?\s+(?:a\s+)?response\s+SLA\b/i.test(text);
  return responseSla && !isNegated(text);
}

function isUnboundedCarePromise(text: string) {
  const universalHandling = /\b(?:Vognary|we)\b[\s\S]{0,35}\b(?:takes?\s+care\s+of|handles?)\b[\s\S]{0,24}\b(?:everything|it\s+all|every\s+commitment)\b/i.test(text);
  const worryFree = /\b(?:you|I)\s+(?:do\s+not|don(?:'|’)t|never|no\s+longer)\s+(?:need\s+to\s+)?worry(?:\s+(?:again|anymore|about\s+(?:anything|everything)))?\s*[.!?]?$/i.test(text);
  const nothingToWorry = /\b(?:you\s+have\s+)?nothing\s+to\s+worry\s+about\b/i.test(text);
  return worryFree || nothingToWorry || (universalHandling && !isNegated(text));
}

function hasUnauthorizedCommercialPrice(text: string) {
  if (!/\b(?:pilot|price|costs?|invoice|payment|total)\b/i.test(text) || isNegated(text)) return false;
  if (/(?:\$|€|£)\s*\d|\b(?:USD|EUR|GBP)\s*\d/i.test(text)) return true;
  const amounts = [...text.matchAll(/(?:₹\s*|INR\s*)(\d[\d,]*)/gi)]
    .map((match) => Number(match[1].replaceAll(",", "")));
  return amounts.some((amount) => amount !== canonicalAmountMajor);
}

function isNegated(text: string) {
  return /\b(?:no|not|never|cannot|can't|doesn't|does\s+not|hasn't|has\s+not|haven't|have\s+not|will\s+not|won't|without)\b/i.test(text);
}

function isEditorialInstruction(text: string) {
  return /^(?:avoid|remove|reject|forbid|do\s+not|don't|never)\s+(?:claiming|claims?\s+that|saying|writing|promising|describing|stating)\b/i.test(text);
}

function addViolation(
  violations: MarketClaimViolation[],
  code: MarketClaimViolationCode,
  line: number,
) {
  if (violations.some((violation) => violation.code === code)) return;
  violations.push({ code, line, remediation: remediations[code] });
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function numberWord(value: number) {
  const words = [
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
  ];
  const word = words[value];
  if (!word) throw new Error("Canonical pilot offer contains an unsupported display number.");
  return word;
}