export const publicOffer = {
  id: "assisted-private-audit",
  version: 1,
  plan: "assisted-audit",
  legacyPlan: "annual",
  termsVersion: "terms-2026-07-13",
  title: "Assisted private audit",
  entitlementLabel: "One assisted private audit",
  amountMinor: 99_900,
  currency: "INR",
  autoRenews: false,
  refundSummary: "Request before evidence review begins for a full refund. After review begins, eligibility depends on work completed and applicable law. Vognary issues a full refund if it cancels the audit.",
} as const;
