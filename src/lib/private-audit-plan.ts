export type RedactionFirstSourcePlan = {
  title: string;
  startWith: string;
  keepVisible: string[];
  remove: string[];
};

export function buildRedactionFirstSourcePlan(input: {
  sourceTypes?: readonly string[];
  paymentTypes?: readonly string[];
}): RedactionFirstSourcePlan {
  const sources = new Set(input.sourceTypes ?? []);
  const payments = new Set(input.paymentTypes ?? []);

  if (sources.has("Gmail receipt snippets") || payments.has("AI tools") || payments.has("SaaS tools")) {
    return {
      title: "Receipt-first plan",
      startWith: "Start with 2–5 redacted receipt or invoice snippets in the audit app.",
      keepVisible: ["Merchant or provider", "Amount and currency", "Paid, due, or renewal date", "Renewal cadence or plan name"],
      remove: ["Email address", "Account or customer ID", "Billing address", "Payment instrument details"],
    };
  }

  if (sources.has("UPI/card mandate screenshot") || payments.has("UPI AutoPay") || payments.has("Card mandates")) {
    return {
      title: "Mandate-first plan",
      startWith: "Start with a manual list from the official mandate screen; do not upload the whole screen.",
      keepVisible: ["Merchant", "Amount and frequency", "Next debit date", "Active or paused status"],
      remove: ["UPI ID", "Card or bank account number", "Mandate reference", "Personal notifications"],
    };
  }

  return {
    title: "Statement-first plan",
    startWith: "Start with a redacted CSV or XLSX covering at least two billing cycles.",
    keepVisible: ["Transaction date", "Merchant description", "Debit amount and currency", "Column headers"],
    remove: ["Name and address", "Account and card numbers", "Transaction references", "Unrelated credit transactions"],
  };
}

