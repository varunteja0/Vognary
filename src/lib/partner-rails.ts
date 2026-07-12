export const partnerRailStatusValues = [
  "outreach-started",
  "sandbox-requested",
  "sandbox-approved",
  "production-live",
] as const;

export type PartnerRailStatus = typeof partnerRailStatusValues[number];
export type PartnerRailEnvStatus = PartnerRailStatus | "invalid" | null;
export type PartnerRailKey = "accountAggregator" | "upiMandates" | "cardMandates";

export const partnerRailEnvVars: Record<PartnerRailKey, string> = {
  accountAggregator: "ACCOUNT_AGGREGATOR_PARTNER_STATUS",
  upiMandates: "UPI_MANDATE_PARTNER_STATUS",
  cardMandates: "CARD_MANDATE_PARTNER_STATUS",
};

export function getPartnerRailStatuses() {
  return {
    accountAggregator: normalizePartnerRailStatus(process.env.ACCOUNT_AGGREGATOR_PARTNER_STATUS),
    upiMandates: normalizePartnerRailStatus(process.env.UPI_MANDATE_PARTNER_STATUS),
    cardMandates: normalizePartnerRailStatus(process.env.CARD_MANDATE_PARTNER_STATUS),
  } satisfies Record<PartnerRailKey, PartnerRailEnvStatus>;
}

export function getPartnerRailsStatus() {
  const statuses = Object.values(getPartnerRailStatuses());
  const configuredStatuses = statuses.filter((status): status is Exclude<PartnerRailEnvStatus, null> => Boolean(status));

  if (configuredStatuses.some((status) => status === "invalid")) return "invalid-status";
  if (!configuredStatuses.length) return "not-configured";
  if (statuses.every((status) => status === "production-live")) return "production-live";
  if (statuses.every((status) => status === "sandbox-approved" || status === "production-live")) return "sandbox-approved";
  if (statuses.some((status) => status === "sandbox-requested" || status === "sandbox-approved" || status === "production-live")) return "in-progress";
  return "outreach-started";
}

export function getPartnerRailsMissingProductionRails() {
  const statuses = getPartnerRailStatuses();
  return Object.entries(statuses)
    .filter(([, status]) => status !== "production-live")
    .map(([rail, status]) => ({
      rail: rail as PartnerRailKey,
      envVar: partnerRailEnvVars[rail as PartnerRailKey],
      status: status ?? "not-configured",
    }));
}

export function normalizePartnerRailStatus(value: string | undefined): PartnerRailEnvStatus {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  return isPartnerRailStatus(normalized) ? normalized : "invalid";
}

function isPartnerRailStatus(value: string): value is PartnerRailStatus {
  return (partnerRailStatusValues as readonly string[]).includes(value);
}