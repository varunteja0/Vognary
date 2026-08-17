/**
 * Control and action.
 *
 * Four tiers, strictly ordered by how much the system does on the customer's
 * behalf. Only the first two are reachable today. `USER_CONFIRMED_ACTION` exists
 * as a real state machine with an explicit consent seam but is switched off, and
 * `AUTONOMOUS_ACTION` defers entirely to the existing standing-mandate
 * architecture and is never reported as available or route-proven here.
 */
export const controlActionTiers = [
  "INFORMATION",
  "ASSISTED_ACTION",
  "USER_CONFIRMED_ACTION",
  "AUTONOMOUS_ACTION",
] as const;
export type ControlActionTier = (typeof controlActionTiers)[number];

export type MerchantCancellationRoute = {
  merchantKey: string;
  channel: "SELF_SERVICE_WEB" | "EMAIL" | "PHONE" | "IN_APP";
  steps: readonly string[];
  contactEmail: string | null;
  /** When a person last checked these instructions against the merchant. */
  verifiedAt: string;
  verifiedBy: "FOUNDER" | "MERCHANT_DOCUMENTATION";
  sourceUrl: string;
  expiresAt: string | null;
};

export type ControlTierAvailability = {
  available: boolean;
  reasons: readonly string[];
};

export type ControlPlan = {
  recommendedTier: ControlActionTier | null;
  tiers: {
    INFORMATION: ControlTierAvailability & {
      steps: readonly string[];
      channel: MerchantCancellationRoute["channel"] | null;
      verifiedAt: string | null;
      sourceUrl: string | null;
    };
    ASSISTED_ACTION: ControlTierAvailability & { actor: "CUSTOMER" };
    USER_CONFIRMED_ACTION: ControlTierAvailability & { consentRecordedAt: string | null };
    AUTONOMOUS_ACTION: ControlTierAvailability & { providerRouteProven: false };
  };
};

function routeIsVerified(route: MerchantCancellationRoute | null, now: string) {
  if (!route) return false;
  if (!route.steps.length || !route.verifiedAt || !route.sourceUrl) return false;
  if (route.expiresAt && route.expiresAt <= now) return false;
  return true;
}

export function resolveControlPlan(input: {
  now: string;
  route: MerchantCancellationRoute | null;
  merchant: string;
  citedEvidenceIds: readonly string[];
  switches: {
    assistedActionEnabled: boolean;
    userConfirmedActionEnabled: boolean;
    autonomousExecutionEnabled: boolean;
  };
  consent: { userConfirmedActionConsentAt: string | null };
}): ControlPlan {
  const verified = routeIsVerified(input.route, input.now);
  const informationReasons = verified
    ? []
    : input.route
      ? ["We checked these steps too long ago to rely on them. Please check the merchant's own help page."]
      : [`We have not verified how to cancel ${input.merchant} yet.`];

  const assistedBlockers: string[] = [];
  if (!verified) assistedBlockers.push("We need verified cancellation steps before we can draft anything.");
  if (!input.switches.assistedActionEnabled) assistedBlockers.push("Drafting is not switched on for this account.");
  if (!input.citedEvidenceIds.length) assistedBlockers.push("We need at least one receipt to back the request.");
  if (verified && input.route?.channel !== "EMAIL") assistedBlockers.push(`${input.merchant} does not accept cancellations by email.`);
  if (verified && !input.route?.contactEmail) assistedBlockers.push(`We do not have a cancellation address for ${input.merchant}.`);
  const assistedAvailable = assistedBlockers.length === 0;

  const userConfirmedReasons = input.switches.userConfirmedActionEnabled
    ? input.consent.userConfirmedActionConsentAt
      ? []
      : ["We need your explicit go-ahead for each cancellation before we can act."]
    : ["Acting on your behalf is not switched on yet."];

  return {
    recommendedTier: assistedAvailable ? "ASSISTED_ACTION" : verified ? "INFORMATION" : null,
    tiers: {
      INFORMATION: {
        available: verified,
        reasons: informationReasons,
        steps: verified ? [...(input.route?.steps ?? [])] : [],
        channel: verified ? input.route!.channel : null,
        verifiedAt: verified ? input.route!.verifiedAt : null,
        sourceUrl: verified ? input.route!.sourceUrl : null,
      },
      ASSISTED_ACTION: { available: assistedAvailable, reasons: assistedBlockers, actor: "CUSTOMER" },
      USER_CONFIRMED_ACTION: {
        available: input.switches.userConfirmedActionEnabled && Boolean(input.consent.userConfirmedActionConsentAt),
        reasons: userConfirmedReasons,
        consentRecordedAt: input.consent.userConfirmedActionConsentAt,
      },
      // Autonomous cancellation needs a real-world proven provider route and a
      // separate authority. Neither exists, so this tier is never available.
      AUTONOMOUS_ACTION: {
        available: false,
        reasons: ["Cancelling entirely on its own is not something this product does yet."],
        providerRouteProven: false,
      },
    },
  };
}

export type AssistedCancellationRequest = {
  to: string;
  subject: string;
  body: string;
  sendableBy: "CUSTOMER";
  citedEvidenceIds: readonly string[];
};

/**
 * Builds the message the customer sends. Every concrete fact in the body must be
 * one we hold evidence for; nothing is padded with a plausible amount or date.
 */
export function buildAssistedCancellationRequest(input: {
  merchant: string;
  route: MerchantCancellationRoute;
  citedEvidenceIds: readonly string[];
  lastChargeDate: string | null;
  accountReference: string | null;
}): AssistedCancellationRequest {
  if (!input.citedEvidenceIds.length) {
    throw new Error("An assisted cancellation request needs at least one piece of cited evidence.");
  }
  if (input.route.channel !== "EMAIL" || !input.route.contactEmail) {
    throw new Error("An assisted cancellation request needs a verified email cancellation route.");
  }
  const lines = [
    `Hello ${input.merchant},`,
    "",
    "Please cancel my subscription and confirm in writing that no further charges will be made.",
  ];
  if (input.accountReference) lines.push(`My account reference is ${input.accountReference}.`);
  if (input.lastChargeDate) lines.push(`My most recent charge was on ${input.lastChargeDate}.`);
  lines.push("", "Thank you.");
  return {
    to: input.route.contactEmail,
    subject: `Cancellation request — ${input.merchant}`,
    body: lines.join("\n"),
    sendableBy: "CUSTOMER",
    citedEvidenceIds: [...new Set(input.citedEvidenceIds)].sort(),
  };
}

export const userConfirmedActionStates = [
  "NOT_OFFERED",
  "OFFERED",
  "CONSENT_REQUESTED",
  "CONSENT_GRANTED",
  "READY_TO_RUN",
  "DECLINED",
  "WITHDRAWN",
] as const;
export type UserConfirmedActionState = (typeof userConfirmedActionStates)[number];

export type UserConfirmedActionEvent =
  | { kind: "OFFER" }
  | { kind: "REQUEST_CONSENT" }
  | { kind: "GRANT_CONSENT"; consentText: string }
  | { kind: "DECLINE" }
  | { kind: "MARK_READY" }
  | { kind: "WITHDRAW" };

export type UserConfirmedActionTransition = {
  accepted: boolean;
  previousState: UserConfirmedActionState;
  state: UserConfirmedActionState;
  consentRecordedAt: string | null;
  reasons: readonly string[];
};

const closedStates = new Set<UserConfirmedActionState>(["DECLINED", "WITHDRAWN"]);

export function advanceUserConfirmedAction(input: {
  current: UserConfirmedActionState;
  event: UserConfirmedActionEvent;
  now: string;
}): UserConfirmedActionTransition {
  const { current, event, now } = input;
  const refuse = (reason: string): UserConfirmedActionTransition =>
    ({ accepted: false, previousState: current, state: current, consentRecordedAt: null, reasons: [reason] });
  const accept = (state: UserConfirmedActionState, reason: string, consentRecordedAt: string | null = null) =>
    ({ accepted: true, previousState: current, state, consentRecordedAt, reasons: [reason] });

  if (event.kind === "WITHDRAW") {
    return closedStates.has(current)
      ? refuse("This has already been closed.")
      : accept("WITHDRAWN", "You took back permission for this cancellation.");
  }
  if (closedStates.has(current)) return refuse("This has already been closed.");

  switch (event.kind) {
    case "OFFER":
      return current === "NOT_OFFERED" ? accept("OFFERED", "We can offer to handle this cancellation.") : refuse("This was already offered.");
    case "REQUEST_CONSENT":
      return current === "OFFERED" ? accept("CONSENT_REQUESTED", "We asked for your go-ahead.") : refuse("There is nothing to ask about yet.");
    case "GRANT_CONSENT":
      if (current !== "CONSENT_REQUESTED") return refuse("We have not asked for your go-ahead yet.");
      if (!event.consentText.trim()) return refuse("We need a recorded confirmation, not a blank one.");
      return accept("CONSENT_GRANTED", "You gave us the go-ahead for this one cancellation.", now);
    case "DECLINE":
      return accept("DECLINED", "You told us not to handle this one.");
    case "MARK_READY":
      return current === "CONSENT_GRANTED" ? accept("READY_TO_RUN", "This is ready as soon as the capability is switched on.") : refuse("We need your go-ahead first.");
  }
}
