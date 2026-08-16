import { createHash } from "node:crypto";

export const standingMandateTermsVersion = "standing-mandate-2026-08-14";
export const standingMandateVetoHours = 48;
export const defaultPerActionCeilingMinor = BigInt(5_000_000); // ₹50,000
export const defaultRolling30dCeilingMinor = BigInt(20_000_000); // ₹200,000

export const standingMandateSignedText = [
  "I authorize Vognary to cancel supported discretionary subscriptions under this standing mandate.",
  "Vognary may act only after a successfully delivered 48-hour veto notice, and only on merchants in the supported registry.",
  "EMI, SIP, insurance, utilities, and cloud infrastructure cannot enter execution.",
  "Silence after the notice authorizes only what this mandate already permits.",
  "I can veto a queued case or revoke this mandate at any time before execution.",
  "Vognary will not ask me for passwords, OTPs, CVV, or bank login.",
].join(" ");

export function hashStandingMandateText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function standingMandateTextHash(): string {
  return hashStandingMandateText(standingMandateSignedText);
}

export type StandingMandateStatus = "ACTIVE" | "REVOKED";

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
