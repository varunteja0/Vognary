export const commitmentControlPilotOffer = {
  id: "commitment-control-private-pilot",
  version: 3,
  termsVersion: "terms-2026-09-01",
  title: "Commitment Control private pilot",
  amountMinor: 1_499_900,
  currency: "INR",
  billingMode: "ONE_TIME",
  pilotMonths: 1,
  proposalLimit: 10,
  reconciliationReviewLimit: 4,
  additionalFounderSupportMinutes: 120,
  activationDeadlineBusinessDays: 10,
} as const;

export function pilotOfferMajorUnits() {
  return commitmentControlPilotOffer.amountMinor / 100;
}
