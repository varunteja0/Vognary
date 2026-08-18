/**
 * Default Gmail billing-only filter for Decision B.
 *
 * Official Gmail behavior this module depends on:
 * - Verify a forwarding address, then filter-forward matching mail while
 *   leaving global forwarding off. https://support.google.com/mail/answer/10957
 * - A forwarding filter affects new messages only. https://support.google.com/mail/answer/6579
 * - Search operators, including subject: grouping and OR. https://support.google.com/mail/answer/7190
 *
 * The query is subject-only on purpose: body matching forwards sales pitches,
 * legal threads, and other confidential mail that merely mention "invoice".
 * has:attachment is omitted because many SaaS receipts are HTML-only.
 *
 * The founder controls the query. This default is the safest useful starting
 * rule, not complete coverage.
 */

export const billingFilterIncludePhrases = [
  "receipt",
  "invoice",
  "payment confirmation",
  "payment received",
  "tax invoice",
  "gst invoice",
  "amount charged",
  "we've charged",
  "we charged",
  "card was charged",
  "billing statement",
  "payment receipt",
  "invoice is ready",
] as const;

export const billingFilterExcludePhrases = [
  "payout",
  "you received a payment",
  "payment to you",
  "order shipped",
  "boarding pass",
  "order confirmation",
] as const;

export const gmailForwardingHelpUrl = "https://support.google.com/mail/answer/10957?hl=en";
export const gmailFilterHelpUrl = "https://support.google.com/mail/answer/6579?hl=en";
export const gmailSearchHelpUrl = "https://support.google.com/mail/answer/7190?hl=en";
export const gmailAttachmentHelpUrl = "https://support.google.com/mail/answer/9261412?hl=en";
export const outlookForwardingHelpUrl = "https://support.microsoft.com/en-us/office/use-rules-to-automatically-forward-messages";

function quotePhrase(phrase: string) {
  return /[^a-z0-9]+/i.test(phrase) ? `"${phrase}"` : phrase;
}

export function defaultGmailBillingFilterQuery(): string {
  const include = billingFilterIncludePhrases.map(quotePhrase).join(" OR ");
  const exclude = billingFilterExcludePhrases.map(quotePhrase).join(" OR ");
  return `subject:(${include}) -subject:(${exclude})`;
}

export function subjectMatchesDefaultBillingFilter(subject: string): boolean {
  const haystack = subject.toLowerCase();
  const included = billingFilterIncludePhrases.some((phrase) => haystack.includes(phrase.toLowerCase()));
  const excluded = billingFilterExcludePhrases.some((phrase) => haystack.includes(phrase.toLowerCase()));
  return included && !excluded;
}

export const billingFilterLikelyMatches = [
  "Receipt from Stripe",
  "Your ChatGPT receipt",
  "Invoice is ready for Google Cloud",
  "Your AWS Invoice is ready for August",
  "Amazon Web Services Billing Statement",
  "Your GitHub Copilot payment receipt",
  "Your receipt from Notion",
  "Receipt from Figma",
  "Tax invoice from Zoho",
  "GST invoice — GitHub",
  "We've charged your card for Slack",
  "We charged your card for Slack",
  "Payment confirmation — Linear",
  "Your Amazon Web Services Invoice is ready",
] as const;

export const billingFilterLikelyMisses = [
  "Your ChatGPT Plus is now active",
  "GitHub Copilot subscription",
  "Welcome to Notion Business",
  "Update your payment method",
  "Your Figma Professional plan",
  "Action required: billing address",
] as const;

export const billingFilterLikelyFalsePositivesAvoided = [
  "You received a payment via Stripe",
  "Stripe payout is on the way",
  "Your Amazon.in order confirmation",
  "Boarding pass — DEL to BLR",
  "Your package has been shipped",
] as const;

export type BillingSetupStep =
  | "ALIAS_CREATED"
  | "VERIFICATION_WAITING"
  | "VERIFICATION_PROVEN"
  | "FIRST_AUTOMATIC_RECEIPT_WAITING"
  | "FIRST_AUTOMATIC_RECEIPT_RECEIVED"
  | "SOURCE_HEALTHY";

export const billingSetupStepOrder = [
  "ALIAS_CREATED",
  "VERIFICATION_WAITING",
  "VERIFICATION_PROVEN",
  "FIRST_AUTOMATIC_RECEIPT_WAITING",
  "FIRST_AUTOMATIC_RECEIPT_RECEIVED",
  "SOURCE_HEALTHY",
] as const satisfies readonly BillingSetupStep[];

export const billingSetupStepLabels: Record<BillingSetupStep, string> = {
  ALIAS_CREATED: "Address ready",
  VERIFICATION_WAITING: "Verification waiting",
  VERIFICATION_PROVEN: "Verification proven",
  FIRST_AUTOMATIC_RECEIPT_WAITING: "First matching email waiting",
  FIRST_AUTOMATIC_RECEIPT_RECEIVED: "First matching email received",
  SOURCE_HEALTHY: "Source healthy",
};

export function billingSetupProgress(status: {
  state: string;
  alias: unknown;
  forwardingVerifiedAt: string | null;
  setupCompletedAt: string | null;
  gmailVerification?: { receivedAt: string } | null;
}): { current: BillingSetupStep; completed: BillingSetupStep[] } {
  if (!status.alias) {
    return { current: "ALIAS_CREATED", completed: [] };
  }

  const completed: BillingSetupStep[] = ["ALIAS_CREATED"];
  if (status.forwardingVerifiedAt) completed.push("VERIFICATION_WAITING", "VERIFICATION_PROVEN");
  if (status.setupCompletedAt) completed.push("FIRST_AUTOMATIC_RECEIPT_WAITING", "FIRST_AUTOMATIC_RECEIPT_RECEIVED");
  if (status.state === "READY" && status.setupCompletedAt) completed.push("SOURCE_HEALTHY");

  let current: BillingSetupStep = "VERIFICATION_WAITING";
  if (status.forwardingVerifiedAt && !status.setupCompletedAt) {
    current = "FIRST_AUTOMATIC_RECEIPT_WAITING";
  } else if (status.setupCompletedAt && status.state === "READY") {
    current = "SOURCE_HEALTHY";
  } else if (status.setupCompletedAt) {
    current = "FIRST_AUTOMATIC_RECEIPT_RECEIVED";
  }

  return { current, completed: uniqueSteps(completed) };
}

function uniqueSteps(steps: BillingSetupStep[]) {
  return billingSetupStepOrder.filter((step) => steps.includes(step));
}
