export const commitmentControlPilotOffer = {
  id: "commitment-control-private-pilot",
  version: 2,
  termsVersion: "terms-2026-08-27",
  title: "Commitment Control private pilot",
  amountMinor: 1_499_900,
  currency: "INR",
  interval: "month",
} as const;

export function pilotOfferMajorUnits() {
  return commitmentControlPilotOffer.amountMinor / 100;
}
