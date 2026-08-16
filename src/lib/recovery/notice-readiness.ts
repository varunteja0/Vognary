export const autopilotNoticeReadinessStates = [
  "off",
  "channel-not-ready",
  "credentials-missing",
  "configured-unproven",
  "proven-ready",
] as const;

export type AutopilotNoticeReadinessState = (typeof autopilotNoticeReadinessStates)[number];

export type AutopilotNoticeReadiness = {
  featureSwitch: boolean;
  channelReady: boolean;
  credentialsPresent: boolean;
  webhookReady: boolean;
  deliveryProven: boolean;
  state: AutopilotNoticeReadinessState;
};

export function describeAutopilotNoticeReadiness(input: {
  featureSwitch: boolean;
  channelReady: boolean;
  credentialsPresent: boolean;
  webhookReady: boolean;
  deliveryProven: boolean;
}): AutopilotNoticeReadiness {
  const state: AutopilotNoticeReadinessState = !input.featureSwitch
    ? "off"
    : !input.channelReady
      ? "channel-not-ready"
      : !input.credentialsPresent || !input.webhookReady
        ? "credentials-missing"
        : !input.deliveryProven
          ? "configured-unproven"
          : "proven-ready";
  return { ...input, state };
}

export function autopilotNoticeReadinessCopy(state: AutopilotNoticeReadinessState): string {
  switch (state) {
    case "off":
      return "Off — veto notices are not sent";
    case "channel-not-ready":
      return "Channel is not ready — notices cannot be delivered";
    case "credentials-missing":
      return "Credentials or webhook are missing — notices cannot be delivered";
    case "configured-unproven":
      return "Configured, but live delivery is not proven";
    case "proven-ready":
      return "Live notice delivery is proven";
  }
}

export const offAutopilotNoticeReadiness = describeAutopilotNoticeReadiness({
  featureSwitch: false,
  channelReady: false,
  credentialsPresent: false,
  webhookReady: false,
  deliveryProven: false,
});
