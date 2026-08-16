export const standingMandateTermsVersion = "standing-mandate-2026-08-16";
export const standingMandateVetoHours = 48;
export const standingMandateCurrency = "INR";
export const defaultPerActionCeilingMinor = BigInt(5_000_000); // ₹50,000
export const defaultRolling30dCeilingMinor = BigInt(20_000_000); // ₹2,00,000

export function formatStandingMandateCeiling(minor: bigint, currency: string): string {
  if (currency !== "INR") {
    throw new Error("Standing mandate copy currently publishes INR ceilings only.");
  }
  if (minor <= BigInt(0) || minor % BigInt(100) !== BigInt(0)) {
    throw new Error("Mandate ceilings must be whole INR amounts.");
  }
  const major = (minor / BigInt(100)).toString();
  const finalGroup = major.slice(-3);
  const leadingGroups = major.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  const grouped = leadingGroups ? `${leadingGroups},${finalGroup}` : finalGroup;
  return `${currency} ₹${grouped}`;
}

const perActionCeilingCopy = formatStandingMandateCeiling(defaultPerActionCeilingMinor, standingMandateCurrency);
const rollingCeilingCopy = formatStandingMandateCeiling(defaultRolling30dCeilingMinor, standingMandateCurrency);

export const standingMandateSignedText = [
  "I authorize Vognary to cancel supported discretionary subscriptions under this standing mandate.",
  "Vognary may act only after a successfully delivered 48-hour veto notice, and only on merchants in the supported registry.",
  "EMI, SIP, insurance, utilities, and cloud infrastructure cannot enter execution.",
  `Authority is limited to ${perActionCeilingCopy} per action and ${rollingCeilingCopy} rolling 30-day ceiling.`,
  "Silence after the notice authorizes only what this mandate already permits.",
  "I can veto a queued case or revoke this mandate at any time before execution.",
  "Vognary will not ask me for passwords, OTPs, CVV, or bank login.",
].join(" ");

export function assertStandingMandateCeilings(perActionCeilingMinor: bigint, rolling30dCeilingMinor: bigint) {
  if (perActionCeilingMinor <= BigInt(0)) throw new Error("Per-action ceiling must be positive.");
  if (rolling30dCeilingMinor < perActionCeilingMinor) throw new Error("Rolling 30-day ceiling must cover the per-action ceiling.");
}

export function isWithinMandateCeilings(input: {
  amountMinor: bigint;
  rolling30dExecutedMinor: bigint;
  perActionCeilingMinor: bigint;
  rolling30dCeilingMinor: bigint;
}): boolean {
  return input.amountMinor <= input.perActionCeilingMinor
    && input.rolling30dExecutedMinor + input.amountMinor <= input.rolling30dCeilingMinor;
}
