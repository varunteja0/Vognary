import "server-only";
import { createHash } from "node:crypto";
import { standingMandateSignedText } from "@/lib/recovery/standing-mandate-text";

export {
  assertStandingMandateCeilings,
  defaultPerActionCeilingMinor,
  defaultRolling30dCeilingMinor,
  formatStandingMandateCeiling,
  isWithinMandateCeilings,
  standingMandateCurrency,
  standingMandateSignedText,
  standingMandateTermsVersion,
  standingMandateVetoHours,
} from "@/lib/recovery/standing-mandate-text";

export function hashStandingMandateText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function standingMandateTextHash(): string {
  return hashStandingMandateText(standingMandateSignedText);
}

export type StandingMandateStatus = "ACTIVE" | "REVOKED";
