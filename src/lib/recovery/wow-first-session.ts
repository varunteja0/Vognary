/**
 * First-session spoken copy. Does not invent money, dates, or merchants.
 * It only phrases already-cited decision-card fields.
 */
import type { Decision, DecisionCycleAction, DecisionReasonKey } from "./contracts";

export function spokenDecisionSentence(input: {
  merchant: string;
  amountDisplay: string;
  whenLine: string;
  overlapMerchants: readonly string[];
  provisional: boolean;
  undecided: boolean;
}): string {
  const parts = [`${input.merchant} charges ${input.amountDisplay}.`];
  if (input.whenLine && input.whenLine !== "Date not established") {
    parts.push(input.whenLine.endsWith(".") ? input.whenLine : `${input.whenLine}.`);
  }
  if (input.overlapMerchants.length === 1) {
    parts.push(`You also pay ${input.overlapMerchants[0]}.`);
  } else if (input.overlapMerchants.length === 2) {
    parts.push(`You also pay ${input.overlapMerchants[0]} and ${input.overlapMerchants[1]}.`);
  } else if (input.overlapMerchants.length > 2) {
    const last = input.overlapMerchants.at(-1);
    parts.push(`You also pay ${input.overlapMerchants.slice(0, -1).join(", ")}, and ${last}.`);
  }
  if (input.provisional) parts.push("Seen once. Cadence is not proven.");
  if (input.undecided) parts.push("You have not decided this cycle.");
  return parts.join(" ");
}

export function receiptQuote(excerpt: string | null | undefined): string | null {
  const trimmed = excerpt?.replace(/\s+/g, " ").trim() ?? "";
  if (!trimmed) return null;
  const bounded = trimmed.length > 180 ? `${trimmed.slice(0, 177).trimEnd()}…` : trimmed;
  return bounded;
}

export function keepIsPrimary(reasonKeys: readonly DecisionReasonKey[]): boolean {
  return !reasonKeys.some((key) => (
    key === "PRICE_INCREASE"
    || key === "OVERLAP_NO_PURPOSE"
    || key === "PROVISIONAL_SINGLE"
    || key === "AMOUNT_CONFLICT"
    || key === "IDENTITY_UNCERTAIN"
  ));
}

export function decisionHookCopy(input: {
  merchant: string;
  action: DecisionCycleAction;
  watchDate: string | null;
}): { title: string; body: string } {
  const when = input.watchDate ? ` around ${input.watchDate}` : " at the next expected window";
  if (input.action === "PLAN_TO_CANCEL") {
    return {
      title: `${input.merchant} — plan to cancel is recorded`,
      body: `Vognary will watch${when}. If ${input.merchant} charges again, you will see it. Missing evidence is not cancellation. We never cancel it for you.`,
    };
  }
  if (input.action === "REVIEW_LATER") {
    return {
      title: `${input.merchant} — review later`,
      body: `This comes back before the charge. Nothing is cancelled. Vognary will watch${when}.`,
    };
  }
  return {
    title: `${input.merchant} — kept for this cycle`,
    body: `Vognary will watch${when}. If the charge matches, this goes quiet. If it doesn't, you will see it.`,
  };
}

export function guestDecisionHookCopy(input: {
  merchant: string;
  action: DecisionCycleAction;
  watchDate: string | null;
}): { title: string; body: string } {
  const when = input.watchDate ? ` around ${input.watchDate}` : " at the next expected window";
  if (input.action === "PLAN_TO_CANCEL") {
    return {
      title: `${input.merchant} — plan to cancel`,
      body: `Sign in to remember this plan. Vognary will then watch${when}. If ${input.merchant} charges again, you will see it. Missing evidence is not cancellation. Vognary never cancels it for you.`,
    };
  }
  if (input.action === "REVIEW_LATER") {
    return {
      title: `${input.merchant} — review before the charge`,
      body: `Sign in to remember this review. Vognary will then bring it back before the charge and watch${when}. Nothing is cancelled.`,
    };
  }
  return {
    title: `${input.merchant} — keep this cycle`,
    body: `Sign in to remember this decision. Vognary will then watch${when}. If the charge matches, this goes quiet. If it doesn't, you will see it.`,
  };
}

export function actionFromDecision(decision: Decision): DecisionCycleAction | null {
  if (decision === "KEEP") return "KEEP";
  if (decision === "MONITOR") return "REVIEW_LATER";
  if (decision === "CANCEL") return "PLAN_TO_CANCEL";
  return null;
}

export const paymentAskQuestion =
  "If Vognary kept this current and caught these decisions before the charge, would you pay for it?";

export const reminderOffer =
  "Email me before this charge. Vognary will not cancel anything.";

export function decisionArtefactText(input: {
  merchant: string;
  amountDisplay: string;
  whenLine: string | null;
  action: DecisionCycleAction | null;
  excerpt: string | null;
  remembered?: boolean;
}): string {
  const lines = ["VOGNARY DECISION", `${input.merchant} · ${input.amountDisplay}`];
  if (input.whenLine && input.whenLine !== "Date not established") lines.push(input.whenLine);
  if (input.action === "KEEP") lines.push("Decision: kept for this cycle.");
  if (input.action === "REVIEW_LATER") lines.push("Decision: review before the charge.");
  if (input.action === "PLAN_TO_CANCEL") lines.push("Decision: plan to cancel this cycle.");
  if (!input.action) lines.push("You have not decided this cycle.");
  if (input.excerpt) lines.push(`From the receipt: ${input.excerpt}`);
  lines.push(input.remembered === false
    ? "Sign in to ask Vognary to remember this and watch the next window. It never cancels a service and never moves money."
    : "Vognary will watch the next window. It never cancels a service and never moves money.");
  lines.push("vognary.com");
  return lines.join("\n");
}

export function shouldOfferPaymentAsk(decidedCount: number, verifiedOutcomeCount: number): boolean {
  return decidedCount >= 2 || verifiedOutcomeCount >= 1;
}

export function confirmedReceiptText(input: {
  merchant: string;
  amount: string;
  currency: string;
  date: string;
}): string | null {
  const merchant = input.merchant.replace(/\s+/g, " ").trim();
  const amount = input.amount.replace(/,/g, "").trim();
  const currency = input.currency.trim().toUpperCase();
  const date = input.date.trim();
  if (merchant.length < 2 || merchant.length > 80) return null;
  if (!/^[A-Z]{3}$/.test(currency)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(amount)) return null;
  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return `${merchant} invoice paid ${currency} ${amount} on ${date}.`;
}

export function isReceiptImageFile(file: Pick<File, "name" | "type">): boolean {
  const name = file.name.toLowerCase();
  if (/\.(png|jpe?g|webp|heic|heif|gif)$/i.test(name)) return true;
  return file.type.startsWith("image/");
}
